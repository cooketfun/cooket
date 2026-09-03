package main

import (
	"context"
	"fmt"
	api "github.com/cooketfun/cooket/apps/api/internal/api"
	"log/slog"
	"net/http"
	"os"
	"time"
)

func main() {
	host := os.Getenv("API_HOST")
	if host == "" {
		host = "0.0.0.0"
	}
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "4000"
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		panic("DATABASE_URL is required")
	}
	chain, e := resolveAPIChainConfig(
		os.Getenv("COOKET_CHAIN_ID"),
		os.Getenv("ARC_TESTNET_RPC_URL"),
	)
	if e != nil {
		panic(e)
	}
	requestTimeout := 5 * time.Second
	if s := os.Getenv("API_REQUEST_TIMEOUT"); s != "" {
		if d, e := time.ParseDuration(s); e == nil && d > 0 {
			requestTimeout = d
		}
	}
	startupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	repo, e := api.NewPostgresRepository(startupCtx, databaseURL)
	if e != nil {
		panic(e)
	}
	defer repo.Close()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	objects, e := api.NewLocalObjectStore(os.Getenv("STORAGE_LOCAL_DIR"))
	if e != nil {
		panic(e)
	}
	allowedOrigins, e := api.ParseAllowedOrigins(os.Getenv("COOKET_CORS_ORIGINS"))
	if e != nil {
		panic("COOKET_CORS_ORIGINS: " + e.Error())
	}
	handler := api.CORS(api.NewHandlerWithObjectStore(repo, chain.ChainID, requestTimeout, logger, objects), allowedOrigins)
	addr := fmt.Sprintf("%s:%s", host, port)
	fmt.Printf("cooket-api (%s) listening on %s\n", chain.Name, addr)

	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: requestTimeout, ReadTimeout: requestTimeout, WriteTimeout: requestTimeout, IdleTimeout: requestTimeout}
	if err := server.ListenAndServe(); err != nil {
		panic(err)
	}
}
