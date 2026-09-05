package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/cooketfun/cooket/apps/realtime/internal/market"
	"github.com/cooketfun/cooket/apps/realtime/internal/service"
	"github.com/cooketfun/cooket/apps/realtime/internal/sse"
	"github.com/cooketfun/cooket/apps/realtime/internal/store"
	"github.com/ethereum/go-ethereum/common"
)

const (
	defaultArcWSS        = "wss://rpc.testnet.arc.io"
	defaultCanonicalUSDC = "0x3600000000000000000000000000000000000000"
)

type config struct {
	wssURL            string
	databaseURL       string
	canonicalUSDC     common.Address
	reconcileInterval time.Duration
	httpAddress       string
	heartbeatInterval time.Duration
	allowedOrigins    []string
	subscriberBuffer  int
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	cfg, err := loadConfig()
	if err != nil {
		logger.Error("invalid realtime configuration", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	runCtx, cancelRun := context.WithCancel(ctx)
	defer cancelRun()

	database, err := store.Open(ctx, cfg.databaseURL)
	if err != nil {
		logger.Error("realtime startup failed", "error", err)
		os.Exit(1)
	}
	defer database.Close()
	if _, err := database.Markets(ctx, market.ChainID); err != nil {
		logger.Error("canonical market registry startup check failed", "error", err)
		os.Exit(1)
	}

	broadcaster := sse.NewBroadcaster(cfg.subscriberBuffer, func() { logger.Warn("slow SSE subscriber removed") })
	httpServer, err := sse.NewServer(cfg.httpAddress, broadcaster, cfg.allowedOrigins, cfg.heartbeatInterval, logger)
	if err != nil {
		logger.Error("realtime startup failed", "error", err)
		os.Exit(1)
	}
	runner, err := service.New(cfg.wssURL, cfg.reconcileInterval, cfg.canonicalUSDC, database, os.Stdout, broadcaster, logger)
	if err != nil {
		logger.Error("realtime startup failed", "error", err)
		os.Exit(1)
	}
	serverErrors := make(chan error, 1)
	go func() {
		err := httpServer.ListenAndServe()
		serverErrors <- err
		if err != nil {
			cancelRun()
		}
	}()
	logger.Info("Cooket realtime market service starting", "chain_id", market.ChainID, "reconcile_interval", cfg.reconcileInterval)
	runErr := runner.Run(runCtx)
	logger.Info("realtime graceful shutdown starting")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("realtime HTTP shutdown failed", "error", err)
	}
	select {
	case err := <-serverErrors:
		if err != nil {
			logger.Error("realtime HTTP server stopped", "error", err)
			os.Exit(1)
		}
	default:
	}
	if runErr != nil {
		logger.Error("Cooket realtime market service stopped", "error", runErr)
		os.Exit(1)
	}
	logger.Info("Cooket realtime market service stopped")
}

func loadConfig() (config, error) {
	chainID := market.ChainID
	if value := strings.TrimSpace(os.Getenv("COOKET_CHAIN_ID")); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return config{}, fmt.Errorf("COOKET_CHAIN_ID: %w", err)
		}
		chainID = parsed
	}
	if chainID != market.ChainID {
		return config{}, fmt.Errorf("COOKET_CHAIN_ID must be %d", market.ChainID)
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return config{}, fmt.Errorf("DATABASE_URL is required")
	}
	wssURL := envDefault("ARC_WSS_URL", defaultArcWSS)
	parsedWSS, err := url.Parse(wssURL)
	if err != nil || parsedWSS.Scheme != "wss" || parsedWSS.Host == "" {
		return config{}, fmt.Errorf("ARC_WSS_URL must be an absolute wss URL")
	}
	usdcValue := envDefault("COOKET_CANONICAL_USDC", defaultCanonicalUSDC)
	if !common.IsHexAddress(usdcValue) || common.HexToAddress(usdcValue) == (common.Address{}) {
		return config{}, fmt.Errorf("COOKET_CANONICAL_USDC must be a nonzero address")
	}
	interval := 3 * time.Second
	if value := strings.TrimSpace(os.Getenv("REALTIME_RECONCILE_INTERVAL")); value != "" {
		interval, err = time.ParseDuration(value)
		if err != nil || interval < time.Second {
			return config{}, fmt.Errorf("REALTIME_RECONCILE_INTERVAL must be at least 1s")
		}
	}
	heartbeat := 15 * time.Second
	if value := strings.TrimSpace(os.Getenv("REALTIME_SSE_HEARTBEAT_INTERVAL")); value != "" {
		heartbeat, err = time.ParseDuration(value)
		if err != nil || heartbeat < time.Second {
			return config{}, fmt.Errorf("REALTIME_SSE_HEARTBEAT_INTERVAL must be at least 1s")
		}
	}
	buffer := 64
	if value := strings.TrimSpace(os.Getenv("REALTIME_SSE_SUBSCRIBER_BUFFER")); value != "" {
		buffer, err = strconv.Atoi(value)
		if err != nil || buffer < 1 || buffer > 4096 {
			return config{}, fmt.Errorf("REALTIME_SSE_SUBSCRIBER_BUFFER must be between 1 and 4096")
		}
	}
	origins, err := parseOrigins(envDefault("REALTIME_SSE_ALLOWED_ORIGINS", "http://localhost:3200,http://127.0.0.1:3200"))
	if err != nil {
		return config{}, err
	}
	httpAddress := envDefault("REALTIME_HTTP_ADDR", ":4300")
	if _, _, err := net.SplitHostPort(httpAddress); err != nil {
		return config{}, fmt.Errorf("REALTIME_HTTP_ADDR must be a host:port address")
	}
	return config{wssURL: wssURL, databaseURL: databaseURL, canonicalUSDC: common.HexToAddress(usdcValue), reconcileInterval: interval, httpAddress: httpAddress, heartbeatInterval: heartbeat, allowedOrigins: origins, subscriberBuffer: buffer}, nil
}

func parseOrigins(value string) ([]string, error) {
	parts := strings.Split(value, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, fmt.Errorf("REALTIME_SSE_ALLOWED_ORIGINS contains invalid origin %q", origin)
		}
		origins = append(origins, origin)
	}
	return origins, nil
}

func envDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
