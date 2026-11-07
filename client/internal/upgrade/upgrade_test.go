package upgrade

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func serve(t *testing.T, binary []byte, checksum string) *httptest.Server {
	asset := AssetName(runtime.GOOS, runtime.GOARCH)
	mux := http.NewServeMux()
	mux.HandleFunc("/v1.2.3/checksums.txt", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "%s  ddns-client_other_arch\n%s  %s\n", "00", checksum, asset)
	})
	mux.HandleFunc("/v1.2.3/"+asset, func(w http.ResponseWriter, _ *http.Request) { w.Write(binary) })
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func TestUpgradeReplacesBinary(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "ddns-client")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	newBin := []byte("new binary")
	srv := serve(t, newBin, sum(newBin))
	u := &Upgrader{ReleaseBase: srv.URL, Executable: exe}
	if err := u.Upgrade(context.Background(), "v1.2.3"); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != "new binary" {
		t.Fatalf("binary not replaced: %q", got)
	}
}

func TestUpgradeRejectsChecksumMismatch(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "ddns-client")
	os.WriteFile(exe, []byte("old"), 0o755)
	srv := serve(t, []byte("tampered"), sum([]byte("expected")))
	u := &Upgrader{ReleaseBase: srv.URL, Executable: exe}
	if err := u.Upgrade(context.Background(), "v1.2.3"); err == nil {
		t.Fatal("expected checksum error")
	}
	got, _ := os.ReadFile(exe)
	if string(got) != "old" {
		t.Fatalf("binary changed despite bad checksum: %q", got)
	}
}

func TestUpgradeRejectsBadVersion(t *testing.T) {
	u := &Upgrader{ReleaseBase: "http://unused", Executable: "x"}
	if err := u.Upgrade(context.Background(), "../../etc"); err == nil {
		t.Fatal("expected invalid version error")
	}
}
