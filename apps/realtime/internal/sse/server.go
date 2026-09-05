package sse

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Server struct {
	broadcaster *Broadcaster
	logger      *slog.Logger
	origins     map[string]struct{}
	heartbeat   time.Duration
	httpServer  *http.Server
	done        chan struct{}
	stop        sync.Once
}

func NewServer(address string, broadcaster *Broadcaster, origins []string, heartbeat time.Duration, logger *slog.Logger) (*Server, error) {
	if strings.TrimSpace(address) == "" || broadcaster == nil || heartbeat <= 0 || logger == nil {
		return nil, fmt.Errorf("HTTP address, broadcaster, positive heartbeat, and logger are required")
	}
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}
	s := &Server{broadcaster: broadcaster, logger: logger, origins: allowed, heartbeat: heartbeat, done: make(chan struct{})}
	s.httpServer = &http.Server{Addr: address, Handler: s.routes(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 0}
	return s, nil
}

func (s *Server) ListenAndServe() error {
	s.logger.Info("realtime HTTP server starting", "address", s.httpServer.Addr)
	err := s.httpServer.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.stop.Do(func() { close(s.done) })
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("/events", s.events)
	return mux
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok\n"))
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.allowOrigin(w, r) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	// Bound each network write; a stalled socket must not retain a handler.
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	events, unsubscribe := s.broadcaster.Subscribe()
	defer func() {
		unsubscribe()
		s.logger.Info("SSE subscriber disconnected")
	}()
	s.logger.Info("SSE subscriber connected")
	ticker := time.NewTicker(s.heartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-r.Context().Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			payload, err := json.Marshal(event)
			if err != nil {
				return
			}
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := fmt.Fprintf(w, "event: trade\nid: %s\ndata: %s\n\n", event.Identity, payload); err != nil {
				return
			}
			flusher.Flush()
		case <-ticker.C:
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) allowOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if _, ok := s.origins[origin]; !ok {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	return true
}
