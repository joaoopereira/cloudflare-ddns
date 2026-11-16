package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateGeneratesAndPersistsIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "config.json")
	cfg, err := LoadOrCreate(path, "https://example.test")
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.ID) != 32 || len(cfg.Secret) != 64 {
		t.Fatalf("unexpected identity lengths: id=%d secret=%d", len(cfg.ID), len(cfg.Secret))
	}
	again, err := LoadOrCreate(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if *again != *cfg {
		t.Fatalf("identity changed between runs: %+v vs %+v", again, cfg)
	}
	if info, _ := os.Stat(path); info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Fatalf("config is readable by others: %v", info.Mode())
	}
}

func TestLoadOrCreateRequiresServer(t *testing.T) {
	if _, err := LoadOrCreate(filepath.Join(t.TempDir(), "c.json"), ""); err == nil {
		t.Fatal("expected an error without a server URL")
	}
}

func TestServerURLMustBeHTTPS(t *testing.T) {
	for url, ok := range map[string]bool{
		"https://ddns.example.com":  true,
		"http://localhost:8787":     true,
		"http://127.0.0.1:8787":     true,
		"http://ddns.example.com":   false,
		"ftp://ddns.example.com":    false,
		"ddns.example.com":          false,
		"http://localhost.evil.com": false,
	} {
		_, err := LoadOrCreate(filepath.Join(t.TempDir(), "c.json"), url)
		if (err == nil) != ok {
			t.Errorf("%s: err=%v, want ok=%v", url, err, ok)
		}
	}
}
