// Package config stores the client's identity and server URL on disk.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Config is persisted as JSON. The id and secret are generated on first run.
type Config struct {
	ServerURL string `json:"server_url"`
	ID        string `json:"id"`
	Secret    string `json:"secret"`
}

// DefaultPath returns the OS-specific config file location.
func DefaultPath() string {
	switch runtime.GOOS {
	case "windows":
		dir := os.Getenv("ProgramData")
		if dir == "" {
			dir = `C:\ProgramData`
		}
		return filepath.Join(dir, "ddns-client", "config.json")
	case "darwin":
		return "/Library/Application Support/ddns-client/config.json"
	default:
		return "/etc/ddns-client/config.json"
	}
}

// LoadOrCreate reads the config at path. If it does not exist, a new identity
// is generated and saved. serverURL, when non-empty, overrides the stored URL.
func LoadOrCreate(path, serverURL string) (*Config, error) {
	cfg := &Config{}
	data, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parse %s: %w", path, err)
		}
	case errors.Is(err, os.ErrNotExist):
	default:
		return nil, err
	}

	changed := false
	if serverURL != "" && cfg.ServerURL != serverURL {
		cfg.ServerURL = serverURL
		changed = true
	}
	if cfg.ID == "" || cfg.Secret == "" {
		if cfg.ID, err = randomHex(16); err != nil {
			return nil, err
		}
		if cfg.Secret, err = randomHex(32); err != nil {
			return nil, err
		}
		changed = true
	}
	if cfg.ServerURL == "" {
		return nil, errors.New("no server URL configured")
	}
	if changed {
		if err := Save(path, cfg); err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

// Save writes the config atomically with owner-only permissions.
func Save(path string, cfg *Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
