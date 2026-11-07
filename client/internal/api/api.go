// Package api talks to the cloudflare-ddns server (see docs/api.md).
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

// Response is the union of the register and heartbeat responses.
type Response struct {
	HTTPStatus    int    `json:"-"`
	Status        string `json:"status"`
	Interval      int    `json:"interval"`
	TargetVersion string `json:"target_version"`
	IP            string `json:"ip"`
	DNS           string `json:"dns"`
	Error         string `json:"error"`
}

// Client is an HTTP client for the client API.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

// New returns a client that only connects over IPv4, because the server
// publishes the IPv4 address it sees the request coming from.
func New(baseURL string) *Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		return dialer.DialContext(ctx, "tcp4", addr)
	}
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: 30 * time.Second, Transport: transport},
	}
}

// RegisterRequest is sent once to announce this machine.
type RegisterRequest struct {
	ID       string `json:"id"`
	Secret   string `json:"secret"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Version  string `json:"version"`
}

// HeartbeatRequest is sent every interval.
type HeartbeatRequest struct {
	ID      string `json:"id"`
	Secret  string `json:"secret"`
	Version string `json:"version"`
	Error   string `json:"error,omitempty"`
}

func (c *Client) Register(ctx context.Context, req RegisterRequest) (*Response, error) {
	return c.post(ctx, "/api/client/register", req)
}

func (c *Client) Heartbeat(ctx context.Context, req HeartbeatRequest) (*Response, error) {
	return c.post(ctx, "/api/client/heartbeat", req)
}

func (c *Client) post(ctx context.Context, path string, body any) (*Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ddns-client")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	out := &Response{HTTPStatus: res.StatusCode}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil && res.StatusCode < 500 {
		return nil, fmt.Errorf("%s: HTTP %d: invalid response: %w", path, res.StatusCode, err)
	}
	if res.StatusCode >= 500 {
		return nil, fmt.Errorf("%s: server error HTTP %d", path, res.StatusCode)
	}
	return out, nil
}
