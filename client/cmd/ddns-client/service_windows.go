//go:build windows

package main

import (
	"context"
	"os"

	"golang.org/x/sys/windows/svc"
)

const serviceName = "ddns-client"

// runService runs under the Windows Service Control Manager when started as a
// service, or in the foreground otherwise (e.g. from a console for debugging).
func runService(opts options) int {
	isService, err := svc.IsWindowsService()
	if err != nil || !isService {
		ctx, cancel := signalContext()
		defer cancel()
		return run(ctx, opts)
	}
	h := &handler{opts: opts}
	if err := svc.Run(serviceName, h); err != nil {
		return 1
	}
	return h.code
}

type handler struct {
	opts options
	code int
}

func (h *handler) Execute(_ []string, req <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan int, 1)
	go func() { done <- run(ctx, h.opts) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case code := <-done:
			if code == exitRestart {
				// Exit without reporting "stopped" so the SCM recovery action
				// (configured by install.ps1) restarts the upgraded binary.
				os.Exit(exitRestart)
			}
			h.code = code
			return false, uint32(code)
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				h.code = <-done
				return false, 0
			}
		}
	}
}
