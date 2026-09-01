package indexer

import (
	"context"
	"math/big"
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func eventLog(t *testing.T, abiEvents map[string]abi.Event, name string, indexed []common.Hash, args ...any) types.Log {
	t.Helper()
	e := abiEvents[name]
	data, err := e.Inputs.NonIndexed().Pack(args...)
	if err != nil {
		t.Fatal(err)
	}
	return types.Log{Address: common.HexToAddress("0x00000000000000000000000000000000000000aa"), Topics: append([]common.Hash{e.ID}, indexed...), Data: data}
}

func TestCanonicalLogsUseExactChainPositionOrdering(t *testing.T) {
	blockHash := common.HexToHash("0x100")
	first := types.Log{BlockNumber: 77, BlockHash: blockHash, TxHash: common.HexToHash("0xffff"), TxIndex: 2, Index: 1}
	second := types.Log{BlockNumber: 77, BlockHash: blockHash, TxHash: common.HexToHash("0x0001"), TxIndex: 1, Index: 1}
	logs, err := canonicalLogs([]types.Log{first, second})
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 || logs[0].TxIndex != 1 || logs[1].TxIndex != 2 {
		t.Fatalf("logs were not ordered by block, transaction, log position: %+v", logs)
	}
}

func integrationStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("INDEXER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INDEXER_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	if err := validateIntegrationDatabaseURL(url); err != nil {
		t.Fatal(err)
	}
	s, err := NewStore(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	for _, table := range []string{"token_trade_buckets", "token_holder_balances", "token_metrics", "liquidity_events", "graduations", "fees", "trades", "curves", "tokens", "chain_events", "chain_blocks", "indexer_checkpoints", "application_token_exclusions"} {
		if _, err = s.pool.Exec(context.Background(), "TRUNCATE "+table+" CASCADE"); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func TestExcludedLaunchPreservesRawReplayAndScanAddressesWithoutProjections(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token := common.HexToAddress("0x0000000000000000000000000000000000000e01")
	creator := common.HexToAddress("0x0000000000000000000000000000000000000e02")
	curve := common.HexToAddress("0x0000000000000000000000000000000000000e03")
	pool := common.HexToAddress("0x0000000000000000000000000000000000000e04")
	b := &types.Header{Number: big.NewInt(100), Time: 100}
	launch := stamp(b, v3LaunchWithPool(t, token, creator, curve, pool))
	metadata := map[string]TokenMetadata{token.Hex(): {Name: "Excluded", Symbol: "EX", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3", b, launch, metadata); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO application_token_exclusions(chain_id,token_address,reason) VALUES($1,lower($2),'test')`, BaseSepoliaChainID, token.Hex()); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"token_holder_balances", "token_trade_buckets", "token_metrics", "trades", "curves", "tokens"} {
		if _, err := s.pool.Exec(ctx, `DELETE FROM `+table+` WHERE chain_id=$1 AND lower(token_address)=lower($2)`, BaseSepoliaChainID, token.Hex()); err != nil {
			t.Fatal(err)
		}
	}
	addresses, err := s.ScanContracts(ctx, BaseSepoliaChainID, nil)
	if err != nil {
		t.Fatal(err)
	}
	found := map[common.Address]bool{}
	for _, address := range addresses {
		found[address] = true
	}
	for _, address := range []common.Address{token, curve, pool} {
		if !found[address] {
			t.Fatalf("excluded canonical address %s fell out of the scan set: %v", address, addresses)
		}
	}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3", b, launch, metadata); err != nil {
		t.Fatal(err)
	}
	var raw, projected int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM chain_events WHERE chain_id=$1 AND event_name='TokenLaunchedV3'`, BaseSepoliaChainID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM tokens WHERE chain_id=$1 AND lower(token_address)=lower($2)`, BaseSepoliaChainID, token.Hex()).Scan(&projected); err != nil {
		t.Fatal(err)
	}
	if raw != 1 || projected != 0 {
		t.Fatalf("raw launch=%d projected token=%d", raw, projected)
	}
}

func v3Launch(t *testing.T, token, creator, curve common.Hash) types.Log {
	return eventLog(t, contractABI.Events, "TokenLaunchedV3", []common.Hash{creator, token, curve}, "endpoint-cp-v3", big.NewInt(1000), big.NewInt(800), big.NewInt(200), common.Address{}, common.Address{}, [32]byte{}, [32]byte{}, uint16(0))
}

func v3LaunchWithPool(t *testing.T, token, creator, curve, pool common.Address) types.Log {
	return eventLog(t, contractABI.Events, "TokenLaunchedV3", []common.Hash{common.BytesToHash(creator.Bytes()), common.BytesToHash(token.Bytes()), common.BytesToHash(curve.Bytes())}, "endpoint-cp-v3", big.NewInt(1000), big.NewInt(800), big.NewInt(200), common.Address{}, pool, [32]byte{}, [32]byte{}, uint16(0))
}

func stamp(b *types.Header, logs ...types.Log) []types.Log {
	for i := range logs {
		// Transaction hashes must be distinct across competing blocks so a reorg
		// fixture cannot overwrite an unrelated canonical event before rewind.
		txID := new(big.Int).SetUint64(b.Number.Uint64()*1000 + uint64(i) + 1)
		logs[i].BlockNumber, logs[i].BlockHash, logs[i].TxHash, logs[i].Index = b.Number.Uint64(), b.Hash(), common.BigToHash(txID), uint(i+1)
	}
	return logs
}

func TestV3TransferAnalyticsAndIdempotency(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token, creator, buyer, curve := common.HexToHash("0x101"), common.HexToHash("0x102"), common.HexToHash("0x103"), common.HexToHash("0x104")
	b := &types.Header{Number: big.NewInt(10), Time: 3601}
	zero := common.Hash{}
	launch := v3Launch(t, token, creator, curve)
	mint := eventLog(t, contractABI.Events, "Transfer", []common.Hash{zero, creator}, big.NewInt(1000))
	mint.Address = common.BytesToAddress(token.Bytes())
	move := eventLog(t, contractABI.Events, "Transfer", []common.Hash{creator, buyer}, big.NewInt(100))
	move.Address = common.BytesToAddress(token.Bytes())
	buy := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, buyer}, big.NewInt(12), big.NewInt(12), big.NewInt(10), big.NewInt(10), big.NewInt(2), big.NewInt(1), big.NewInt(1), big.NewInt(0), big.NewInt(0), big.NewInt(0))
	buy.Address = common.BytesToAddress(curve.Bytes())
	logs := stamp(b, launch, mint, move, buy)
	metadata := map[string]TokenMetadata{common.BytesToAddress(token.Bytes()).Hex(): {Name: "Analytics", Symbol: "AN", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3", b, logs, metadata); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3", b, logs, metadata); err != nil {
		t.Fatal(err)
	}
	var holders, traders, trades, buckets int64
	var openPrice, highPrice, lowPrice, closePrice *string
	if err := s.pool.QueryRow(ctx, `SELECT holder_count,unique_trader_count,trade_count FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, common.BytesToAddress(token.Bytes()).Hex()).Scan(&holders, &traders, &trades); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM token_trade_buckets WHERE chain_id=$1`, BaseSepoliaChainID).Scan(&buckets); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT open_price::text,high_price::text,low_price::text,close_price::text FROM token_trade_buckets WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, common.BytesToAddress(token.Bytes()).Hex()).Scan(&openPrice, &highPrice, &lowPrice, &closePrice); err != nil {
		t.Fatal(err)
	}
	if holders != 2 || traders != 1 || trades != 1 || buckets != 1 || openPrice == nil || highPrice == nil || lowPrice == nil || closePrice == nil {
		t.Fatalf("metrics=%d/%d/%d buckets=%d candle=%v/%v/%v/%v", holders, traders, trades, buckets, openPrice, highPrice, lowPrice, closePrice)
	}
	virtual, ok := new(big.Int).SetString("1066666666666666666666666667", 10)
	if !ok {
		t.Fatal("invalid virtual reserve")
	}
	denominator := new(big.Int).Sub(virtual, big.NewInt(10))
	numerator := new(big.Int).Mul(new(big.Int).Add(big.NewInt(1_000_000_000_000_000_000), big.NewInt(10)), big.NewInt(1_000_000_000_000_000_000))
	expectedClose, remainder := new(big.Int), new(big.Int)
	expectedClose.QuoRem(numerator, denominator, remainder)
	if remainder.Sign() > 0 {
		expectedClose.Add(expectedClose, big.NewInt(1))
	}
	if *openPrice != expectedClose.String() || *highPrice != expectedClose.String() || *lowPrice != expectedClose.String() || *closePrice != expectedClose.String() {
		t.Fatalf("bucket candle=%s/%s/%s/%s want=%s", *openPrice, *highPrice, *lowPrice, *closePrice, expectedClose)
	}
}

func TestCanonicalUniswapV3SwapIsNormalizedAfterGraduation(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token := common.HexToAddress("0x7000000000000000000000000000000000000111")
	creator := common.HexToAddress("0x0000000000000000000000000000000000000112")
	curve := common.HexToAddress("0x0000000000000000000000000000000000000113")
	pool := common.HexToAddress("0x0000000000000000000000000000000000000114")
	router := common.HexToAddress("0x0000000000000000000000000000000000000115")
	wallet := common.HexToAddress("0x0000000000000000000000000000000000000116")
	launchBlock := &types.Header{Number: big.NewInt(20), Time: 10_000}
	launch := v3LaunchWithPool(t, token, creator, curve, pool)
	launch.Address = common.HexToAddress("0x0000000000000000000000000000000000000117")
	launchLogs := stamp(launchBlock, launch)
	metadata := map[string]TokenMetadata{token.Hex(): {Name: "Uniswap", Symbol: "UNI", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-uniswap", launchBlock, launchLogs, metadata); err != nil {
		t.Fatal(err)
	}
	tradeBlock := &types.Header{Number: big.NewInt(21), Time: 10_100}
	settled := eventLog(t, v3GraduationABI.Events, "GraduatedV3", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes()), common.BigToHash(big.NewInt(1))}, big.NewInt(1))
	settled.Address = creator
	graduated := eventLog(t, contractABI.Events, "Graduated", []common.Hash{common.BytesToHash(token.Bytes()), common.BytesToHash(creator.Bytes())}, big.NewInt(900), big.NewInt(100), big.NewInt(800))
	graduated.Address = curve
	swap := eventLog(t, uniswapV3PoolABI.Events, "Swap", []common.Hash{common.BytesToHash(router.Bytes()), common.BytesToHash(wallet.Bytes())}, big.NewInt(100), big.NewInt(-1000), big.NewInt(1), big.NewInt(1), big.NewInt(1))
	swap.Address = pool
	tradeLogs := stamp(tradeBlock, settled, graduated, swap)
	tradeLogs[1].TxHash = tradeLogs[0].TxHash
	if err := s.ApplyWithMetadataAndSenders(ctx, BaseSepoliaChainID, "v3-uniswap", tradeBlock, tradeLogs, metadata, map[common.Hash]common.Address{tradeLogs[2].TxHash: wallet}); err != nil {
		t.Fatal(err)
	}
	var source, side, trader, tokenAmount, reserve string
	if err := s.pool.QueryRow(ctx, `SELECT source,side,trader_address,token_amount::text,reserve_amount::text FROM trades WHERE chain_id=$1 AND transaction_hash=$2`, BaseSepoliaChainID, tradeLogs[2].TxHash.Hex()).Scan(&source, &side, &trader, &tokenAmount, &reserve); err != nil {
		t.Fatal(err)
	}
	if source != "uniswap_v3" || side != "buy" || trader != wallet.Hex() || tokenAmount != "1000" || reserve != "100" {
		t.Fatalf("normalized swap=%s/%s/%s/%s/%s", source, side, trader, tokenAmount, reserve)
	}
}

func TestV3LaunchReplayPreservesFinalizedMetadata(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	tokenHash, creatorHash, curveHash := common.HexToHash("0x1101"), common.HexToHash("0x1102"), common.HexToHash("0x1103")
	token := common.BytesToAddress(tokenHash.Bytes()).Hex()
	creator := common.BytesToAddress(creatorHash.Bytes()).Hex()
	b := &types.Header{Number: big.NewInt(12), Time: 8000}
	logs := stamp(b, v3Launch(t, tokenHash, creatorHash, curveHash))
	metadata := map[string]TokenMetadata{token: {Name: "Durable Metadata", Symbol: "DURA", Decimals: 18}}

	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-metadata-replay", b, logs, metadata); err != nil {
		t.Fatal(err)
	}
	assertApplicationMetadata(t, s, token, applicationMetadata{})

	finalized := applicationMetadata{
		Description: "metadata survives canonical replay",
		ImageURL:    "/objects/images/durable.png",
		MetadataURL: "/objects/metadata/durable.json",
		WebsiteURL:  "https://cooket.fun/durable",
		XURL:        "https://x.com/cooket_durable",
		TelegramURL: "https://t.me/cooket_durable",
		DiscordURL:  "https://discord.gg/cooket-durable",
	}
	// This is the same application-owned UPDATE performed by the API's
	// FinalizeMetadata transaction after it verifies canonical launch identity.
	if _, err := s.pool.Exec(ctx, `UPDATE tokens SET description=$2,image_url=$3,metadata_url=$4,website_url=$5,x_url=$6,telegram_url=$7,discord_url=$8 WHERE chain_id=$1 AND token_address=$9`, BaseSepoliaChainID, finalized.Description, finalized.ImageURL, finalized.MetadataURL, finalized.WebsiteURL, finalized.XURL, finalized.TelegramURL, finalized.DiscordURL, token); err != nil {
		t.Fatal(err)
	}
	assertApplicationMetadata(t, s, token, finalized)

	for replay := 0; replay < 2; replay++ {
		if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-metadata-replay", b, logs, metadata); err != nil {
			t.Fatal(err)
		}
		assertApplicationMetadata(t, s, token, finalized)
	}

	var count int64
	var gotToken, gotCreator, name, symbol, supply, protocol, blockHash, txHash string
	var blockNumber, logIndex int64
	var canonical bool
	var orphanedAt any
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM tokens WHERE chain_id=$1 AND transaction_hash=$2 AND log_index=$3`, BaseSepoliaChainID, logs[0].TxHash.Hex(), logs[0].Index).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT token_address,creator_address,name,symbol,initial_supply::text,protocol_version,block_number,block_hash,transaction_hash,log_index,is_canonical,orphaned_at FROM tokens WHERE chain_id=$1 AND transaction_hash=$2 AND log_index=$3`, BaseSepoliaChainID, logs[0].TxHash.Hex(), logs[0].Index).Scan(&gotToken, &gotCreator, &name, &symbol, &supply, &protocol, &blockNumber, &blockHash, &txHash, &logIndex, &canonical, &orphanedAt); err != nil {
		t.Fatal(err)
	}
	if count != 1 || gotToken != token || gotCreator != creator || name != "Durable Metadata" || symbol != "DURA" || supply != "1000" || protocol != "endpoint-cp-v3" || blockNumber != int64(b.Number.Uint64()) || blockHash != b.Hash().Hex() || txHash != logs[0].TxHash.Hex() || logIndex != int64(logs[0].Index) || !canonical || orphanedAt != nil {
		t.Fatalf("launch projection count=%d token=%s creator=%s name=%s symbol=%s supply=%s protocol=%s block=%d/%s tx=%s index=%d canonical=%t orphaned=%v", count, gotToken, gotCreator, name, symbol, supply, protocol, blockNumber, blockHash, txHash, logIndex, canonical, orphanedAt)
	}
}

func TestV3LaunchReorgIdentityChangeDoesNotCarryFinalizedMetadata(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	oldToken, newToken := common.HexToHash("0x1201"), common.HexToHash("0x1202")
	oldCreator, newCreator := common.HexToHash("0x1203"), common.HexToHash("0x1204")
	oldCurve, newCurve := common.HexToHash("0x1205"), common.HexToHash("0x1206")
	oldAddress := common.BytesToAddress(oldToken.Bytes()).Hex()
	newAddress := common.BytesToAddress(newToken.Bytes()).Hex()
	oldBlock := &types.Header{Number: big.NewInt(13), Time: 8100}
	oldLogs := stamp(oldBlock, v3Launch(t, oldToken, oldCreator, oldCurve))
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-metadata-reorg", oldBlock, oldLogs, map[string]TokenMetadata{oldAddress: {Name: "Old Launch", Symbol: "OLD", Decimals: 18}}); err != nil {
		t.Fatal(err)
	}
	finalized := applicationMetadata{Description: "old metadata", ImageURL: "/objects/old.png", MetadataURL: "/objects/old.json", WebsiteURL: "https://old.example", XURL: "https://x.com/old", TelegramURL: "https://t.me/old", DiscordURL: "https://discord.gg/old"}
	if _, err := s.pool.Exec(ctx, `UPDATE tokens SET description=$2,image_url=$3,metadata_url=$4,website_url=$5,x_url=$6,telegram_url=$7,discord_url=$8 WHERE chain_id=$1 AND token_address=$9`, BaseSepoliaChainID, finalized.Description, finalized.ImageURL, finalized.MetadataURL, finalized.WebsiteURL, finalized.XURL, finalized.TelegramURL, finalized.DiscordURL, oldAddress); err != nil {
		t.Fatal(err)
	}

	replacement := &types.Header{Number: big.NewInt(13), Time: 8200, Nonce: types.EncodeNonce(7)}
	replacementLogs := stamp(replacement, v3Launch(t, newToken, newCreator, newCurve))
	// A transaction can be re-included after a reorg. Keep its event identity
	// while changing decoded launch identity to prove stale metadata is not copied.
	replacementLogs[0].TxHash = oldLogs[0].TxHash
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-metadata-reorg", replacement, replacementLogs, map[string]TokenMetadata{newAddress: {Name: "New Launch", Symbol: "NEW", Decimals: 18}}); err != nil {
		t.Fatal(err)
	}
	assertApplicationMetadata(t, s, newAddress, applicationMetadata{})

	var count int64
	var gotToken, gotCreator, name, symbol, supply, protocol, blockHash string
	var canonical bool
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM tokens WHERE chain_id=$1 AND transaction_hash=$2 AND log_index=$3`, BaseSepoliaChainID, oldLogs[0].TxHash.Hex(), oldLogs[0].Index).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT token_address,creator_address,name,symbol,initial_supply::text,protocol_version,block_hash,is_canonical FROM tokens WHERE chain_id=$1 AND transaction_hash=$2 AND log_index=$3`, BaseSepoliaChainID, oldLogs[0].TxHash.Hex(), oldLogs[0].Index).Scan(&gotToken, &gotCreator, &name, &symbol, &supply, &protocol, &blockHash, &canonical); err != nil {
		t.Fatal(err)
	}
	if count != 1 || gotToken != newAddress || gotCreator != common.BytesToAddress(newCreator.Bytes()).Hex() || name != "New Launch" || symbol != "NEW" || supply != "1000" || protocol != "endpoint-cp-v3" || blockHash != replacement.Hash().Hex() || !canonical {
		t.Fatalf("replacement projection count=%d token=%s creator=%s name=%s symbol=%s supply=%s protocol=%s block=%s canonical=%t", count, gotToken, gotCreator, name, symbol, supply, protocol, blockHash, canonical)
	}
}

type applicationMetadata struct {
	Description string
	ImageURL    string
	MetadataURL string
	WebsiteURL  string
	XURL        string
	TelegramURL string
	DiscordURL  string
}

func assertApplicationMetadata(t *testing.T, s *Store, token string, want applicationMetadata) {
	t.Helper()
	var description, imageURL, metadataURL, websiteURL, xURL, telegramURL, discordURL *string
	if err := s.pool.QueryRow(context.Background(), `SELECT description,image_url,metadata_url,website_url,x_url,telegram_url,discord_url FROM tokens WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token).Scan(&description, &imageURL, &metadataURL, &websiteURL, &xURL, &telegramURL, &discordURL); err != nil {
		t.Fatal(err)
	}
	if want == (applicationMetadata{}) {
		if description != nil || imageURL != nil || metadataURL != nil || websiteURL != nil || xURL != nil || telegramURL != nil || discordURL != nil {
			t.Fatalf("application metadata must be NULL for an unfinalized launch: description=%v image=%v metadata=%v website=%v x=%v telegram=%v discord=%v", description, imageURL, metadataURL, websiteURL, xURL, telegramURL, discordURL)
		}
		return
	}
	got := applicationMetadata{stringValue(description), stringValue(imageURL), stringValue(metadataURL), stringValue(websiteURL), stringValue(xURL), stringValue(telegramURL), stringValue(discordURL)}
	if got != want {
		t.Fatalf("application metadata=%+v want=%+v", got, want)
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func TestV3HourlyOHLCUsesCanonicalTradeOrder(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token, creator, buyer, curve := common.HexToHash("0x151"), common.HexToHash("0x152"), common.HexToHash("0x153"), common.HexToHash("0x154")
	b := &types.Header{Number: big.NewInt(11), Time: 7201}
	launch := v3Launch(t, token, creator, curve)
	mint := eventLog(t, contractABI.Events, "Transfer", []common.Hash{common.Hash{}, creator}, big.NewInt(1000))
	mint.Address = common.BytesToAddress(token.Bytes())
	first := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, buyer}, big.NewInt(12), big.NewInt(12), big.NewInt(10), big.NewInt(10), big.NewInt(2), big.NewInt(1), big.NewInt(1), big.NewInt(0), big.NewInt(0), big.NewInt(0))
	second := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, buyer}, big.NewInt(32), big.NewInt(32), big.NewInt(30), big.NewInt(20), big.NewInt(2), big.NewInt(1), big.NewInt(1), big.NewInt(0), big.NewInt(0), big.NewInt(0))
	first.Address, second.Address = common.BytesToAddress(curve.Bytes()), common.BytesToAddress(curve.Bytes())
	metadata := map[string]TokenMetadata{common.BytesToAddress(token.Bytes()).Hex(): {Name: "OHLC", Symbol: "OHL", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-ohlc", b, stamp(b, launch, mint, first, second), metadata); err != nil {
		t.Fatal(err)
	}
	var open, high, low, close string
	if err := s.pool.QueryRow(ctx, `SELECT open_price::text,high_price::text,low_price::text,close_price::text FROM token_trade_buckets WHERE chain_id=$1 AND token_address=$2 AND bucket_start=7200`, BaseSepoliaChainID, common.BytesToAddress(token.Bytes()).Hex()).Scan(&open, &high, &low, &close); err != nil {
		t.Fatal(err)
	}
	virtual, ok := new(big.Int).SetString("1066666666666666666666666667", 10)
	if !ok {
		t.Fatal("invalid virtual reserve")
	}
	priceAt := func(sold, reserve int64) string {
		numerator := new(big.Int).Mul(new(big.Int).Add(big.NewInt(1_000_000_000_000_000_000), big.NewInt(reserve)), big.NewInt(1_000_000_000_000_000_000))
		denominator := new(big.Int).Sub(virtual, big.NewInt(sold))
		price, remainder := new(big.Int), new(big.Int)
		price.QuoRem(numerator, denominator, remainder)
		if remainder.Sign() > 0 {
			price.Add(price, big.NewInt(1))
		}
		return price.String()
	}
	firstPrice, secondPrice := priceAt(10, 10), priceAt(30, 40)
	if open != firstPrice || low != firstPrice || high != secondPrice || close != secondPrice {
		t.Fatalf("OHLC=%s/%s/%s/%s want=%s/%s/%s/%s", open, high, low, close, firstPrice, secondPrice, firstPrice, secondPrice)
	}
}

func TestV3AnalyticsReorgRemovesOrphanedState(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	token, creator, oldBuyer, newBuyer, curve := common.HexToHash("0x201"), common.HexToHash("0x202"), common.HexToHash("0x203"), common.HexToHash("0x204"), common.HexToHash("0x205")
	b1 := &types.Header{Number: big.NewInt(1), Time: 3601}
	b2 := &types.Header{Number: big.NewInt(2), ParentHash: b1.Hash(), Time: 3610}
	replacement := &types.Header{Number: big.NewInt(2), ParentHash: b1.Hash(), Time: 3620, Nonce: types.EncodeNonce(9)}
	launch := v3Launch(t, token, creator, curve)
	mint := eventLog(t, contractABI.Events, "Transfer", []common.Hash{common.Hash{}, creator}, big.NewInt(1000))
	mint.Address = common.BytesToAddress(token.Bytes())
	metadata := map[string]TokenMetadata{common.BytesToAddress(token.Bytes()).Hex(): {Name: "Reorg", Symbol: "RGR", Decimals: 18}}
	if err := s.ApplyWithMetadata(ctx, BaseSepoliaChainID, "v3-reorg", b1, stamp(b1, launch, mint), metadata); err != nil {
		t.Fatal(err)
	}
	oldTransfer := eventLog(t, contractABI.Events, "Transfer", []common.Hash{creator, oldBuyer}, big.NewInt(100))
	oldTransfer.Address = common.BytesToAddress(token.Bytes())
	oldTrade := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, oldBuyer}, big.NewInt(10), big.NewInt(10), big.NewInt(8), big.NewInt(8), big.NewInt(2), big.NewInt(1), big.NewInt(1), big.NewInt(0), big.NewInt(0), big.NewInt(0))
	oldTrade.Address = common.BytesToAddress(curve.Bytes())
	oldLogs := stamp(b2, oldTransfer, oldTrade)
	if err := s.Apply(ctx, BaseSepoliaChainID, "v3-reorg", b2, oldLogs); err != nil {
		t.Fatal(err)
	}
	if err := s.Rewind(ctx, BaseSepoliaChainID, "v3-reorg", 2); err != nil {
		t.Fatal(err)
	}
	newTransfer := eventLog(t, contractABI.Events, "Transfer", []common.Hash{creator, newBuyer}, big.NewInt(50))
	newTransfer.Address = common.BytesToAddress(token.Bytes())
	newTrade := eventLog(t, v3TradeABI.Events, "TokensBought", []common.Hash{token, newBuyer}, big.NewInt(20), big.NewInt(20), big.NewInt(17), big.NewInt(17), big.NewInt(3), big.NewInt(1), big.NewInt(2), big.NewInt(0), big.NewInt(0), big.NewInt(0))
	newTrade.Address = common.BytesToAddress(curve.Bytes())
	if err := s.Apply(ctx, BaseSepoliaChainID, "v3-reorg", replacement, stamp(replacement, newTransfer, newTrade)); err != nil {
		t.Fatal(err)
	}
	address := common.BytesToAddress(token.Bytes()).Hex()
	var holders, traders, trades, buckets int64
	var volume string
	var oldBalance int
	var replacementClose string
	if err := s.pool.QueryRow(ctx, `SELECT holder_count,unique_trader_count,trade_count,volume::text FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, address).Scan(&holders, &traders, &trades, &volume); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM token_holder_balances WHERE chain_id=$1 AND token_address=$2 AND holder_address=$3`, BaseSepoliaChainID, address, common.BytesToAddress(oldBuyer.Bytes()).Hex()).Scan(&oldBalance); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM token_trade_buckets WHERE chain_id=$1 AND token_address=$2 AND close_price IS NOT NULL`, BaseSepoliaChainID, address).Scan(&buckets); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT close_price::text FROM token_trade_buckets WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, address).Scan(&replacementClose); err != nil {
		t.Fatal(err)
	}
	virtual, ok := new(big.Int).SetString("1066666666666666666666666667", 10)
	if !ok {
		t.Fatal("invalid virtual reserve")
	}
	numerator := new(big.Int).Mul(new(big.Int).Add(big.NewInt(1_000_000_000_000_000_000), big.NewInt(17)), big.NewInt(1_000_000_000_000_000_000))
	denominator := new(big.Int).Sub(virtual, big.NewInt(17))
	expected, remainder := new(big.Int), new(big.Int)
	expected.QuoRem(numerator, denominator, remainder)
	if remainder.Sign() > 0 {
		expected.Add(expected, big.NewInt(1))
	}
	if holders != 2 || traders != 1 || trades != 1 || volume != "17" || oldBalance != 0 || buckets != 1 || replacementClose != expected.String() {
		t.Fatalf("canonical metrics=%d/%d/%d/%s old=%d buckets=%d close=%s", holders, traders, trades, volume, oldBalance, buckets, replacementClose)
	}
}

func TestV3PriceAndFDVProjection(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	b := &types.Header{Number: big.NewInt(1), Time: 1}
	if _, err := s.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,1,$2,'0x',1)`, BaseSepoliaChainID, b.Hash().Hex()); err != nil {
		t.Fatal(err)
	}
	wad := big.NewInt(1_000_000_000_000_000_000)
	supply := new(big.Int).Mul(big.NewInt(1_000_000_000), wad)
	sold := new(big.Int).Mul(big.NewInt(400_000_000), wad)
	reserve := big.NewInt(2_000_000_000_000_000_000)
	token := common.HexToAddress("0x0000000000000000000000000000000000000a01")
	if _, err := s.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'Price','P',$4,'endpoint-cp-v3',1,$5,$6,0)`, BaseSepoliaChainID, token.Hex(), common.HexToAddress("0x1").Hex(), supply.String(), b.Hash().Hex(), common.HexToHash("0x11").Hex()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO curves(chain_id,token_address,curve_address,curve_supply,sold_supply,reserve_balance,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,0)`, BaseSepoliaChainID, token.Hex(), common.HexToAddress("0x2").Hex(), supply.String(), sold.String(), reserve.String(), b.Hash().Hex(), common.HexToHash("0x12").Hex()); err != nil {
		t.Fatal(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = rebuildAnalyticsTx(ctx, tx, BaseSepoliaChainID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	virtual, ok := new(big.Int).SetString("1066666666666666666666666667", 10)
	if !ok {
		t.Fatal("invalid virtual reserve")
	}
	denominator := new(big.Int).Sub(virtual, sold)
	numerator := new(big.Int).Mul(new(big.Int).Add(wad, reserve), wad)
	price, rem := new(big.Int), new(big.Int)
	price.QuoRem(numerator, denominator, rem)
	if rem.Sign() > 0 {
		price.Add(price, big.NewInt(1))
	}
	fdv := new(big.Int).Quo(new(big.Int).Mul(price, supply), wad)
	var gotPrice, gotFDV string
	if err := s.pool.QueryRow(ctx, `SELECT current_price::text,fully_diluted_value::text FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&gotPrice, &gotFDV); err != nil {
		t.Fatal(err)
	}
	if gotPrice != price.String() || gotFDV != fdv.String() {
		t.Fatalf("price/fdv=%s/%s want=%s/%s", gotPrice, gotFDV, price, fdv)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE curves SET sold_supply=$3 WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex(), virtual.String()); err != nil {
		t.Fatal(err)
	}
	tx, err = s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = rebuildAnalyticsTx(ctx, tx, BaseSepoliaChainID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var invalidPrice, invalidFDV *string
	if err = s.pool.QueryRow(ctx, `SELECT current_price::text,fully_diluted_value::text FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&invalidPrice, &invalidFDV); err != nil {
		t.Fatal(err)
	}
	if invalidPrice != nil || invalidFDV != nil {
		t.Fatalf("invalid denominator price/fdv=%v/%v", invalidPrice, invalidFDV)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE curves SET sold_supply=$3 WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex(), sold.String()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE tokens SET protocol_version='historical' WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()); err != nil {
		t.Fatal(err)
	}
	tx, err = s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = rebuildAnalyticsTx(ctx, tx, BaseSepoliaChainID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.pool.QueryRow(ctx, `SELECT current_price::text,fully_diluted_value::text FROM token_metrics WHERE chain_id=$1 AND token_address=$2`, BaseSepoliaChainID, token.Hex()).Scan(&invalidPrice, &invalidFDV); err != nil {
		t.Fatal(err)
	}
	if invalidPrice != nil || invalidFDV != nil {
		t.Fatalf("non-v3 price/fdv=%v/%v", invalidPrice, invalidFDV)
	}
}
