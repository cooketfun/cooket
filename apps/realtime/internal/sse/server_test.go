package sse

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testServer(t *testing.T, heartbeat time.Duration) (*Server, *Broadcaster, *httptest.Server) {
	t.Helper()
	b := NewBroadcaster(4, nil)
	s, err := NewServer(":0", b, []string{"http://localhost:3200"}, heartbeat, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return s, b, httptest.NewServer(s.routes())
}

func waitSubscribers(t *testing.T, b *Broadcaster, n int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if b.Len() == n {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("subscriber count = %d, want %d", b.Len(), n)
}

func TestEventsFramesCanonicalEventAndCORS(t *testing.T) {
	_, b, ts := testServer(t, time.Hour)
	defer ts.Close()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/events", nil)
	req.Header.Set("Origin", "http://localhost:3200")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/event-stream") {
		t.Fatalf("content type %q", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:3200" {
		t.Fatalf("CORS %q", got)
	}
	waitSubscribers(t, b, 1)
	b.Publish(testEvent())
	lineReader := bufio.NewReader(resp.Body)
	var frame strings.Builder
	for i := 0; i < 3; i++ {
		line, err := lineReader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		frame.WriteString(line)
	}
	got := frame.String()
	if !strings.Contains(got, "event: trade\n") || !strings.Contains(got, "id: 5042002:0xabc:7\n") || !strings.Contains(got, "\"chain_id\":5042002") || !strings.Contains(got, "\"block_timestamp\":123") {
		t.Fatalf("invalid frame %q", got)
	}
}

func TestEventsHeartbeatAndCancellationCleanup(t *testing.T) {
	_, b, ts := testServer(t, 5*time.Millisecond)
	defer ts.Close()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/events", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(resp.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if line != ": ping\n" {
		t.Fatalf("heartbeat = %q", line)
	}
	waitSubscribers(t, b, 1)
	cancel()
	resp.Body.Close()
	waitSubscribers(t, b, 0)
}

func TestEventsRejectsDisallowedOriginAndNonGET(t *testing.T) {
	_, _, ts := testServer(t, time.Hour)
	defer ts.Close()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/events", nil)
	req.Header.Set("Origin", "https://evil.example")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	resp, err = http.Post(ts.URL+"/events", "text/plain", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestHealthz(t *testing.T) {
	_, _, ts := testServer(t, time.Hour)
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}
