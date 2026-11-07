// Package upgrade replaces the running binary with a release from GitHub.
package upgrade

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// DefaultReleaseBase is where release assets are downloaded from.
const DefaultReleaseBase = "https://github.com/joaoopereira/cloudflare-ddns/releases/download"

var versionRE = regexp.MustCompile(`^v\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$`)

// AssetName is the release asset for an OS/arch, e.g. ddns-client_linux_amd64.
func AssetName(goos, goarch string) string {
	name := fmt.Sprintf("ddns-client_%s_%s", goos, goarch)
	if goos == "windows" {
		name += ".exe"
	}
	return name
}

// Upgrader downloads, verifies and installs a release.
type Upgrader struct {
	ReleaseBase string       // e.g. DefaultReleaseBase
	Executable  string       // path of the binary to replace
	HTTP        *http.Client // defaults to a client with a 5 minute timeout
}

// Upgrade installs version over u.Executable. The caller must restart the
// process afterwards (the service manager does this when it exits).
func (u *Upgrader) Upgrade(ctx context.Context, version string) error {
	if !versionRE.MatchString(version) {
		return fmt.Errorf("invalid version %q", version)
	}
	httpClient := u.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Minute}
	}
	asset := AssetName(runtime.GOOS, runtime.GOARCH)
	base := strings.TrimRight(u.ReleaseBase, "/") + "/" + version + "/"

	want, err := expectedChecksum(ctx, httpClient, base+"checksums.txt", asset)
	if err != nil {
		return err
	}

	dir := filepath.Dir(u.Executable)
	tmp, err := os.CreateTemp(dir, ".ddns-client-*.new")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	got, err := download(ctx, httpClient, base+asset, tmp)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("checksum mismatch for %s: got %s, want %s", asset, got, want)
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		return err
	}

	// Move the running binary aside first: Windows can rename, but not
	// overwrite, a running executable.
	old := u.Executable + ".old"
	_ = os.Remove(old)
	if err := os.Rename(u.Executable, old); err != nil {
		return fmt.Errorf("move current binary aside: %w", err)
	}
	if err := os.Rename(tmpPath, u.Executable); err != nil {
		_ = os.Rename(old, u.Executable) // roll back
		return fmt.Errorf("install new binary: %w", err)
	}
	if runtime.GOOS != "windows" {
		_ = os.Remove(old) // on Windows it is still in use; cleaned up next time
	}
	return nil
}

// CleanupOld removes a leftover binary from a previous upgrade.
func CleanupOld(executable string) {
	_ = os.Remove(executable + ".old")
}

func expectedChecksum(ctx context.Context, c *http.Client, url, asset string) (string, error) {
	res, err := get(ctx, c, url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	scanner := bufio.NewScanner(res.Body)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == asset {
			return strings.ToLower(fields[0]), nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("no checksum for %s in %s", asset, url)
}

func download(ctx context.Context, c *http.Client, url string, w io.Writer) (string, error) {
	res, err := get(ctx, c, url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(w, h), res.Body); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func get(ctx context.Context, c *http.Client, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("GET %s: HTTP %d", url, res.StatusCode)
	}
	return res, nil
}
