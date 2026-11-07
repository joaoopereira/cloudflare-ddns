// Command ddns-client is the cloudflare-ddns agent. It registers itself with
// the server, sends heartbeats so the server can keep the machine's DNS record
// pointed at its public IP, and upgrades itself when the server asks.
//
// This is a placeholder: the agent is built in epic #3.
package main

import (
	"flag"
	"fmt"
	"os"
)

// version is set at build time with -ldflags "-X main.version=v1.2.3".
var version = "dev"

func main() {
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	fmt.Fprintln(os.Stderr, "ddns-client: not implemented yet (see epic #3)")
	os.Exit(1)
}
