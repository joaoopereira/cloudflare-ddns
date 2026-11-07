//go:build !windows

package main

// On Linux and macOS the client runs in the foreground under systemd or
// launchd, which restart it after an upgrade.
func runService(opts options) int {
	ctx, cancel := signalContext()
	defer cancel()
	return run(ctx, opts)
}
