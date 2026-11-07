// Package agent runs the register/heartbeat loop.
package agent

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/joaoopereira/cloudflare-ddns/client/internal/api"
)

// ErrRestart is returned by Run after a successful upgrade; the caller should
// exit so the service manager starts the new binary.
var ErrRestart = errors.New("upgraded, restart required")

// Upgrader installs a new version of the client.
type Upgrader interface {
	Upgrade(ctx context.Context, version string) error
}

// Agent keeps the server informed about this machine.
type Agent struct {
	API      *api.Client
	Upgrader Upgrader
	Log      *slog.Logger

	ID, Secret, Hostname, OS, Arch, Version string

	// MinBackoff and MaxBackoff bound the retry delay while the server
	// isn't accepting this client (default 15s and 5m).
	MinBackoff, MaxBackoff time.Duration
	// DefaultInterval is used until the server sends one (default 60s).
	DefaultInterval time.Duration

	// sleep is replaceable in tests.
	sleep func(ctx context.Context, d time.Duration) error
}

type state int

const (
	stateRegister state = iota
	stateHeartbeat
)

// Run loops until ctx is cancelled or an upgrade requires a restart.
func (a *Agent) Run(ctx context.Context) error {
	a.defaults()
	st := stateRegister
	backoff := a.MinBackoff
	interval := a.DefaultInterval
	var lastError string

	for {
		var delay time.Duration
		switch st {
		case stateRegister:
			res, err := a.API.Register(ctx, api.RegisterRequest{
				ID: a.ID, Secret: a.Secret, Hostname: a.Hostname, OS: a.OS, Arch: a.Arch, Version: a.Version,
			})
			switch {
			case err != nil:
				a.Log.Warn("register failed", "err", err)
				delay, backoff = backoff, a.next(backoff)
			case res.HTTPStatus == http.StatusOK || res.HTTPStatus == http.StatusCreated:
				a.Log.Info("registered", "status", res.Status)
				interval = a.interval(res.Interval, interval)
				st, backoff, delay = stateHeartbeat, a.MinBackoff, 0
			default:
				// closed, blocked, rate_limited, or a credentials problem.
				a.Log.Info("registration not accepted, retrying later", "status", res.Status, "http", res.HTTPStatus, "retry_in", backoff)
				delay, backoff = backoff, a.next(backoff)
			}

		case stateHeartbeat:
			res, err := a.API.Heartbeat(ctx, api.HeartbeatRequest{ID: a.ID, Secret: a.Secret, Version: a.Version, Error: lastError})
			switch {
			case err != nil:
				a.Log.Warn("heartbeat failed", "err", err)
				delay = min(interval, backoff)
				backoff = a.next(backoff)
			case res.HTTPStatus == http.StatusOK:
				backoff = a.MinBackoff
				lastError = ""
				interval = a.interval(res.Interval, interval)
				delay = interval
				if res.DNS != "" {
					a.Log.Info("dns", "result", res.DNS, "ip", res.IP)
				}
				if res.TargetVersion != "" && res.TargetVersion != a.Version && a.Upgrader != nil {
					a.Log.Info("upgrading", "from", a.Version, "to", res.TargetVersion)
					if err := a.Upgrader.Upgrade(ctx, res.TargetVersion); err != nil {
						a.Log.Error("upgrade failed", "err", err)
						lastError = "upgrade to " + res.TargetVersion + " failed: " + err.Error()
					} else {
						return ErrRestart
					}
				}
			case res.HTTPStatus == http.StatusNotFound || res.Status == "rejected":
				// Deleted on the server, or rejected: start over.
				a.Log.Info("not accepted by server, registering again", "status", res.Status)
				st, delay = stateRegister, backoff
				backoff = a.next(backoff)
			default:
				// revoked or unauthorized: nothing to do but check back later.
				a.Log.Warn("heartbeat refused", "status", res.Status, "http", res.HTTPStatus)
				delay = a.MaxBackoff
			}
		}

		if err := a.sleep(ctx, delay); err != nil {
			return err
		}
	}
}

func (a *Agent) defaults() {
	if a.MinBackoff == 0 {
		a.MinBackoff = 15 * time.Second
	}
	if a.MaxBackoff == 0 {
		a.MaxBackoff = 5 * time.Minute
	}
	if a.DefaultInterval == 0 {
		a.DefaultInterval = 60 * time.Second
	}
	if a.Log == nil {
		a.Log = slog.Default()
	}
	if a.sleep == nil {
		a.sleep = sleepCtx
	}
}

func (a *Agent) interval(seconds int, fallback time.Duration) time.Duration {
	if seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

// next doubles the backoff with ±20% jitter, capped at MaxBackoff.
func (a *Agent) next(d time.Duration) time.Duration {
	n := time.Duration(float64(d*2) * (0.8 + 0.4*rand.Float64()))
	return min(max(n, a.MinBackoff), a.MaxBackoff)
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
