package agent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/joaoopereira/cloudflare-ddns/client/internal/api"
)

type step struct {
	path   string
	status int
	body   string
}

// script serves the given responses in order and records requests.
func script(t *testing.T, steps []step) (*httptest.Server, *[]string) {
	var mu sync.Mutex
	var seen []string
	i := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		seen = append(seen, r.URL.Path)
		if i >= len(steps) {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		s := steps[i]
		i++
		if s.path != r.URL.Path {
			t.Errorf("request %d: got %s, want %s", i, r.URL.Path, s.path)
		}
		w.WriteHeader(s.status)
		io.WriteString(w, s.body)
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

type fakeUpgrader struct {
	versions []string
	err      error
}

func (f *fakeUpgrader) Upgrade(_ context.Context, v string) error {
	f.versions = append(f.versions, v)
	return f.err
}

func newAgent(url string, sleeps *[]time.Duration, maxSleeps int, cancel context.CancelFunc) *Agent {
	return &Agent{
		API:     api.New(url),
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		ID:      "id-123456",
		Secret:  "secret",
		Version: "v0.1.0",
		sleep: func(ctx context.Context, d time.Duration) error {
			*sleeps = append(*sleeps, d)
			if len(*sleeps) >= maxSleeps {
				cancel()
				return context.Canceled
			}
			return nil
		},
	}
}

func TestRegistersWithBackoffThenHeartbeats(t *testing.T) {
	srv, seen := script(t, []step{
		{"/api/client/register", 403, `{"status":"closed"}`},
		{"/api/client/register", 403, `{"status":"blocked"}`},
		{"/api/client/register", 201, `{"status":"pending","interval":30}`},
		{"/api/client/heartbeat", 200, `{"status":"pending","interval":30}`},
		{"/api/client/heartbeat", 200, `{"status":"approved","interval":45,"dns":"updated","ip":"203.0.113.1"}`},
	})
	ctx, cancel := context.WithCancel(context.Background())
	var sleeps []time.Duration
	a := newAgent(srv.URL, &sleeps, 5, cancel)
	err := a.Run(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(*seen) != 5 {
		t.Fatalf("requests: %v", *seen)
	}
	if sleeps[0] != 15*time.Second || sleeps[1] <= sleeps[0] {
		t.Errorf("expected growing backoff, got %v", sleeps)
	}
	if sleeps[2] != 0 || sleeps[3] != 30*time.Second || sleeps[4] != 45*time.Second {
		t.Errorf("expected server-provided intervals, got %v", sleeps)
	}
}

func TestReRegistersWhenRejectedOrUnknown(t *testing.T) {
	srv, seen := script(t, []step{
		{"/api/client/register", 201, `{"status":"pending","interval":60}`},
		{"/api/client/heartbeat", 403, `{"status":"rejected"}`},
		{"/api/client/register", 403, `{"status":"blocked"}`},
	})
	ctx, cancel := context.WithCancel(context.Background())
	var sleeps []time.Duration
	newAgent(srv.URL, &sleeps, 3, cancel).Run(ctx)
	want := []string{"/api/client/register", "/api/client/heartbeat", "/api/client/register"}
	for i, p := range want {
		if (*seen)[i] != p {
			t.Fatalf("requests: %v", *seen)
		}
	}
}

func TestUpgradeReturnsRestart(t *testing.T) {
	srv, _ := script(t, []step{
		{"/api/client/register", 200, `{"status":"approved","interval":60}`},
		{"/api/client/heartbeat", 200, `{"status":"approved","interval":60,"target_version":"v0.2.0"}`},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var sleeps []time.Duration
	a := newAgent(srv.URL, &sleeps, 10, cancel)
	up := &fakeUpgrader{}
	a.Upgrader = up
	if err := a.Run(ctx); !errors.Is(err, ErrRestart) {
		t.Fatalf("expected ErrRestart, got %v", err)
	}
	if len(up.versions) != 1 || up.versions[0] != "v0.2.0" {
		t.Fatalf("upgrader calls: %v", up.versions)
	}
}

func TestFailedUpgradeIsReportedOnNextHeartbeat(t *testing.T) {
	var errs []string
	var mu sync.Mutex
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		var body struct {
			Error string `json:"error"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		n++
		if r.URL.Path == "/api/client/register" {
			io.WriteString(w, `{"status":"approved","interval":60}`)
			return
		}
		errs = append(errs, body.Error)
		io.WriteString(w, `{"status":"approved","interval":60,"target_version":"v0.2.0"}`)
	}))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	var sleeps []time.Duration
	a := newAgent(srv.URL, &sleeps, 3, cancel)
	a.Upgrader = &fakeUpgrader{err: errors.New("disk full")}
	a.Run(ctx)
	if len(errs) < 2 || errs[0] != "" || errs[1] == "" {
		t.Fatalf("expected error reported on second heartbeat, got %q", errs)
	}
}
