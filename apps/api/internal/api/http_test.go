package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

type fakeRepo struct {
	pingErr        error
	tokens         Page
	token          Token
	tokenErr       error
	listErr        error
	calls          int
	chartIntervals []string
	ctoStatus      *CTOStatus
	ctoProposal    CTOProposal
	ctoProposals   CTOProposalPage
	ctoTreasury    CTOTreasury
	ctoTransfers   CTOTreasuryTransferPage
	ctoFeePulls    CTOFeePullPage
	ctoCheckpoints CTOCheckpointPage
	ctoErr         error
}

type fakeETHUSDReader struct {
	price ETHUSDPrice
	err   error
}

type memoryObjectStore struct{ objects map[string][]byte }

func (s *memoryObjectStore) Put(_ context.Context, key string, reader io.Reader) error {
	if s.objects == nil {
		s.objects = map[string][]byte{}
	}
	data, err := io.ReadAll(reader)
	if err == nil {
		s.objects[key] = data
	}
	return err
}
func (s *memoryObjectStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(s.objects[key])), nil
}

func (f fakeETHUSDReader) Read(context.Context) (ETHUSDPrice, error) { return f.price, f.err }

func (f *fakeRepo) Ping(context.Context) error { return f.pingErr }
func (f *fakeRepo) ListTokens(context.Context, int64, int, string) (Page, error) {
	f.calls++
	return f.tokens, f.listErr
}
func (f *fakeRepo) SearchTokens(context.Context, int64, string, int, string) (Page, error) {
	return f.tokens, f.listErr
}
func (f *fakeRepo) TrendingTokens(context.Context, int64, int, string) (Page, error) {
	return Page{Items: []Token{}}, nil
}
func (f *fakeRepo) Token(context.Context, int64, string) (Token, error) { return f.token, f.tokenErr }
func (f *fakeRepo) CreatorTokens(context.Context, int64, string, int, string) (Page, error) {
	return Page{Items: []Token{}}, nil
}
func (f *fakeRepo) Creator(context.Context, int64, string, int, string) (CreatorProfile, error) {
	return CreatorProfile{Tokens: []Token{}}, nil
}
func (f *fakeRepo) Trades(context.Context, int64, string, int, string) (TradePage, error) {
	return TradePage{Items: []Trade{}}, nil
}
func (f *fakeRepo) Activity(context.Context, int64, string, int, string) (ActivityPage, error) {
	return ActivityPage{Items: []Activity{}}, nil
}
func (f *fakeRepo) Chart(_ context.Context, _ int64, _ string, interval string, _ int) (ChartPage, error) {
	f.chartIntervals = append(f.chartIntervals, interval)
	return ChartPage{Interval: interval, SupportedIntervals: append([]string(nil), supportedChartIntervals...), Candles: []ChartPoint{}}, nil
}
func (f *fakeRepo) SaveMetadataDraft(context.Context, MetadataDraft) error                { return nil }
func (f *fakeRepo) FinalizeMetadata(context.Context, int64, string, string, string) error { return nil }
func (f *fakeRepo) CTOStatus(_ context.Context, chain int64, token string) (CTOStatus, error) {
	if f.tokenErr != nil {
		return CTOStatus{}, f.tokenErr
	}
	if f.ctoStatus != nil {
		return *f.ctoStatus, f.ctoErr
	}
	return CTOStatus{ChainID: chain, Token: token, Active: false}, f.ctoErr
}
func (f *fakeRepo) CTOProposals(context.Context, int64, string, int, string) (CTOProposalPage, error) {
	if f.tokenErr != nil {
		return CTOProposalPage{}, f.tokenErr
	}
	if f.ctoProposals.Items == nil {
		return CTOProposalPage{Items: []CTOProposal{}}, f.ctoErr
	}
	return f.ctoProposals, f.ctoErr
}
func (f *fakeRepo) CTOProposal(context.Context, int64, string) (CTOProposal, error) {
	if f.ctoErr != nil {
		return CTOProposal{}, f.ctoErr
	}
	return f.ctoProposal, nil
}
func (f *fakeRepo) CTOTreasury(context.Context, int64, string, int) (CTOTreasury, error) {
	if f.ctoErr != nil {
		return CTOTreasury{}, f.ctoErr
	}
	return f.ctoTreasury, nil
}
func (f *fakeRepo) CTOTreasuryTransfers(context.Context, int64, string, int, string) (CTOTreasuryTransferPage, error) {
	if f.ctoErr != nil {
		return CTOTreasuryTransferPage{}, f.ctoErr
	}
	if f.ctoTransfers.Items == nil {
		return CTOTreasuryTransferPage{Items: []CTOTreasuryTransfer{}}, nil
	}
	return f.ctoTransfers, nil
}
func (f *fakeRepo) CTOTreasuryFeePulls(context.Context, int64, string, int, string) (CTOFeePullPage, error) {
	if f.ctoErr != nil {
		return CTOFeePullPage{}, f.ctoErr
	}
	if f.ctoFeePulls.Items == nil {
		return CTOFeePullPage{Items: []CTOFeePull{}}, nil
	}
	return f.ctoFeePulls, nil
}
func (f *fakeRepo) CTOCheckpoints(context.Context, int64, string, int, string) (CTOCheckpointPage, error) {
	if f.tokenErr != nil {
		return CTOCheckpointPage{}, f.tokenErr
	}
	if f.ctoErr != nil {
		return CTOCheckpointPage{}, f.ctoErr
	}
	if f.ctoCheckpoints.Items == nil {
		return CTOCheckpointPage{Token: "", Aggregates: []CTOCheckpointAggregate{}, Items: []CTOCheckpointEvent{}}, nil
	}
	return f.ctoCheckpoints, nil
}
func testHandler(repo Repository) http.Handler {
	return NewHandler(repo, 5042002, time.Second, slog.New(slog.NewJSONHandler(io.Discard, nil)))
}

func TestETHUSDPriceEndpoint(t *testing.T) {
	repo := &fakeRepo{}
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	price := ETHUSDPrice{Price: "2500.12345678", PriceDecimals: 8, UpdatedAt: time.Unix(2_000_000_000, 0).UTC(), Feed: BaseSepoliaETHUSDFeed, Source: "chainlink_eth_usd", MaxAgeSeconds: 3600}
	handler := NewHandlerWithDependencies(repo, 5042002, time.Second, logger, nil, fakeETHUSDReader{price: price})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/prices/eth-usd", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"price":"2500.12345678"`) || !strings.Contains(w.Body.String(), `"source":"chainlink_eth_usd"`) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d headers=%v body=%s", w.Code, w.Header(), w.Body.String())
	}

	handler = NewHandlerWithDependencies(repo, 5042002, time.Second, logger, nil, fakeETHUSDReader{err: errors.New("RPC secret")})
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/prices/eth-usd", nil))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), `"code":"oracle_unavailable"`) || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
func TestHealthAndReadiness(t *testing.T) {
	r := testHandler(&fakeRepo{pingErr: errors.New("database down")})
	for _, tc := range []struct {
		path   string
		status int
	}{{"/health", 200}, {"/readyz", 503}} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != tc.status {
			t.Fatalf("%s status=%d", tc.path, w.Code)
		}
	}
}

func TestCORSUsesExplicitAllowlistWithoutCredentials(t *testing.T) {
	origins, err := ParseAllowedOrigins("https://cooket.fun, https://preview.example")
	if err != nil || len(origins) != 2 {
		t.Fatalf("origins=%v err=%v", origins, err)
	}
	handler := CORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }), origins)
	allowed := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/health", nil)
	req.Header.Set("Origin", "https://cooket.fun")
	handler.ServeHTTP(allowed, req)
	if allowed.Code != http.StatusNoContent || allowed.Header().Get("Access-Control-Allow-Origin") != "https://cooket.fun" || allowed.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("allowed=%d headers=%v", allowed.Code, allowed.Header())
	}
	rejected := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodOptions, "/health", nil)
	req.Header.Set("Origin", "https://untrusted.example")
	handler.ServeHTTP(rejected, req)
	if rejected.Code != http.StatusForbidden {
		t.Fatalf("rejected=%d", rejected.Code)
	}
}

func TestParseAllowedOrigins(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{name: "HTTPS production", raw: "https://cooket.fun", want: []string{"https://cooket.fun"}},
		{name: "localhost HTTP", raw: "http://localhost:3200", want: []string{"http://localhost:3200"}},
		{name: "IPv4 loopback HTTP", raw: "http://127.0.0.1:3200", want: []string{"http://127.0.0.1:3200"}},
		{name: "IPv6 loopback HTTP", raw: "http://[::1]:3200", want: []string{"http://[::1]:3200"}},
		{name: "localhost subdomain HTTP", raw: "http://app.localhost:3200", want: []string{"http://app.localhost:3200"}},
		{name: "canonical duplicates", raw: "HTTPS://COOKET.FUN, https://cooket.fun", want: []string{"https://cooket.fun"}},
		{name: "public HTTP", raw: "http://cooket.fun", want: nil},
		{name: "wildcard", raw: "https://*.cooket.fun", want: nil},
		{name: "credentials", raw: "https://user:password@cooket.fun", want: nil},
		{name: "path", raw: "https://cooket.fun/path", want: nil},
		{name: "query", raw: "https://cooket.fun?source=test", want: nil},
		{name: "fragment", raw: "https://cooket.fun#top", want: nil},
		{name: "empty", raw: "", want: nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseAllowedOrigins(test.raw)
			if test.want == nil {
				if err == nil {
					t.Fatalf("accepted invalid origin %q: %v", test.raw, got)
				}
				return
			}
			if err != nil || !reflect.DeepEqual(got, test.want) {
				t.Fatalf("ParseAllowedOrigins(%q) = %v, %v; want %v, nil", test.raw, got, err, test.want)
			}
		})
	}
}
func TestRequestIDValidationAndErrors(t *testing.T) {
	r := testHandler(&fakeRepo{})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tokens/0x123", nil)
	req.Header.Set("X-Request-ID", "req-test")
	r.ServeHTTP(w, req)
	if w.Code != 400 || w.Header().Get("X-Request-ID") != "req-test" {
		t.Fatalf("status=%d request_id=%q", w.Code, w.Header().Get("X-Request-ID"))
	}
	if !strings.Contains(w.Body.String(), `"code":"invalid_address"`) {
		t.Fatalf("body=%s", w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?limit=101", nil))
	if w.Code != 400 {
		t.Fatalf("limit status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?cursor=bad", nil))
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("cursor status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r = testHandler(&fakeRepo{listErr: errors.New("secret database detail")})
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens", nil))
	if w.Code != 500 || !strings.Contains(w.Body.String(), `"code":"internal_error"`) || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("internal status=%d body=%s", w.Code, w.Body.String())
	}
}
func TestTokenListEmptyAndDetailNotFound(t *testing.T) {
	r := testHandler(&fakeRepo{tokens: Page{Items: []Token{}}})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?limit=2", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r = testHandler(&fakeRepo{tokenErr: ErrNotFound})
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/0x0000000000000000000000000000000000000001", nil))
	if w.Code != 404 || !strings.Contains(w.Body.String(), `"code":"not_found"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
func TestTokenSearchAndV3PricingResponse(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	price, fdv := "7", "7000"
	r := testHandler(&fakeRepo{tokens: Page{Items: []Token{}}, token: Token{Address: address, Metrics: Metrics{CurrentPrice: &price, FullyDilutedValue: &fdv}}})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?search=Cooket", nil))
	if w.Code != 200 {
		t.Fatalf("search status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?search=%3Cscript%3E", nil))
	if w.Code != 400 {
		t.Fatalf("unsafe search status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/pricing", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"current_price":"7"`) || !strings.Contains(w.Body.String(), `"fully_diluted_value":"7000"`) || !strings.Contains(w.Body.String(), `"source":"indexed_v3_curve"`) || strings.Contains(w.Body.String(), "market_cap") || strings.Contains(w.Body.String(), "reserve_balance") {
		t.Fatalf("pricing=%s", w.Body.String())
	}

	market := "uniswap_v3"
	r = testHandler(&fakeRepo{token: Token{Address: address, Metrics: Metrics{CurrentPrice: &price, FullyDilutedValue: &fdv}, Graduation: &Graduation{Phase: "graduated"}, LatestTradeSource: &market}})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/pricing", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"current_price":"7"`) || !strings.Contains(w.Body.String(), `"fully_diluted_value":"7000"`) || !strings.Contains(w.Body.String(), `"source":"indexed_v3_market"`) {
		t.Fatalf("market pricing=%s", w.Body.String())
	}

	r = testHandler(&fakeRepo{token: Token{Address: address, Metrics: Metrics{CurrentPrice: &price, FullyDilutedValue: &fdv}, LatestTradeSource: &market}})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/pricing", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"source":"indexed_v3_curve"`) {
		t.Fatalf("active pricing was incorrectly labeled market=%s", w.Body.String())
	}
}

func TestChartSupportsEveryCanonicalIntervalAndRejectsInvalidInterval(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	repo := &fakeRepo{}
	r := testHandler(repo)
	for _, interval := range supportedChartIntervals {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/chart?interval="+interval, nil))
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"interval":"`+interval+`"`) || !strings.Contains(w.Body.String(), `"candles":[]`) {
			t.Fatalf("interval=%s status=%d body=%s", interval, w.Code, w.Body.String())
		}
	}
	if len(repo.chartIntervals) != len(supportedChartIntervals) {
		t.Fatalf("chart calls=%v", repo.chartIntervals)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/chart?interval=2h", nil))
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"code":"invalid_interval"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestOptionalPublicURLValidation(t *testing.T) {
	for _, tc := range []struct {
		value string
		hosts []string
		ok    bool
	}{
		{"", nil, true},
		{"https://cooket.fun/about", nil, true},
		{"https://x.com/cooket", []string{"x.com", "twitter.com"}, true},
		{"https://example.com/cooket", []string{"x.com", "twitter.com"}, false},
		{"javascript:alert(1)", nil, false},
		{"https://user:pass@x.com/cooket", []string{"x.com"}, false},
	} {
		_, err := optionalPublicURL(tc.value, tc.hosts)
		if (err == nil) != tc.ok {
			t.Fatalf("value=%q err=%v", tc.value, err)
		}
	}
}

func TestMetadataUploadAcceptsOnlyOneImageSourceAndPersistsFetchedBytes(t *testing.T) {
	objects := &memoryObjectStore{}
	fetches := []string{}
	fetcher := func(_ context.Context, imageURL string) ([]byte, string, error) {
		fetches = append(fetches, imageURL)
		return []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, "image/png", nil
	}
	handler := newHandler(&fakeRepo{}, 5042002, time.Second, slog.New(slog.NewJSONHandler(io.Discard, nil)), objects, nil, fetcher)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, value := range map[string]string{"name": "Cooket", "symbol": "ZK", "initial_supply": "1000", "image_url": "https://images.example/token"} {
		_ = writer.WriteField(key, value)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/token-metadata", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusCreated || len(fetches) != 1 || len(objects.objects) != 2 || strings.Contains(w.Body.String(), "images.example") {
		t.Fatalf("status=%d fetches=%v objects=%v body=%s", w.Code, fetches, objects.objects, w.Body.String())
	}

	body = &bytes.Buffer{}
	writer = multipart.NewWriter(body)
	for key, value := range map[string]string{"name": "Cooket", "symbol": "ZK", "initial_supply": "1000", "image_url": "https://images.example/token"} {
		_ = writer.WriteField(key, value)
	}
	part, err := writer.CreateFormFile("image", "token.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("file"))
	_ = writer.Close()
	req = httptest.NewRequest(http.MethodPost, "/api/v1/token-metadata", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "not both") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestRemoteImageSSRFAndResponseBoundaries(t *testing.T) {
	for _, raw := range []string{"http://example.com/image.png", "https://localhost/image.png", "https://127.0.0.1/image.png", "https://10.0.0.1/image.png", "https://169.254.169.254/image.png"} {
		if _, err := validateRemoteImageURL(context.Background(), raw); err == nil {
			t.Fatalf("expected URL rejection for %s", raw)
		}
	}
	if _, err := validateRemoteImageURL(context.Background(), "https://user:pass@example.com/image.png"); err == nil {
		t.Fatal("expected credentials rejection")
	}
	if _, err := responseImageType("text/html"); err == nil {
		t.Fatal("expected HTML rejection")
	}
	if _, err := readImageBytes(bytes.NewReader(bytes.Repeat([]byte{1}, maxImageBytes+1))); err == nil {
		t.Fatal("expected oversized response rejection")
	}
	if _, err := detectedImageType([]byte("<html>")); err == nil {
		t.Fatal("expected non-image rejection")
	}
	if _, err := validateRemoteImageURL(context.Background(), "https://127.0.0.1/redirect"); err == nil {
		t.Fatal("expected redirect target rejection")
	}
}

func TestTokenDetailReturnsIndexedTokenAndSafeRepositoryError(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	indexed := Token{Address: address, Creator: "0x0000000000000000000000000000000000000002", Name: "Cooket", Symbol: "ZK", InitialSupply: "1000", Description: "Indexed metadata", Metrics: Metrics{Volume: "0", Fees: "0"}}
	r := testHandler(&fakeRepo{token: indexed})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address, nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"description":"Indexed metadata"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	r = testHandler(&fakeRepo{tokenErr: errors.New("private database failure")})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address, nil))
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), `"code":"internal_error"`) || strings.Contains(w.Body.String(), "private") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestTokenDetailOmitsAbsentGraduationSettlementValues(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	indexed := Token{Address: address, Creator: "0x0000000000000000000000000000000000000002", Name: "Cooket", Symbol: "ZK", InitialSupply: "1000", Metrics: Metrics{Volume: "0", Fees: "0"}, Graduation: &Graduation{Phase: "graduated", TokenAmount: "200", NativeUsdcAmount: "3", SoldSupply: "800"}}
	r := testHandler(&fakeRepo{token: indexed})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address, nil))
	body := w.Body.String()
	if w.Code != http.StatusOK || !strings.Contains(body, `"phase":"graduated"`) || !strings.Contains(body, `"native_usdc_amount":"3"`) || strings.Contains(body, `"eth_amount"`) || strings.Contains(body, `"liquidity":"0"`) || strings.Contains(body, `"position_token_id":"0"`) || strings.Contains(body, `"liquidity_amount":"0"`) || strings.Contains(body, `"lock_id":"0"`) {
		t.Fatalf("status=%d body=%s", w.Code, body)
	}
}
