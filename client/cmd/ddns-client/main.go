// Command ddns-client is the cloudflare-ddns agent. It registers itself with
// the server, sends heartbeats so the server can keep the machine's DNS record
// pointed at its public IP, and upgrades itself when the server asks.
//
// It takes no required configuration: identity is generated on first run and
// everything else is configured in the dashboard.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"

	"github.com/joaoopereira/cloudflare-ddns/client/internal/agent"
	"github.com/joaoopereira/cloudflare-ddns/client/internal/api"
	"github.com/joaoopereira/cloudflare-ddns/client/internal/config"
	"github.com/joaoopereira/cloudflare-ddns/client/internal/upgrade"
)

// Set at build time with -ldflags "-X main.version=v1.2.3". defaultServer is
// empty in released binaries (the installers pass --server); your own builds
// can bake one in with -X main.defaultServer=https://ddns.example.com.
var (
	version       = "dev"
	defaultServer = ""
)

// exitRestart tells the service manager to start the (upgraded) binary again.
const exitRestart = 75

type options struct {
	configPath string
	serverURL  string
}

func main() {
	opts := options{}
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.StringVar(&opts.configPath, "config", config.DefaultPath(), "path to the config file")
	flag.StringVar(&opts.serverURL, "server", "", "server URL, e.g. https://ddns.example.com (default: the one saved in the config)")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}
	os.Exit(runService(opts))
}

// run is the platform-independent entrypoint; it returns the process exit code.
func run(ctx context.Context, opts options) int {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	exe, err := os.Executable()
	if err != nil {
		log.Error("cannot locate own executable", "err", err)
		return 1
	}
	upgrade.CleanupOld(exe)

	server := opts.serverURL
	if server == "" {
		if _, err := os.Stat(opts.configPath); errors.Is(err, os.ErrNotExist) {
			server = defaultServer
		}
	}
	cfg, err := config.LoadOrCreate(opts.configPath, server)
	if err != nil {
		log.Error("config", "path", opts.configPath, "err", err)
		return 1
	}

	hostname, _ := os.Hostname()
	log.Info("starting", "version", version, "server", cfg.ServerURL, "id", cfg.ID)
	a := &agent.Agent{
		API:      api.New(cfg.ServerURL),
		Upgrader: &upgrade.Upgrader{ReleaseBase: strings.TrimRight(cfg.ServerURL, "/") + "/download", Executable: exe},
		Log:      log,
		ID:       cfg.ID,
		Secret:   cfg.Secret,
		Hostname: hostname,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Version:  version,
	}
	switch err := a.Run(ctx); {
	case errors.Is(err, agent.ErrRestart):
		log.Info("upgrade installed, exiting so the service restarts")
		return exitRestart
	case errors.Is(err, context.Canceled):
		log.Info("stopped")
		return 0
	default:
		log.Error("stopped", "err", err)
		return 1
	}
}

// signalContext is cancelled on Ctrl-C / SIGTERM.
func signalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}
