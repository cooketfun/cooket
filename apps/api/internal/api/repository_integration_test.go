package api

import (
	"context"
	"math/big"
	"strings"
	"testing"
	"time"
)

func TestPostgresRepositoryRejectsUnpreparedSchema(t *testing.T) {
	url := integrationDatabaseURL(t, "UNPREPARED_TEST_DATABASE_URL")
	repo, err := NewPostgresRepository(context.Background(), url)
	if err == nil {
		repo.Close()
		t.Fatal("API accepted an unprepared schema")
	}
	if !strings.Contains(err.Error(), "db/migrate.sh") {
		t.Fatalf("unexpected schema error: %v", err)
	}
}

func TestPostgresChartAggregatesExactCanonicalTradesAtUTCBoundaries(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	ctx := context.Background()
	repo, err := NewPostgresRepository(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	const chain int64 = 84532
	const token = "0x0000000000000000000000000000000000000c01"
	const firstBlock int64 = 499999900
	timestamps := []int64{
		time.Date(2026, 8, 9, 23, 59, 59, 0, time.UTC).Unix(),
		time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC).Unix(),
		time.Date(2026, 8, 10, 0, 0, 30, 0, time.UTC).Unix(),
		time.Date(2026, 8, 10, 0, 1, 0, 0, time.UTC).Unix(),
	}
	sides := []string{"buy", "buy", "buy", "sell"}
	tokenAmounts := []string{"1000000000000000000", "2000000000000000000", "3000000000000000000", "1000000000000000000"}
	curveValues := []string{"1000000000000000", "2000000000000000", "4000000000000000", "1000000000000000"}
	blockHashes := make([]string, len(timestamps))
	defer func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM trades WHERE chain_id=$1 AND lower(token_address)=lower($2)`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3`, chain, firstBlock, firstBlock+int64(len(timestamps))-1)
	}()
	for i, timestamp := range timestamps {
		blockHashes[i] = "0x" + strings.Repeat(string(rune('1'+i)), 64)
		txHash := "0x" + strings.Repeat(string(rune('5'+i)), 64)
		if _, err = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,'0xparent',$4)`, chain, firstBlock+int64(i), blockHashes[i], timestamp); err != nil {
			t.Fatal(err)
		}
		trader := "0x0000000000000000000000000000000000000c0" + string(rune('2'+i))
		if _, err = repo.pool.Exec(ctx, `INSERT INTO trades(chain_id,token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,$6,0,0,$7,$8,$9,0)`, chain, token, trader, sides[i], tokenAmounts[i], curveValues[i], firstBlock+int64(i), blockHashes[i], txHash); err != nil {
			t.Fatal(err)
		}
	}

	for _, interval := range supportedChartIntervals {
		chart, chartErr := repo.Chart(ctx, chain, token, interval, 100)
		if chartErr != nil || chart.Interval != interval || len(chart.SupportedIntervals) != len(supportedChartIntervals) || len(chart.Candles) == 0 {
			t.Fatalf("interval=%s chart=%+v err=%v", interval, chart, chartErr)
		}
		spec, _ := parseChartInterval(interval)
		for _, candle := range chart.Candles {
			if spec.weekly {
				if time.Unix(candle.BucketStart, 0).UTC().Weekday() != time.Monday || time.Unix(candle.BucketStart, 0).UTC().Hour() != 0 {
					t.Fatalf("interval=%s bucket=%s is not Monday 00:00 UTC", interval, time.Unix(candle.BucketStart, 0).UTC())
				}
			} else if candle.BucketStart%spec.seconds != 0 {
				t.Fatalf("interval=%s bucket=%d is not UTC aligned", interval, candle.BucketStart)
			}
		}
	}

	minute, err := repo.Chart(ctx, chain, token, "1m", 100)
	if err != nil {
		t.Fatal(err)
	}
	bucketStart := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC).Unix()
	var candle *ChartPoint
	for i := range minute.Candles {
		if minute.Candles[i].BucketStart == bucketStart {
			candle = &minute.Candles[i]
		}
	}
	if candle == nil {
		t.Fatalf("missing 1m UTC boundary bucket: %+v", minute.Candles)
	}
	from, to := bucketStart, bucketStart+60
	ranged, err := repo.ChartRange(ctx, chain, token, "1m", &from, &to, 10)
	if err != nil || len(ranged.Candles) != 1 || ranged.Candles[0].BucketStart != bucketStart {
		t.Fatalf("exact [from,to) range=%+v err=%v", ranged.Candles, err)
	}
	open := exactCurvePrice(t, "3000000000000000000", "3000000000000000")
	closePrice := exactCurvePrice(t, "6000000000000000000", "7000000000000000")
	if candle.TradeCount != 2 || candle.BuyCount != 2 || candle.SellCount != 0 || candle.Volume != "6000000000000000" || candle.UniqueTraderCount != 2 || candle.OpenPrice == nil || *candle.OpenPrice != open || candle.ClosePrice == nil || *candle.ClosePrice != closePrice || candle.HighPrice == nil || *candle.HighPrice != closePrice || candle.LowPrice == nil || *candle.LowPrice != open {
		t.Fatalf("unexpected exact 1m OHLCV: %+v want open=%s close=%s", candle, open, closePrice)
	}
	weekly, err := repo.Chart(ctx, chain, token, "1w", 100)
	if err != nil || len(weekly.Candles) != 2 || weekly.Candles[0].BucketStart != time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC).Unix() || weekly.Candles[1].BucketStart != time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC).Unix() {
		t.Fatalf("weekly UTC buckets=%+v err=%v", weekly.Candles, err)
	}
}

func TestPostgresVolumeAggregatesCurveAndV3InCanonical18Decimals(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	ctx := context.Background()
	repo, err := NewPostgresRepository(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	const chain int64 = 84532
	const token = "0x821aB8590e26ef7Af412fA92D75375AB4Fa58CB7"
	const creator = "0x0000000000000000000000000000000000000c12"
	const block = int64(499999911)
	const blockHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc11"
	cleanup := func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM trades WHERE chain_id=$1 AND lower(token_address)=lower($2)`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_metrics WHERE chain_id=$1 AND lower(token_address)=lower($2)`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND lower(token_address)=lower($2)`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
	}
	cleanup()
	defer cleanup()
	if _, err = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,'0xparent',1700000000)`, chain, block, blockHash); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'Volume API','VAPI',1000,'endpoint-cp-v3',$4,$5,$6,0)`, chain, token, creator, block, blockHash, "0x"+strings.Repeat("c", 63)+"1"); err != nil {
		t.Fatal(err)
	}
	for index, trade := range []struct{ side, reserve, curveValue, source string }{
		{"buy", "100000000000000000000", "100000000000000000000", "curve"},
		{"buy", "500000000", "500000000", "uniswap_v3"},
		{"sell", "250000000", "250000000", "uniswap_v3"},
	} {
		txHash := "0x" + strings.Repeat(string(rune('7'+index)), 64)
		tradeToken := token
		if trade.source == "uniswap_v3" {
			tradeToken = strings.ToLower(token)
		}
		if _, err = repo.pool.Exec(ctx, `INSERT INTO trades(chain_id,token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,source,transaction_index,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,1,$5,$6,0,0,$7,$8,$9,$10,$11,$8)`, chain, tradeToken, creator, trade.side, trade.reserve, trade.curveValue, trade.source, index, block, blockHash, txHash); err != nil {
			t.Fatal(err)
		}
	}
	tradePage, err := repo.Trades(ctx, chain, token, 10, "")
	if err != nil || len(tradePage.Items) != 3 {
		t.Fatalf("trades=%+v err=%v", tradePage, err)
	}
	for _, trade := range tradePage.Items {
		if trade.BlockTimestamp == nil || *trade.BlockTimestamp != 1700000000 {
			t.Fatalf("trade time=%+v", trade)
		}
	}
	chart, err := repo.Chart(ctx, chain, token, "1h", 10)
	if err != nil || len(chart.Candles) != 1 || chart.Candles[0].Volume != "850000000000000000000" || chart.Candles[0].BuyCount != 2 || chart.Candles[0].SellCount != 1 {
		t.Fatalf("chart=%+v err=%v", chart, err)
	}
	profile, err := repo.Creator(ctx, chain, creator, 10, "")
	if err != nil || profile.Volume != "850000000000000000000" {
		t.Fatalf("creator=%+v err=%v", profile, err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO token_metrics(chain_id,token_address,trade_count,buy_count,sell_count,volume,block_number,block_hash) VALUES($1,$2,3,2,1,850000000000000000000,$3,$4),($1,$5,1,1,0,1,$3,$4)`, chain, token, block, blockHash, strings.ToLower(token)); err != nil {
		t.Fatal(err)
	}
	detail, err := repo.Token(ctx, chain, strings.ToLower(token))
	if err != nil || detail.Address != token || detail.Metrics.Volume != "850000000000000000000" || detail.CreatedAt.BlockTimestamp == nil || *detail.CreatedAt.BlockTimestamp != 1700000000 {
		t.Fatalf("case-insensitive token detail=%+v err=%v", detail, err)
	}
	page, err := repo.ListTokens(ctx, chain, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	identities := 0
	for _, item := range page.Items {
		if strings.EqualFold(item.Address, token) {
			identities++
		}
	}
	if identities != 1 {
		t.Fatalf("case variants produced %d API token identities: %+v", identities, page.Items)
	}
}

func exactCurvePrice(t *testing.T, soldSupply, reserveBalance string) string {
	t.Helper()
	unit := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	virtual, ok := new(big.Int).SetString("1066666666666666666666666667", 10)
	if !ok {
		t.Fatal("invalid virtual supply fixture")
	}
	sold, _ := new(big.Int).SetString(soldSupply, 10)
	reserve, _ := new(big.Int).SetString(reserveBalance, 10)
	numerator := new(big.Int).Mul(new(big.Int).Add(unit, reserve), unit)
	denominator := new(big.Int).Sub(virtual, sold)
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(numerator, denominator, remainder)
	if remainder.Sign() != 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	return quotient.String()
}

func TestApplicationTokenExclusionHidesReplayedTokenWithoutAffectingAnotherToken(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	ctx := context.Background()
	repo, err := NewPostgresRepository(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	const chain int64 = 8453
	const excluded = "0xec2710a9df34b66b07bf96933d13b76e1d526c07"
	const other = "0x00000000000000000000000000000000000000aa"
	const creator = "0x00000000000000000000000000000000000000bb"
	const blockHash = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	cleanup := func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM application_token_exclusions WHERE chain_id=$1 AND token_address=$2`, chain, excluded)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND lower(token_address) IN ($2,$3)`, chain, excluded, other)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
	}
	cleanup()
	defer cleanup()
	if _, err = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,500000100,$2,'0xparent',0)`, chain, blockHash); err != nil {
		t.Fatal(err)
	}
	for index, token := range []string{excluded, other} {
		if _, err = repo.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,1000,'endpoint-cp-v3',500000100,$6,$7,$8)`, chain, token, creator, "Visible fixture", "VIS", blockHash, "0x"+strings.Repeat(string(rune('a'+index)), 64), index); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO application_token_exclusions(chain_id,token_address,reason) VALUES($1,$2,'test replay exclusion')`, chain, excluded); err != nil {
		t.Fatal(err)
	}
	page, err := repo.ListTokens(ctx, chain, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range page.Items {
		if strings.EqualFold(token.Address, excluded) {
			t.Fatalf("excluded replayed token leaked into discovery: %+v", token)
		}
	}
	foundOther := false
	for _, token := range page.Items {
		foundOther = foundOther || strings.EqualFold(token.Address, other)
	}
	if !foundOther {
		t.Fatal("unrelated token was hidden by the narrow exclusion")
	}
	if _, err = repo.Token(ctx, chain, excluded); err != ErrNotFound {
		t.Fatalf("excluded detail err=%v want ErrNotFound", err)
	}
	profile, err := repo.Creator(ctx, chain, creator, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if profile.TokenCount != 1 || len(profile.Tokens) != 1 || !strings.EqualFold(profile.Tokens[0].Address, other) {
		t.Fatalf("creator profile=%+v", profile)
	}
}

func TestPostgresMetadataFinalizeIsIdempotentAndProjectsIntoLists(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	ctx := context.Background()
	repo, err := NewPostgresRepository(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	const chain int64 = 84532
	const block int64 = 499999980
	const draftID = "live-finalize-regression"
	const token = "0x0000000000000000000000000000000000000f01"
	const creator = "0x0000000000000000000000000000000000000f02"
	const txHash = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01"
	const blockHash = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff02"
	cleanup := func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_metadata_drafts WHERE draft_id=$1`, draftID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND transaction_hash=$2`, chain, txHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
	}
	cleanup()
	defer cleanup()
	if _, err = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,'0xparent',0)`, chain, block, blockHash); err != nil {
		t.Fatal(err)
	}
	if err = repo.SaveMetadataDraft(ctx, MetadataDraft{ID: draftID, Name: "Cooket Live Test", Symbol: "ZLT", InitialSupply: "1000000000000000000000000000", Description: "live description", ImageURL: "/objects/live.png", MetadataURL: "/objects/live.json", WebsiteURL: "https://cooket.fun", XURL: "https://x.com/cooket"}); err != nil {
		t.Fatal(err)
	}
	if err = repo.FinalizeMetadata(ctx, chain, draftID, token, txHash); err != ErrNotFound {
		t.Fatalf("finalize before indexing error=%v", err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'Cooket Live Test','ZLT',1000000000000000000000000000,'endpoint-cp-v3',$4,$5,$6,7)`, chain, token, creator, block, blockHash, txHash); err != nil {
		t.Fatal(err)
	}
	if err = repo.FinalizeMetadata(ctx, chain, draftID, token, txHash); err != nil {
		t.Fatal(err)
	}
	if err = repo.FinalizeMetadata(ctx, chain, draftID, token, txHash); err != nil {
		t.Fatalf("repeated identical finalize was not idempotent: %v", err)
	}
	page, err := repo.ListTokens(ctx, chain, 100, "")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range page.Items {
		if strings.EqualFold(item.Address, token) {
			found = item.Description == "live description" && item.WebsiteURL == "https://cooket.fun" && item.XURL == "https://x.com/cooket"
		}
	}
	if !found {
		t.Fatalf("finalized V3 token absent or malformed in token list: %+v", page.Items)
	}
	profile, err := repo.Creator(ctx, chain, creator, 100, "")
	if err != nil || profile.TokenCount != 1 || len(profile.Tokens) != 1 || !strings.EqualFold(profile.Tokens[0].Address, token) {
		t.Fatalf("creator projection=%+v err=%v", profile, err)
	}
}

func TestPostgresCanonicalGraduationPairsCurveAndManagerEvidence(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	ctx := context.Background()
	repo, err := NewPostgresRepository(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	const chain int64 = 84532
	const block int64 = 499999970
	const token = "0x0000000000000000000000000000000000000e01"
	const creator = "0x0000000000000000000000000000000000000e02"
	const curve = "0x0000000000000000000000000000000000000e03"
	const pool = "0x0000000000000000000000000000000000000e04"
	const manager = "0x0000000000000000000000000000000000000e05"
	const custodian = "0x0000000000000000000000000000000000000e06"
	const blockHash = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee01"
	const launchTx = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee02"
	const graduationTx = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee03"
	const wrongManager = "0x0000000000000000000000000000000000000e07"

	cleanup := func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM liquidity_events WHERE chain_id=$1 AND token_address=$2`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM graduations WHERE chain_id=$1 AND token_address=$2`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM curves WHERE chain_id=$1 AND token_address=$2`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND token_address=$2`, chain, token)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
	}
	cleanup()
	defer cleanup()
	if _, err = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,'0xparent',1000)`, chain, block, blockHash); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'Phase Ten Graduation','P10',1000,'endpoint-cp-v3',$4,$5,$6,1)`, chain, token, creator, block, blockHash, launchTx); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO curves(chain_id,token_address,curve_address,creator_address,curve_supply,sold_supply,reserve_balance,graduation_threshold,lifecycle,canonical_pool_address,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,800,800,3,800,'graduated',$5,$6,$7,$8,1)`, chain, token, curve, creator, pool, block, blockHash, launchTx); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO token_metrics(chain_id,token_address,trade_count,buy_count,sell_count,volume,fees,unique_trader_count,recent_volume,recent_trade_count,recent_trader_count,block_number,block_hash) VALUES($1,$2,1,1,0,3,0,1,3,1,1,$3,$4)`, chain, token, block, blockHash); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO graduations(chain_id,token_address,phase,sold_supply,token_amount,graduation_manager_address,native_usdc_amount,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,'graduated',800,200,$3,3,$4,$5,$6,8)`, chain, token, manager, block, blockHash, graduationTx); err != nil {
		t.Fatal(err)
	}
	// This canonical row has the same token and transaction but the wrong
	// manager. The repository must never pair it with the curve evidence.
	if _, err = repo.pool.Exec(ctx, `INSERT INTO liquidity_events(chain_id,token_address,event_name,graduation_manager_address,lp_custodian_address,position_token_id,liquidity_amount,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,'GraduatedV3',$3,$4,999,9999,$5,$6,$7,6)`, chain, token, wrongManager, custodian, block, blockHash, graduationTx); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO liquidity_events(chain_id,token_address,event_name,graduation_manager_address,lp_custodian_address,position_token_id,liquidity_amount,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,'GraduatedV3',$3,$4,77,1234,$5,$6,$7,7)`, chain, token, manager, custodian, block, blockHash, graduationTx); err != nil {
		t.Fatal(err)
	}

	assertGraduation := func(label string, item Token) {
		t.Helper()
		g := item.Graduation
		if g == nil || g.Phase != "graduated" || g.CanonicalPoolAddress != pool || g.GraduationManagerAddress != manager || g.LPCustodianAddress != custodian || g.PositionTokenID != "77" || g.Liquidity != "1234" || g.TokenAmount != "200" || g.NativeUsdcAmount != "3" || g.SoldSupply != "800" || g.CurveTerminalAt == nil || g.CurveTerminalAt.BlockNumber != block || g.CurveTerminalAt.TransactionHash != graduationTx || g.CurveTerminalAt.LogIndex != 8 || g.SettledAt == nil || g.SettledAt.BlockNumber != block || g.SettledAt.TransactionHash != graduationTx || g.SettledAt.LogIndex != 7 {
			t.Fatalf("%s graduation=%+v", label, g)
		}
		if g.LiquidityToken != nil || g.QuoteAmount != nil || g.LiquidityAmount != nil || g.LockID != nil || g.UnlockTimestamp != nil {
			t.Fatalf("%s fabricated legacy values=%+v", label, g)
		}
	}
	find := func(items []Token) Token {
		t.Helper()
		for _, item := range items {
			if strings.EqualFold(item.Address, token) {
				return item
			}
		}
		t.Fatalf("fixture token missing from %v", items)
		return Token{}
	}
	detail, err := repo.Token(ctx, chain, token)
	if err != nil {
		t.Fatal(err)
	}
	assertGraduation("detail", detail)
	listed, err := repo.ListTokens(ctx, chain, 100, "")
	if err != nil {
		t.Fatal(err)
	}
	assertGraduation("list", find(listed.Items))
	searched, err := repo.SearchTokens(ctx, chain, "phase ten", 100, "")
	if err != nil {
		t.Fatal(err)
	}
	assertGraduation("search", find(searched.Items))
	trending, err := repo.TrendingTokens(ctx, chain, 100, "")
	if err != nil {
		t.Fatal(err)
	}
	assertGraduation("trending", find(trending.Items))
	created, err := repo.CreatorTokens(ctx, chain, creator, 100, "")
	if err != nil {
		t.Fatal(err)
	}
	assertGraduation("creator", find(created.Items))

	// Removing the matching canonical settlement must not make the repository
	// borrow the wrong-manager row or synthesize zero settlement values.
	if _, err = repo.pool.Exec(ctx, `UPDATE liquidity_events SET is_canonical=false,orphaned_at=now() WHERE chain_id=$1 AND token_address=$2 AND graduation_manager_address=$3`, chain, token, manager); err != nil {
		t.Fatal(err)
	}
	detail, err = repo.Token(ctx, chain, token)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Graduation == nil || detail.Graduation.Phase != "graduated" || detail.Graduation.SettledAt != nil || detail.Graduation.LPCustodianAddress != "" || detail.Graduation.PositionTokenID != "" || detail.Graduation.Liquidity != "" {
		t.Fatalf("absent canonical settlement was fabricated or mispaired: %+v", detail.Graduation)
	}
}

func TestPostgresRepositoryIndexedData(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	ctx := context.Background()
	repo, e := NewPostgresRepository(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer repo.Close()
	page, e := repo.ListTokens(ctx, 84532, 2, "")
	if e != nil {
		t.Fatal(e)
	}
	if page.Items == nil {
		t.Fatal("expected non-nil empty collection")
	}
	if len(page.Items) > 2 {
		t.Fatalf("items=%d", len(page.Items))
	}
	if len(page.Items) == 0 {
		return
	}
	token := page.Items[0]
	detail, e := repo.Token(ctx, 84532, token.Address)
	if e != nil {
		t.Fatal(e)
	}
	if detail.Address != token.Address {
		t.Fatalf("detail=%s list=%s", detail.Address, token.Address)
	}
	trades, e := repo.Trades(ctx, 84532, token.Address, 10, "")
	if e != nil {
		t.Fatal(e)
	}
	if trades.Items == nil {
		t.Fatal("expected non-nil trades collection")
	}
	activity, e := repo.Activity(ctx, 84532, token.Address, 10, "")
	if e != nil {
		t.Fatal(e)
	}
	if activity.Items == nil {
		t.Fatal("expected non-nil activity collection")
	}
	creator, e := repo.Creator(ctx, 84532, token.Creator, 10, "")
	if e != nil {
		t.Fatal(e)
	}
	if creator.TokenCount < 1 {
		t.Fatalf("creator token count=%d", creator.TokenCount)
	}
	if _, e = repo.Token(ctx, 84532, "0x0000000000000000000000000000000000000001"); e != ErrNotFound {
		t.Fatalf("unknown token error=%v", e)
	}
}

func TestPostgresRepositoryKeysetPagination(t *testing.T) {
	url := integrationDatabaseURL(t, "API_TEST_DATABASE_URL")
	ctx := context.Background()
	repo, e := NewPostgresRepository(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer repo.Close()
	const chain int64 = 84532
	const block int64 = 499999991
	// The fixture uses a unique height and deterministic addresses, then removes
	// every dependent row so it cannot affect the user's indexed data.
	blockHash := "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	addresses := []string{
		"0x00000000000000000000000000000000000000a1",
		"0x00000000000000000000000000000000000000a2",
		"0x00000000000000000000000000000000000000a3",
	}
	creator := "0x00000000000000000000000000000000000000c1"
	if _, e = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,$4,0)`, chain, block, blockHash, "0xparent"); e != nil {
		t.Fatal(e)
	}
	defer func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_trade_buckets WHERE chain_id=$1 AND token_address = ANY($2::text[])`, chain, addresses)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_events WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM trades WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_metrics WHERE chain_id=$1 AND token_address = ANY($2::text[])`, chain, addresses)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
	}()
	for i, address := range addresses {
		tx := "0x" + strings.Repeat(string(rune('b'+i)), 64)
		if _, e = repo.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,1000,$6,$7,$8,$9)`, chain, address, creator, "Fixture", "FIX", block, blockHash, tx, i); e != nil {
			t.Fatal(e)
		}
		if _, e = repo.pool.Exec(ctx, `INSERT INTO token_metrics(chain_id,token_address,trade_count,volume,recent_volume,recent_trade_count,recent_trader_count,block_number,block_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, chain, address, 3-i, 100-i, 300-i*100, 3-i, 2-i, block, blockHash); e != nil {
			t.Fatal(e)
		}
	}
	page, e := repo.ListTokens(ctx, chain, 1, "")
	if e != nil {
		t.Fatal(e)
	}
	if len(page.Items) != 1 || page.NextCursor == "" {
		t.Fatalf("first token page=%+v", page)
	}
	page2, e := repo.ListTokens(ctx, chain, 2, page.NextCursor)
	if e != nil {
		t.Fatal(e)
	}
	if len(page2.Items) != 2 || page2.Items[0].Address == page.Items[0].Address || page2.Items[1].Address == page.Items[0].Address {
		t.Fatalf("keyset token pages overlap: %+v / %+v", page, page2)
	}
	if _, e = repo.ListTokens(ctx, chain, 1, "not-a-cursor"); e != ErrInvalidCursor {
		t.Fatalf("invalid token cursor=%v", e)
	}
	search, e := repo.SearchTokens(ctx, chain, "fixture", 1, "")
	if e != nil || len(search.Items) != 1 || search.NextCursor == "" {
		t.Fatalf("search=%+v err=%v", search, e)
	}
	search2, e := repo.SearchTokens(ctx, chain, "fixture", 2, search.NextCursor)
	if e != nil || len(search2.Items) != 2 || search2.Items[0].Address == search.Items[0].Address {
		t.Fatalf("search page=%+v err=%v", search2, e)
	}
	if _, e = repo.SearchTokens(ctx, chain, "different", 1, search.NextCursor); e != ErrInvalidCursor {
		t.Fatalf("search cursor query mismatch=%v", e)
	}
	trend, e := repo.TrendingTokens(ctx, chain, 1, "")
	if e != nil || len(trend.Items) != 1 || trend.Items[0].Address != addresses[0] {
		t.Fatalf("trending=%+v err=%v", trend, e)
	}
	trend2, e := repo.TrendingTokens(ctx, chain, 2, trend.NextCursor)
	if e != nil || len(trend2.Items) != 2 || trend2.Items[0].Address == trend.Items[0].Address {
		t.Fatalf("trending page=%+v err=%v", trend2, e)
	}
	if _, e = repo.pool.Exec(ctx, `UPDATE token_metrics SET recent_volume=1,recent_trade_count=1,recent_trader_count=1 WHERE chain_id=$1 AND token_address = ANY($2::text[])`, chain, addresses); e != nil {
		t.Fatal(e)
	}
	tiedTrend, e := repo.TrendingTokens(ctx, chain, 3, "")
	if e != nil || len(tiedTrend.Items) != 3 || tiedTrend.Items[0].Address != addresses[0] || tiedTrend.Items[1].Address != addresses[1] || tiedTrend.Items[2].Address != addresses[2] {
		t.Fatalf("deterministic trending ties=%+v err=%v", tiedTrend, e)
	}
	creatorPage, e := repo.CreatorTokens(ctx, chain, creator, 1, "")
	if e != nil || len(creatorPage.Items) != 1 {
		t.Fatalf("creator page=%+v err=%v", creatorPage, e)
	}
	creatorPage2, e := repo.CreatorTokens(ctx, chain, creator, 2, creatorPage.NextCursor)
	if e != nil || len(creatorPage2.Items) != 2 || creatorPage2.Items[0].Address == creatorPage.Items[0].Address {
		t.Fatalf("creator page=%+v err=%v", creatorPage2, e)
	}
	for i := 0; i < 3; i++ {
		tx := "0x" + strings.Repeat(string(rune('d'+i)), 64)
		if _, e = repo.pool.Exec(ctx, `INSERT INTO trades(chain_id,token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'buy',1,1,$4,0,0,$5,$6,$7,$8)`, chain, addresses[0], creator, 10+i, block, blockHash, tx, i); e != nil {
			t.Fatal(e)
		}
		if _, e = repo.pool.Exec(ctx, `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,log_index,contract_address,topic0,event_name,decoded) VALUES($1,$2,$3,$4,$5,$6,$7,'Trade',jsonb_build_object('token',$8::text))`, chain, block, blockHash, tx, i, addresses[0], "0xtopic", addresses[0]); e != nil {
			t.Fatal(e)
		}
	}
	transferTX := "0x" + strings.Repeat("e", 64)
	if _, e = repo.pool.Exec(ctx, `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,log_index,contract_address,topic0,event_name,decoded) VALUES($1,$2,$3,$4,99,$5,$6,'Transfer',jsonb_build_object('from','0x0000000000000000000000000000000000000001','to','0x0000000000000000000000000000000000000002','value','1'))`, chain, block, blockHash, transferTX, addresses[0], "0xtransfer"); e != nil {
		t.Fatal(e)
	}
	if _, e = repo.pool.Exec(ctx, `INSERT INTO token_trade_buckets(chain_id,token_address,bucket_start,trade_count,buy_count,sell_count,volume,unique_trader_count,open_price,high_price,low_price,close_price,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,3600,1,1,0,10,1,7,7,7,7,$3,$4,$5,1),($1,$2,7200,1,0,1,11,1,7,8,6,8,$3,$4,$6,2)`, chain, addresses[0], block, blockHash, "0x"+strings.Repeat("f", 64), "0x"+strings.Repeat("a", 64)); e != nil {
		t.Fatal(e)
	}
	trades, e := repo.Trades(ctx, chain, addresses[0], 2, "")
	if e != nil || len(trades.Items) != 2 || trades.NextCursor == "" {
		t.Fatalf("trades=%+v err=%v", trades, e)
	}
	trades2, e := repo.Trades(ctx, chain, addresses[0], 2, trades.NextCursor)
	if e != nil || len(trades2.Items) != 1 || trades2.Items[0].TransactionHash == trades.Items[1].TransactionHash {
		t.Fatalf("trade pages=%+v / %+v err=%v", trades, trades2, e)
	}
	activity, e := repo.Activity(ctx, chain, addresses[0], 2, "")
	if e != nil || len(activity.Items) != 2 || activity.NextCursor == "" {
		t.Fatalf("activity=%+v err=%v", activity, e)
	}
	activity2, e := repo.Activity(ctx, chain, addresses[0], 2, activity.NextCursor)
	if e != nil || len(activity2.Items) != 2 {
		t.Fatalf("activity page=%+v err=%v", activity2, e)
	}
	allActivity, e := repo.Activity(ctx, chain, addresses[0], 10, "")
	transferFound := false
	for _, event := range allActivity.Items {
		transferFound = transferFound || event.EventName == "Transfer"
	}
	if e != nil || len(allActivity.Items) != 4 || !transferFound {
		t.Fatalf("transfer activity=%+v err=%v", allActivity, e)
	}
	chart, e := repo.Chart(ctx, chain, addresses[0], "1h", 10)
	if e != nil || len(chart.Candles) != 1 || chart.Candles[0].BucketStart != 0 || chart.Candles[0].TradeCount != 3 || chart.Candles[0].Volume != "33" || chart.Candles[0].OpenPrice == nil || chart.Candles[0].HighPrice == nil || chart.Candles[0].LowPrice == nil || chart.Candles[0].ClosePrice == nil {
		t.Fatalf("chart=%+v err=%v", chart, e)
	}
	emptyChart, e := repo.Chart(ctx, chain, addresses[1], "1m", 10)
	if e != nil || emptyChart.Candles == nil || len(emptyChart.Candles) != 0 || emptyChart.Interval != "1m" || len(emptyChart.SupportedIntervals) != 7 {
		t.Fatalf("empty chart=%+v err=%v", emptyChart, e)
	}
	creatorProfile, e := repo.Creator(ctx, chain, creator, 1, "")
	if e != nil || creatorProfile.Volume != "33" {
		t.Fatalf("creator volume=%q err=%v", creatorProfile.Volume, e)
	}
	empty, e := repo.ListTokens(ctx, chain, 1, encodeCursor(pageCursor{Kind: "tokens", BlockNumber: 0, TokenAddress: addresses[0]}))
	if e != nil || len(empty.Items) != 0 || empty.Items == nil {
		t.Fatalf("empty page=%+v err=%v", empty, e)
	}
}
