package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-chi/chi/v5"
	"io"
	"log/slog"
	"math/big"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Handler struct {
	repo       Repository
	chainID    int64
	timeout    time.Duration
	logger     *slog.Logger
	objects    ObjectStore
	ethUSD     ETHUSDReader
	fetchImage imageFetcher
}

type imageFetcher func(context.Context, string) ([]byte, string, error)

func NewHandler(repo Repository, chainID int64, timeout time.Duration, logger *slog.Logger) http.Handler {
	return NewHandlerWithObjectStore(repo, chainID, timeout, logger, nil)
}
func NewHandlerWithObjectStore(repo Repository, chainID int64, timeout time.Duration, logger *slog.Logger, objects ObjectStore) http.Handler {
	return NewHandlerWithDependencies(repo, chainID, timeout, logger, objects, nil)
}
func NewHandlerWithDependencies(repo Repository, chainID int64, timeout time.Duration, logger *slog.Logger, objects ObjectStore, ethUSD ETHUSDReader) http.Handler {
	return newHandler(repo, chainID, timeout, logger, objects, ethUSD, fetchRemoteImage)
}
func newHandler(repo Repository, chainID int64, timeout time.Duration, logger *slog.Logger, objects ObjectStore, ethUSD ETHUSDReader, fetchImage imageFetcher) http.Handler {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	if logger == nil {
		logger = slog.Default()
	}
	h := &Handler{repo: repo, chainID: chainID, timeout: timeout, logger: logger, objects: objects, ethUSD: ethUSD, fetchImage: fetchImage}
	r := chi.NewRouter()
	r.Use(requestID)
	r.Use(localCORS)
	r.Use(h.logging)
	r.Use(timeoutMiddleware(timeout))
	r.Get("/health", h.health)
	r.Get("/readyz", h.ready)
	r.Get("/objects/*", h.object)
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/prices/eth-usd", h.ethUSDPrice)
		r.Post("/token-metadata", h.uploadMetadata)
		r.Post("/token-metadata/{draft}/finalize", h.finalizeMetadata)
		r.Get("/tokens", h.tokens)
		r.Get("/tokens/newest", h.tokens)
		r.Get("/tokens/trending", h.trending)
		r.Get("/trending", h.trending)
		r.Get("/tokens/{address}", h.token)
		r.Get("/tokens/{address}/pricing", h.pricing)
		r.Get("/tokens/{address}/chart", h.chart)
		r.Get("/tokens/{address}/trades", h.trades)
		r.Get("/tokens/{address}/activity", h.activity)
		r.Get("/tokens/{address}/cto", h.ctoStatus)
		r.Get("/tokens/{address}/cto/proposals", h.ctoProposals)
		r.Get("/tokens/{address}/cto/checkpoints", h.ctoCheckpoints)
		r.Get("/cto/proposals/{proposalId}", h.ctoProposal)
		r.Get("/cto/treasuries/{treasury}", h.ctoTreasury)
		r.Get("/cto/treasuries/{treasury}/transfers", h.ctoTreasuryTransfers)
		r.Get("/cto/treasuries/{treasury}/fee-pulls", h.ctoTreasuryFeePulls)
		r.Get("/creators/{address}", h.creator)
		r.Get("/creators/{address}/tokens", h.creatorTokens)
	})
	return r
}

func (h *Handler) ethUSDPrice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if h.ethUSD == nil {
		writeError(w, http.StatusServiceUnavailable, "oracle_unavailable", "ETH/USD oracle is unavailable")
		return
	}
	price, err := h.ethUSD.Read(r.Context())
	if err != nil {
		h.logger.Warn("ETH/USD oracle read failed", "request_id", requestIDFrom(r.Context()), "error", err)
		writeError(w, http.StatusServiceUnavailable, "oracle_unavailable", "ETH/USD oracle is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, price)
}
func localCORS(next http.Handler) http.Handler {
	return CORS(next, []string{"http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3200", "http://127.0.0.1:3200"})
}

// ParseAllowedOrigins accepts an explicit comma-separated CORS allowlist.
// HTTPS origins are accepted. HTTP is limited to loopback development origins.
// Wildcards, paths, credentials, and malformed values are intentionally rejected.
func ParseAllowedOrigins(raw string) ([]string, error) {
	seen := map[string]struct{}{}
	for _, item := range strings.Split(raw, ",") {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		parsed, err := url.Parse(value)
		if err != nil || !parsed.IsAbs() || parsed.Path != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || strings.Contains(value, "#") || parsed.User != nil || parsed.Host == "" || strings.Contains(parsed.Host, "*") {
			return nil, fmt.Errorf("invalid allowed origin %q", value)
		}
		scheme := strings.ToLower(parsed.Scheme)
		host := strings.ToLower(parsed.Hostname())
		port := parsed.Port()
		if host == "" || !validOriginPort(port) || (scheme != "https" && (scheme != "http" || !isLoopbackDevelopmentHost(host))) {
			return nil, fmt.Errorf("invalid allowed origin %q", value)
		}
		canonicalHost := host
		if port != "" {
			canonicalHost = net.JoinHostPort(host, port)
		}
		seen[scheme+"://"+canonicalHost] = struct{}{}
	}
	if len(seen) == 0 {
		return nil, errors.New("at least one allowed CORS origin is required")
	}
	origins := make([]string, 0, len(seen))
	for origin := range seen {
		origins = append(origins, origin)
	}
	sort.Strings(origins)
	return origins, nil
}

func validOriginPort(port string) bool {
	if port == "" {
		return true
	}
	value, err := strconv.Atoi(port)
	return err == nil && value > 0 && value <= 65535
}

func isLoopbackDevelopmentHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	return host == "127.0.0.1" || host == "::1"
}

// CORS allows only supplied origins and does not enable cookies or credentials.
func CORS(next http.Handler, allowedOrigins []string) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		_, originAllowed := allowed[origin]
		if originAllowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
		}
		if r.Method == http.MethodOptions {
			if originAllowed {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.WriteHeader(http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

const maxImageBytes = 5 << 20

var transactionHashRE = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)

const maxImageRedirects = 3

var supportedImageTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

func (h *Handler) uploadMetadata(w http.ResponseWriter, r *http.Request) {
	if h.objects == nil {
		writeError(w, 503, "storage_unavailable", "metadata storage is unavailable")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+(1<<20))
	if e := r.ParseMultipartForm(maxImageBytes + (1 << 20)); e != nil {
		writeError(w, 400, "invalid_upload", "upload is too large or malformed")
		return
	}
	name, symbol := strings.TrimSpace(r.FormValue("name")), strings.TrimSpace(r.FormValue("symbol"))
	description, supply := strings.TrimSpace(r.FormValue("description")), strings.TrimSpace(r.FormValue("initial_supply"))
	websiteURL, urlError := optionalPublicURL(r.FormValue("website_url"), nil)
	if urlError != nil {
		writeError(w, 400, "invalid_website_url", "website URL must be a valid http or https URL")
		return
	}
	xURL, urlError := optionalPublicURL(r.FormValue("x_url"), []string{"x.com", "twitter.com"})
	if urlError != nil {
		writeError(w, 400, "invalid_x_url", "X/Twitter URL must use x.com or twitter.com")
		return
	}
	telegramURL, urlError := optionalPublicURL(r.FormValue("telegram_url"), []string{"t.me", "telegram.me"})
	if urlError != nil {
		writeError(w, 400, "invalid_telegram_url", "Telegram URL must use t.me or telegram.me")
		return
	}
	discordURL, urlError := optionalPublicURL(r.FormValue("discord_url"), []string{"discord.gg", "discord.com"})
	if urlError != nil {
		writeError(w, 400, "invalid_discord_url", "Discord URL must use discord.gg or discord.com")
		return
	}
	if len(name) == 0 || len([]byte(name)) > 64 {
		writeError(w, 400, "invalid_name", "name must be between 1 and 64 bytes")
		return
	}
	if len(symbol) == 0 || len([]byte(symbol)) > 16 {
		writeError(w, 400, "invalid_symbol", "symbol must be between 1 and 16 bytes")
		return
	}
	if len([]byte(description)) > 1000 {
		writeError(w, 400, "invalid_description", "description must be at most 1000 bytes")
		return
	}
	n, ok := new(big.Int).SetString(supply, 10)
	maxUint256 := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	if !ok || n.Sign() <= 0 || n.Cmp(maxUint256) > 0 {
		writeError(w, 400, "invalid_supply", "initial supply must be a positive integer in base units")
		return
	}
	imageURLInput := strings.TrimSpace(r.FormValue("image_url"))
	file, header, fileErr := r.FormFile("image")
	if fileErr == nil && imageURLInput != "" {
		file.Close()
		writeError(w, 400, "invalid_image", "provide either an image file or image URL, not both")
		return
	}
	var data []byte
	var contentType string
	var e error
	if fileErr == nil {
		defer file.Close()
		if header.Size <= 0 || header.Size > maxImageBytes {
			writeError(w, 400, "invalid_image", "image must be at most 5 MB")
			return
		}
		data, e = readImageBytes(file)
		if e != nil {
			writeError(w, 400, "invalid_image", "image could not be read")
			return
		}
		contentType, e = detectedImageType(data)
	} else if imageURLInput != "" {
		if h.fetchImage == nil {
			writeError(w, 503, "storage_unavailable", "remote image ingestion is unavailable")
			return
		}
		data, contentType, e = h.fetchImage(r.Context(), imageURLInput)
	} else {
		writeError(w, 400, "invalid_image", "an image file or HTTPS image URL is required")
		return
	}
	if e != nil {
		writeError(w, 400, "invalid_image", "image must be a supported PNG, JPEG, WebP, or GIF no larger than 5 MB")
		return
	}
	detectedType, detectErr := detectedImageType(data)
	if detectErr != nil || detectedType != contentType {
		writeError(w, 400, "invalid_image", "image must be PNG, JPEG, WebP, or GIF")
		return
	}
	ext, ok := supportedImageTypes[contentType]
	if !ok {
		writeError(w, 400, "invalid_image", "image must be PNG, JPEG, WebP, or GIF")
		return
	}
	var random [16]byte
	if _, e = rand.Read(random[:]); e != nil {
		h.internal(w, r, e)
		return
	}
	id := hex.EncodeToString(random[:])
	imageKey := filepath.ToSlash(filepath.Join("images", id+ext))
	metadataKey := filepath.ToSlash(filepath.Join("metadata", id+".json"))
	imageURL := "/objects/" + imageKey
	metadataURL := "/objects/" + metadataKey
	metadataDocument := map[string]string{"name": name, "symbol": symbol, "image": imageURL}
	for key, value := range map[string]string{"description": description, "website_url": websiteURL, "x_url": xURL, "telegram_url": telegramURL, "discord_url": discordURL} {
		if value != "" {
			metadataDocument[key] = value
		}
	}
	metadata, _ := json.Marshal(metadataDocument)
	if e = h.objects.Put(r.Context(), imageKey, bytes.NewReader(data)); e != nil {
		h.internal(w, r, e)
		return
	}
	if e = h.objects.Put(r.Context(), metadataKey, bytes.NewReader(metadata)); e != nil {
		h.internal(w, r, e)
		return
	}
	draft := MetadataDraft{ID: id, Name: name, Symbol: symbol, InitialSupply: supply, Description: description, ImageURL: imageURL, MetadataURL: metadataURL, WebsiteURL: websiteURL, XURL: xURL, TelegramURL: telegramURL, DiscordURL: discordURL}
	if e = h.repo.SaveMetadataDraft(r.Context(), draft); e != nil {
		h.internal(w, r, e)
		return
	}
	writeJSON(w, 201, draft)
}

func readImageBytes(r io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxImageBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxImageBytes {
		return nil, errors.New("image exceeds the maximum size")
	}
	return data, nil
}

func detectedImageType(data []byte) (string, error) {
	contentType := http.DetectContentType(data)
	if _, ok := supportedImageTypes[contentType]; !ok {
		return "", errors.New("unsupported image type")
	}
	return contentType, nil
}

func fetchRemoteImage(ctx context.Context, rawURL string) ([]byte, string, error) {
	u, err := validateRemoteImageURL(ctx, rawURL)
	if err != nil {
		return nil, "", err
	}
	transport := &http.Transport{
		Proxy:       nil,
		DialContext: secureImageDialContext,
	}
	client := &http.Client{
		Timeout:   5 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxImageRedirects {
				return errors.New("too many image redirects")
			}
			_, redirectErr := validateRemoteImageURL(req.Context(), req.URL.String())
			return redirectErr
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, "", fmt.Errorf("remote image returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxImageBytes {
		return nil, "", errors.New("remote image exceeds the maximum size")
	}
	data, err := readImageBytes(response.Body)
	if err != nil {
		return nil, "", err
	}
	headerType, err := responseImageType(response.Header.Get("Content-Type"))
	if err != nil {
		return nil, "", err
	}
	detectedType, err := detectedImageType(data)
	if err != nil || detectedType != headerType {
		return nil, "", errors.New("remote response is not a supported image")
	}
	return data, detectedType, nil
}

func responseImageType(raw string) (string, error) {
	contentType, _, err := mime.ParseMediaType(raw)
	if err != nil {
		return "", errors.New("remote response has an invalid content type")
	}
	if _, ok := supportedImageTypes[contentType]; !ok {
		return "", errors.New("remote response is not a supported image")
	}
	return contentType, nil
}

func validateRemoteImageURL(ctx context.Context, rawURL string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || len(rawURL) > 2048 {
		return nil, errors.New("image URL must use HTTPS without credentials")
	}
	if err := rejectPrivateImageHost(ctx, u.Hostname()); err != nil {
		return nil, err
	}
	return u, nil
}

func rejectPrivateImageHost(ctx context.Context, hostname string) error {
	host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(hostname)), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return errors.New("image URL host is not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isPrivateImageIP(ip) {
			return errors.New("image URL host is not allowed")
		}
		return nil
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return errors.New("image URL host could not be resolved")
	}
	for _, ip := range ips {
		if isPrivateImageIP(ip) {
			return errors.New("image URL host is not allowed")
		}
	}
	return nil
}

func isPrivateImageIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast()
}

func secureImageDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("image URL host could not be resolved")
	}
	dialer := &net.Dialer{}
	var lastErr error
	for _, ip := range ips {
		if isPrivateImageIP(ip) {
			lastErr = errors.New("image URL host is not allowed")
			continue
		}
		connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = errors.New("image URL host could not be reached")
	}
	return nil, lastErr
}
func (h *Handler) finalizeMetadata(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TokenAddress    string `json:"token_address"`
		TransactionHash string `json:"transaction_hash"`
	}
	if e := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in); e != nil {
		writeError(w, 400, "invalid_request", "invalid JSON body")
		return
	}
	cleanAddress := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(in.TokenAddress)), "0x")
	if len(cleanAddress) != 40 {
		writeError(w, 400, "invalid_request", "valid token address and transaction hash are required")
		return
	}
	if _, e := hex.DecodeString(cleanAddress); e != nil || !transactionHashRE.MatchString(in.TransactionHash) {
		writeError(w, 400, "invalid_request", "valid token address and transaction hash are required")
		return
	}
	in.TokenAddress = "0x" + cleanAddress
	e := h.repo.FinalizeMetadata(r.Context(), h.chainID, chi.URLParam(r, "draft"), in.TokenAddress, in.TransactionHash)
	if errors.Is(e, ErrNotFound) {
		writeError(w, 409, "not_indexed", "confirmed token has not been indexed yet")
		return
	}
	if e != nil {
		h.internal(w, r, e)
		return
	}
	token, e := h.repo.Token(r.Context(), h.chainID, in.TokenAddress)
	if e != nil {
		h.internal(w, r, e)
		return
	}
	writeJSON(w, 200, token)
}
func (h *Handler) object(w http.ResponseWriter, r *http.Request) {
	if h.objects == nil {
		http.NotFound(w, r)
		return
	}
	key := chi.URLParam(r, "*")
	f, e := h.objects.Open(r.Context(), key)
	if e != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	if strings.HasSuffix(key, ".json") {
		w.Header().Set("Content-Type", "application/json")
	}
	_, _ = io.Copy(w, f)
}
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			var b [16]byte
			if _, e := rand.Read(b[:]); e == nil {
				id = hex.EncodeToString(b[:])
			} else {
				id = "unknown"
			}
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

type requestIDKey struct{}

func (h *Handler) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)
		h.logger.Info("http_request", "request_id", requestIDFrom(r.Context()), "method", r.Method, "path", r.URL.Path, "status", ww.status, "duration_ms", time.Since(start).Milliseconds())
	})
}
func requestIDFrom(ctx context.Context) string { v, _ := ctx.Value(requestIDKey{}).(string); return v }

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(s int) { w.status = s; w.ResponseWriter.WriteHeader(s) }
func timeoutMiddleware(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.TimeoutHandler(next, d, `{"error":{"code":"timeout","message":"request timed out"}}`)
	}
}
func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"status": "ok", "service": "cooket-api", "request_id": requestIDFrom(r.Context())})
}
func (h *Handler) ready(w http.ResponseWriter, r *http.Request) {
	if e := h.repo.Ping(r.Context()); e != nil {
		writeError(w, 503, "not_ready", "database is unavailable")
		return
	}
	writeJSON(w, 200, map[string]any{"status": "ready", "service": "cooket-api", "request_id": requestIDFrom(r.Context())})
}
func (h *Handler) tokens(w http.ResponseWriter, r *http.Request) {
	limit, cursor, e := pagination(r)
	if e != nil {
		writeError(w, 400, "invalid_request", e.Error())
		return
	}
	search := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
	if len([]byte(search)) > 64 || (search != "" && !regexp.MustCompile(`^[a-z0-9 _.-]+$`).MatchString(search)) {
		writeError(w, 400, "invalid_request", "search must be at most 64 characters and use letters, numbers, spaces, dots, underscores, or hyphens")
		return
	}
	var out Page
	if search == "" {
		out, e = h.repo.ListTokens(r.Context(), h.chainID, limit, cursor)
	} else {
		out, e = h.repo.SearchTokens(r.Context(), h.chainID, search, limit, cursor)
	}
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}
func (h *Handler) trending(w http.ResponseWriter, r *http.Request) {
	limit, cursor, e := pagination(r)
	if e != nil {
		writeError(w, 400, "invalid_request", e.Error())
		return
	}
	out, e := h.repo.TrendingTokens(r.Context(), h.chainID, limit, cursor)
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}
func (h *Handler) token(w http.ResponseWriter, r *http.Request) {
	a, e := addressParam(r, "address")
	if e != nil {
		writeError(w, 400, "invalid_address", e.Error())
		return
	}
	out, e := h.repo.Token(r.Context(), h.chainID, a)
	if errors.Is(e, ErrNotFound) {
		writeError(w, 404, "not_found", "token not found")
		return
	}
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}
func (h *Handler) pricing(w http.ResponseWriter, r *http.Request) {
	a, e := addressParam(r, "address")
	if e != nil {
		writeError(w, 400, "invalid_address", e.Error())
		return
	}
	t, e := h.repo.Token(r.Context(), h.chainID, a)
	if errors.Is(e, ErrNotFound) {
		writeError(w, 404, "not_found", "token not found")
		return
	}
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	source := "indexed_v3_curve"
	if t.Graduation != nil && t.Graduation.Phase == "graduated" && t.LatestTradeSource != nil && *t.LatestTradeSource == "uniswap_v3" {
		source = "indexed_v3_market"
	}
	writeJSON(w, 200, Pricing{TokenAddress: t.Address, CurrentPrice: t.Metrics.CurrentPrice, FullyDilutedValue: t.Metrics.FullyDilutedValue, Source: source})
}
func (h *Handler) chart(w http.ResponseWriter, r *http.Request) {
	a, e := addressParam(r, "address")
	if e != nil {
		writeError(w, 400, "invalid_address", e.Error())
		return
	}
	interval := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("interval")))
	if interval == "" {
		interval = "1h"
	}
	if _, ok := parseChartInterval(interval); !ok {
		writeError(w, 400, "invalid_interval", "interval must be one of 1m, 5m, 15m, 1h, 4h, 1d, or 1w")
		return
	}
	limit := 168
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, e = strconv.Atoi(raw)
		if e != nil || limit < 1 || limit > 1000 {
			writeError(w, 400, "invalid_request", "limit must be between 1 and 1000")
			return
		}
	}
	out, e := h.repo.Chart(r.Context(), h.chainID, a, interval, limit)
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}

func optionalPublicURL(raw string, allowedHosts []string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if len(value) > 2048 {
		return "", errors.New("URL is too long")
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("invalid public URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if len(allowedHosts) > 0 {
		allowed := false
		for _, candidate := range allowedHosts {
			if host == candidate || strings.HasSuffix(host, "."+candidate) {
				allowed = true
				break
			}
		}
		if !allowed {
			return "", errors.New("unexpected URL host")
		}
	}
	return parsed.String(), nil
}
func (h *Handler) creatorTokens(w http.ResponseWriter, r *http.Request) {
	a, e := addressParam(r, "address")
	if e != nil {
		writeError(w, 400, "invalid_address", e.Error())
		return
	}
	limit, cursor, e := pagination(r)
	if e != nil {
		writeError(w, 400, "invalid_request", e.Error())
		return
	}
	out, e := h.repo.CreatorTokens(r.Context(), h.chainID, a, limit, cursor)
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}
func (h *Handler) creator(w http.ResponseWriter, r *http.Request) {
	a, e := addressParam(r, "address")
	if e != nil {
		writeError(w, 400, "invalid_address", e.Error())
		return
	}
	limit, cursor, e := pagination(r)
	if e != nil {
		writeError(w, 400, "invalid_request", e.Error())
		return
	}
	out, e := h.repo.Creator(r.Context(), h.chainID, a, limit, cursor)
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}
func (h *Handler) trades(w http.ResponseWriter, r *http.Request) {
	a, e := addressParam(r, "address")
	if e != nil {
		writeError(w, 400, "invalid_address", e.Error())
		return
	}
	limit, cursor, e := pagination(r)
	if e != nil {
		writeError(w, 400, "invalid_request", e.Error())
		return
	}
	out, e := h.repo.Trades(r.Context(), h.chainID, a, limit, cursor)
	if e != nil {
		h.repositoryError(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}
func (h *Handler) activity(w http.ResponseWriter, r *http.Request) {
	a, e := addressParam(r, "address")
	if e != nil {
		writeError(w, 400, "invalid_address", e.Error())
		return
	}
	limit, cursor, e := pagination(r)
	if e != nil {
		writeError(w, 400, "invalid_request", e.Error())
		return
	}
	out, e := h.repo.Activity(r.Context(), h.chainID, a, limit, cursor)
	if e != nil {
		h.internal(w, r, e)
		return
	}
	writeJSON(w, 200, out)
}
func pagination(r *http.Request) (int, string, error) {
	limit := 20
	if s := r.URL.Query().Get("limit"); s != "" {
		n, e := strconv.Atoi(s)
		if e != nil || n < 1 || n > 100 {
			return 0, "", errors.New("limit must be between 1 and 100")
		}
		limit = n
	}
	cursor := r.URL.Query().Get("cursor")
	if cursor != "" && !validOpaqueCursor(cursor) {
		return 0, "", errors.New("cursor is invalid")
	}
	return limit, cursor, nil
}
func validOpaqueCursor(raw string) bool {
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil {
		return false
	}
	var c pageCursor
	if json.Unmarshal(b, &c) != nil || c.BlockNumber < 0 {
		return false
	}
	switch c.Kind {
	case "tokens", "creator", "search":
		_, e := decodeCursor(raw, c.Kind)
		return e == nil
	case "trending":
		_, e := decodeCursor(raw, c.Kind)
		return e == nil
	case "trades", "activity":
		_, e := decodeCursor(raw, c.Kind)
		return e == nil
	case "cto_proposals", "cto_checkpoints", "cto_transfers", "cto_fee_pulls":
		_, e := decodeCursor(raw, c.Kind)
		return e == nil
	default:
		return false
	}
}
func addressParam(r *http.Request, name string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(chi.URLParam(r, name)))
	if strings.HasPrefix(s, "0x") {
		s = s[2:]
	}
	if len(s) != 40 {
		return "", errors.New("address must be a 20-byte hexadecimal address")
	}
	if _, err := hex.DecodeString(s); err != nil {
		return "", errors.New("address must be a 20-byte hexadecimal address")
	}
	return "0x" + s, nil
}
func (h *Handler) internal(w http.ResponseWriter, r *http.Request, e error) {
	h.logger.Error("api_error", "request_id", requestIDFrom(r.Context()), "error", e.Error())
	writeError(w, 500, "internal_error", "internal server error")
}
func (h *Handler) repositoryError(w http.ResponseWriter, r *http.Request, e error) {
	if errors.Is(e, ErrInvalidCursor) {
		writeError(w, 400, "invalid_request", "cursor is invalid")
		return
	}
	if errors.Is(e, ErrInconsistentAccounting) {
		writeError(w, 500, "inconsistent_accounting", "checkpoint claimed amount exceeds checkpointed amount")
		return
	}
	h.internal(w, r, e)
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeIndexedJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Cache-Control", "public, max-age=5, must-revalidate")
	writeJSON(w, status, v)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
