package api

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")
var ErrInvalidCursor = errors.New("invalid cursor")
var ErrInconsistentAccounting = errors.New("checkpoint claimed exceeds checkpointed")
var ErrMetadataPending = errors.New("metadata finalization pending canonical indexing")
var ErrMetadataMismatch = errors.New("metadata draft identity mismatch")

type Repository interface {
	Ping(context.Context) error
	ListTokens(context.Context, int64, int, string) (Page, error)
	DiscoveryTokens(context.Context, int64, string, int, string) (Page, error)
	SearchTokens(context.Context, int64, string, int, string) (Page, error)
	TrendingTokens(context.Context, int64, int, string) (Page, error)
	Token(context.Context, int64, string) (Token, error)
	CreatorTokens(context.Context, int64, string, int, string) (Page, error)
	Creator(context.Context, int64, string, int, string) (CreatorProfile, error)
	Trades(context.Context, int64, string, int, string) (TradePage, error)
	Activity(context.Context, int64, string, int, string) (ActivityPage, error)
	Chart(context.Context, int64, string, string, int) (ChartPage, error)
	ChartRange(context.Context, int64, string, string, *int64, *int64, int) (ChartPage, error)
	SaveMetadataDraft(context.Context, MetadataDraft) error
	FinalizeMetadata(context.Context, int64, string, string, string, string) error
	WalletHoldings(context.Context, int64, string, int, string) (HoldingPage, error)
	CTOStatus(context.Context, int64, string) (CTOStatus, error)
	CTOProposals(context.Context, int64, string, int, string) (CTOProposalPage, error)
	CTOProposal(context.Context, int64, string) (CTOProposal, error)
	CTOTreasury(context.Context, int64, string, int) (CTOTreasury, error)
	CTOTreasuryTransfers(context.Context, int64, string, int, string) (CTOTreasuryTransferPage, error)
	CTOTreasuryFeePulls(context.Context, int64, string, int, string) (CTOFeePullPage, error)
	CTOCheckpoints(context.Context, int64, string, int, string) (CTOCheckpointPage, error)
}
type PostgresRepository struct{ pool *pgxpool.Pool }

const canonicalIndexerName = "cooket-arc-testnet"

// snapshot opens a repeatable-read view shared by a response and its indexer
// checkpoint. ApplyWithProvenance commits projections and this checkpoint in
// one transaction, so indexed_through_block means every projection in this
// response is canonical through that whole block.
func (r *PostgresRepository) snapshot(ctx context.Context, chain int64) (pgx.Tx, uint64, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, 0, err
	}
	var block uint64
	err = tx.QueryRow(ctx, `SELECT last_block_number FROM indexer_checkpoints WHERE chain_id=$1 AND indexer_name=$2`, chain, canonicalIndexerName).Scan(&block)
	if err == pgx.ErrNoRows {
		return tx, 0, nil
	}
	if err != nil {
		tx.Rollback(ctx)
		return nil, 0, err
	}
	return tx, block, nil
}

func NewPostgresRepository(ctx context.Context, url string) (*PostgresRepository, error) {
	p, e := pgxpool.New(ctx, url)
	if e != nil {
		return nil, e
	}
	r := &PostgresRepository{pool: p}
	if e = r.requireSchema(ctx); e != nil {
		p.Close()
		return nil, e
	}
	return r, nil
}
func (r *PostgresRepository) requireSchema(ctx context.Context) error {
	var ready bool
	e := r.pool.QueryRow(ctx, `SELECT
		(SELECT array_agg(version ORDER BY version) FROM schema_migrations) = ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14]
		AND to_regclass('public.tokens') IS NOT NULL
		AND to_regclass('public.token_metadata_drafts') IS NOT NULL
		AND to_regclass('public.token_holder_balances') IS NOT NULL
		AND to_regclass('public.token_trade_buckets') IS NOT NULL
		AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tokens' AND column_name='token_decimals')
		AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='token_metadata_drafts' AND column_name='creator_address')
		AND to_regclass('public.token_holder_balances_holder_positive') IS NOT NULL
			AND to_regclass('public.application_token_exclusions') IS NOT NULL
		AND to_regclass('public.cto_treasuries') IS NOT NULL
		AND to_regclass('public.cto_proposals') IS NOT NULL
		AND to_regclass('public.cto_token_state') IS NOT NULL
		AND to_regclass('public.cto_creator_fee_checkpoint_ledger') IS NOT NULL
		AND to_regclass('public.cto_supported_assets') IS NOT NULL
		AND to_regclass('public.cto_treasury_transfers') IS NOT NULL
		AND to_regclass('public.cto_fee_pulls') IS NOT NULL
		AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='graduations' AND column_name='native_usdc_amount')
		AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='graduations' AND column_name='eth_amount')`).Scan(&ready)
	if e != nil {
		return fmt.Errorf("database schema is not ready; run db/migrate.sh: %w", e)
	}
	if !ready {
		return errors.New("database schema is not ready; run db/migrate.sh")
	}
	return nil
}
func (r *PostgresRepository) Close()                         { r.pool.Close() }
func (r *PostgresRepository) Ping(ctx context.Context) error { return r.pool.Ping(ctx) }

const tokenSelect = `SELECT t.token_address,t.creator_address,t.name,t.symbol,t.initial_supply,coalesce(t.description,''),coalesce(t.image_url,''),coalesce(t.metadata_url,''),coalesce(t.website_url,''),coalesce(t.x_url,''),coalesce(t.telegram_url,''),coalesce(t.discord_url,''),t.block_number,launch_block.block_timestamp,t.transaction_hash,t.log_index,
 c.curve_address,c.canonical_pool_address,c.curve_supply,c.sold_supply,c.reserve_balance,c.starting_price,c.slope,c.graduation_threshold,c.lifecycle,
 m.trade_count,m.buy_count,m.sell_count,m.volume,m.fees,m.unique_trader_count,m.latest_trade_timestamp,m.current_price,m.fully_diluted_value,m.holder_count,
 latest_trade.source,
 g.phase,g.graduation_manager_address,g.token_amount,g.native_usdc_amount::text,g.sold_supply,g.block_number,g.transaction_hash,g.log_index,
 le.lp_custodian_address,le.position_token_id,le.liquidity_amount,le.block_number,le.transaction_hash,le.log_index,
 g.liquidity_token_address,g.quote_amount,g.liquidity_amount,g.lock_id,g.unlock_timestamp
	 FROM (SELECT DISTINCT ON (lower(token_address)) * FROM tokens WHERE chain_id=$1 AND is_canonical
	   AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=tokens.chain_id AND x.token_address=lower(tokens.token_address))
	   ORDER BY lower(token_address),block_number DESC,log_index DESC,token_address ASC) t
	 LEFT JOIN chain_blocks launch_block ON launch_block.chain_id=t.chain_id AND launch_block.block_hash=t.block_hash AND launch_block.is_canonical
	 LEFT JOIN LATERAL (SELECT * FROM curves c WHERE c.chain_id=$1 AND lower(c.token_address)=lower(t.token_address) AND c.is_canonical ORDER BY c.block_number DESC,c.log_index DESC LIMIT 1)c ON true
	 LEFT JOIN LATERAL (SELECT * FROM token_metrics m WHERE m.chain_id=t.chain_id AND lower(m.token_address)=lower(t.token_address) ORDER BY (m.token_address=t.token_address) DESC,m.block_number DESC,m.log_index DESC LIMIT 1) m ON true
 LEFT JOIN LATERAL (SELECT tr.source FROM trades tr WHERE tr.chain_id=t.chain_id AND lower(tr.token_address)=lower(t.token_address) AND tr.is_canonical ORDER BY tr.block_number DESC,tr.transaction_index DESC,tr.log_index DESC,tr.transaction_hash DESC LIMIT 1) latest_trade ON true
 LEFT JOIN LATERAL (SELECT * FROM graduations g WHERE g.chain_id=$1 AND lower(g.token_address)=lower(t.token_address) AND g.is_canonical ORDER BY g.block_number DESC,g.log_index DESC LIMIT 1)g ON true
 LEFT JOIN LATERAL (SELECT * FROM liquidity_events le WHERE le.chain_id=$1 AND lower(le.token_address)=lower(t.token_address) AND le.is_canonical AND le.event_name='GraduatedV3' AND lower(le.transaction_hash)=lower(g.transaction_hash) AND le.block_hash=g.block_hash AND lower(le.graduation_manager_address)=lower(g.graduation_manager_address) ORDER BY le.log_index DESC LIMIT 1)le ON true`

func scanToken(row pgx.Row) (Token, error) {
	var t Token
	var caddr, poolAddress, csupply, sold, reserve, start, slope, threshold, life *string
	var phase, manager, ta, nativeUsdcAmount, graduationSold *string
	var custodian, positionTokenID, liquidity *string
	var legacyLiquidityToken, legacyQuote, legacyLiquidity, legacyLockID *string
	var tc, bc, sc, uniqueTraders, latestTrade, holders *int64
	var vol, fees, price, fullyDilutedValue, latestTradeSource *string
	var curveBlock, curveLog, settlementBlock, settlementLog *int64
	var curveTx, settlementTx *string
	var legacyUnlock *int64
	e := row.Scan(&t.Address, &t.Creator, &t.Name, &t.Symbol, &t.InitialSupply, &t.Description, &t.ImageURL, &t.MetadataURL, &t.WebsiteURL, &t.XURL, &t.TelegramURL, &t.DiscordURL, &t.CreatedAt.BlockNumber, &t.CreatedAt.BlockTimestamp, &t.CreatedAt.TransactionHash, &t.CreatedAt.LogIndex, &caddr, &poolAddress, &csupply, &sold, &reserve, &start, &slope, &threshold, &life, &tc, &bc, &sc, &vol, &fees, &uniqueTraders, &latestTrade, &price, &fullyDilutedValue, &holders, &latestTradeSource, &phase, &manager, &ta, &nativeUsdcAmount, &graduationSold, &curveBlock, &curveTx, &curveLog, &custodian, &positionTokenID, &liquidity, &settlementBlock, &settlementTx, &settlementLog, &legacyLiquidityToken, &legacyQuote, &legacyLiquidity, &legacyLockID, &legacyUnlock)
	if e != nil {
		return t, e
	}
	if caddr != nil {
		t.Curve = &Curve{Address: *caddr, CanonicalPoolAddress: optionalValue(poolAddress), SoldSupply: value(sold), ReserveBalance: value(reserve), Supply: value(csupply), StartingPrice: value(start), Slope: value(slope), GraduationThreshold: value(threshold), Lifecycle: value(life)}
	}
	t.Metrics = Metrics{TradeCount: valueInt(tc), BuyCount: valueInt(bc), SellCount: valueInt(sc), Volume: value(vol), Fees: value(fees), UniqueTraderCount: valueInt(uniqueTraders), LatestTradeTimestamp: latestTrade, CurrentPrice: price, FullyDilutedValue: fullyDilutedValue, HolderCount: holders}
	t.LatestTradeSource = latestTradeSource
	if phase != nil {
		graduation := &Graduation{
			Phase:                    *phase,
			CanonicalPoolAddress:     optionalValue(poolAddress),
			GraduationManagerAddress: optionalValue(manager),
			LPCustodianAddress:       optionalValue(custodian),
			PositionTokenID:          optionalValue(positionTokenID),
			Liquidity:                optionalValue(liquidity),
			TokenAmount:              optionalValue(ta),
			NativeUsdcAmount:         optionalValue(nativeUsdcAmount),
			SoldSupply:               optionalValue(graduationSold),
			LiquidityToken:           legacyLiquidityToken,
			QuoteAmount:              legacyQuote,
			LiquidityAmount:          legacyLiquidity,
			LockID:                   legacyLockID,
			UnlockTimestamp:          legacyUnlock,
		}
		if curveBlock != nil && curveTx != nil && curveLog != nil {
			graduation.CurveTerminalAt = &BlockRef{BlockNumber: *curveBlock, TransactionHash: *curveTx, LogIndex: *curveLog}
		}
		if settlementBlock != nil && settlementTx != nil && settlementLog != nil {
			graduation.SettledAt = &BlockRef{BlockNumber: *settlementBlock, TransactionHash: *settlementTx, LogIndex: *settlementLog}
		}
		t.Graduation = graduation
	}
	return t, nil
}
func (r *PostgresRepository) SaveMetadataDraft(ctx context.Context, d MetadataDraft) error {
	_, e := r.pool.Exec(ctx, `INSERT INTO token_metadata_drafts(draft_id,name,symbol,initial_supply,description,image_url,metadata_url,website_url,x_url,telegram_url,discord_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, d.ID, d.Name, d.Symbol, d.InitialSupply, d.Description, d.ImageURL, d.MetadataURL, emptyNull(d.WebsiteURL), emptyNull(d.XURL), emptyNull(d.TelegramURL), emptyNull(d.DiscordURL))
	return e
}
func (r *PostgresRepository) FinalizeMetadata(ctx context.Context, chain int64, draftID, token, txHash, creator string) error {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var name, symbol, supply, description, imageURL, metadataURL, finalizedToken, finalizedTx, finalizedCreator string
	var websiteURL, xURL, telegramURL, discordURL *string
	var finalized bool
	e = tx.QueryRow(ctx, `SELECT name,symbol,initial_supply::text,description,image_url,metadata_url,website_url,x_url,telegram_url,discord_url,coalesce(token_address,''),coalesce(transaction_hash,''),coalesce(creator_address,''),finalized_at IS NOT NULL FROM token_metadata_drafts WHERE draft_id=$1 FOR UPDATE`, draftID).Scan(&name, &symbol, &supply, &description, &imageURL, &metadataURL, &websiteURL, &xURL, &telegramURL, &discordURL, &finalizedToken, &finalizedTx, &finalizedCreator, &finalized)
	if errors.Is(e, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if e != nil {
		return e
	}
	if (finalizedToken != "" || finalizedTx != "") && (!strings.EqualFold(finalizedToken, token) || !strings.EqualFold(finalizedTx, txHash)) {
		return ErrMetadataMismatch
	}
	if finalizedCreator != "" && !strings.EqualFold(finalizedCreator, creator) {
		return ErrMetadataMismatch
	}
	if !finalized && finalizedToken == "" && finalizedTx == "" {
		// Serialize claims for this launch identity. The recovered creator is part
		// of the durable claim, so an unrelated signer cannot reserve or block the
		// canonical creator's launch.
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, fmt.Sprintf("%d:%s:%s", chain, strings.ToLower(token), strings.ToLower(txHash))); e != nil {
			return e
		}
		var claimed bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM token_metadata_drafts WHERE draft_id<>$1 AND lower(token_address)=lower($2) AND lower(transaction_hash)=lower($3) AND lower(creator_address)=lower($4))`, draftID, token, txHash, creator).Scan(&claimed)
		if e != nil {
			return e
		}
		if claimed {
			return ErrMetadataMismatch
		}
		if _, e = tx.Exec(ctx, `UPDATE token_metadata_drafts SET token_address=$2,transaction_hash=$3,creator_address=$4 WHERE draft_id=$1`, draftID, token, txHash, creator); e != nil {
			return e
		}
	} else if finalizedCreator == "" {
		if _, e = tx.Exec(ctx, `UPDATE token_metadata_drafts SET creator_address=$2 WHERE draft_id=$1`, draftID, creator); e != nil {
			return e
		}
	}
	var indexedName, indexedSymbol, indexedSupply string
	var indexedCreator string
	e = tx.QueryRow(ctx, `SELECT name,symbol,initial_supply::text,creator_address FROM tokens WHERE chain_id=$1 AND lower(token_address)=lower($2) AND lower(transaction_hash)=lower($3) AND is_canonical`, chain, token, txHash).Scan(&indexedName, &indexedSymbol, &indexedSupply, &indexedCreator)
	if errors.Is(e, pgx.ErrNoRows) {
		if e = tx.Commit(ctx); e != nil {
			return e
		}
		return ErrMetadataPending
	}
	if e != nil {
		return e
	}
	if indexedName != name || indexedSymbol != symbol || indexedSupply != supply || !strings.EqualFold(indexedCreator, creator) {
		return ErrMetadataMismatch
	}
	result, e := tx.Exec(ctx, `UPDATE tokens SET description=$4,image_url=$5,metadata_url=$6,website_url=$7,x_url=$8,telegram_url=$9,discord_url=$10 WHERE chain_id=$1 AND lower(token_address)=lower($2) AND lower(transaction_hash)=lower($3) AND is_canonical`, chain, token, txHash, description, imageURL, metadataURL, websiteURL, xURL, telegramURL, discordURL)
	if e != nil {
		return e
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	_, e = tx.Exec(ctx, `UPDATE token_metadata_drafts SET token_address=$2,transaction_hash=$3,creator_address=$4,finalized_at=coalesce(finalized_at,now()) WHERE draft_id=$1`, draftID, token, txHash, creator)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func value(v *string) string {
	if v == nil {
		return "0"
	}
	return *v
}
func optionalValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func emptyNull(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func valueInt(v *int64) int64 {
	if v == nil {
		return 0
	}
	return *v
}

type pageCursor struct {
	Kind             string `json:"k"`
	BlockNumber      int64  `json:"b"`
	TokenAddress     string `json:"a,omitempty"`
	Transaction      string `json:"t,omitempty"`
	TransactionIndex int64  `json:"i,omitempty"`
	LogIndex         int64  `json:"l,omitempty"`
	TradeCount       int64  `json:"n,omitempty"`
	Volume           string `json:"v,omitempty"`
	RecentTrades     int64  `json:"r,omitempty"`
	RecentUsers      int64  `json:"u,omitempty"`
	Query            string `json:"q,omitempty"`
	ProposalID       string `json:"p,omitempty"`
	View             string `json:"w,omitempty"`
	Threshold        string `json:"h,omitempty"`
}

func encodeCursor(c pageCursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}
func decodeCursor(raw, kind string) (pageCursor, error) {
	var c pageCursor
	if raw == "" {
		return c, nil
	}
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil || json.Unmarshal(b, &c) != nil || c.Kind != kind || c.BlockNumber < 0 {
		return pageCursor{}, ErrInvalidCursor
	}
	if (kind == "tokens" || kind == "creator" || kind == "holdings") && !validCursorHex(c.TokenAddress, 40) {
		return pageCursor{}, ErrInvalidCursor
	}
	if kind == "trending" && (!validCursorHex(c.TokenAddress, 40) || c.Volume == "") {
		return pageCursor{}, ErrInvalidCursor
	}
	if kind == "search" && (!validCursorHex(c.TokenAddress, 40) || c.Query == "") {
		return pageCursor{}, ErrInvalidCursor
	}
	if kind == "discovery" {
		if !validCursorHex(c.TokenAddress, 40) || (c.View != "top" && c.View != "near" && c.View != "linked") {
			return pageCursor{}, ErrInvalidCursor
		}
		if (c.View == "top" && !validCursorInteger(c.Volume, true)) || (c.View == "near" && (!validCursorInteger(c.Volume, true) || !validCursorInteger(c.Threshold, false))) {
			return pageCursor{}, ErrInvalidCursor
		}
	}
	if (kind == "trades" || kind == "activity") && (!validCursorHex(c.Transaction, 64) || c.TransactionIndex < 0 || c.LogIndex < 0) {
		return pageCursor{}, ErrInvalidCursor
	}
	if kind == "cto_proposals" && (!validCursorHex(c.Transaction, 64) || !validCursorHex(c.ProposalID, 64) || c.LogIndex < 0) {
		return pageCursor{}, ErrInvalidCursor
	}
	if (kind == "cto_checkpoints" || kind == "cto_transfers" || kind == "cto_fee_pulls") && (!validCursorHex(c.Transaction, 64) || c.LogIndex < 0) {
		return pageCursor{}, ErrInvalidCursor
	}
	return c, nil
}
func (r *PostgresRepository) SearchTokens(ctx context.Context, chain int64, query string, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "search")
	if e != nil {
		return Page{}, e
	}
	query = strings.ToLower(strings.TrimSpace(query))
	if rawCursor != "" && c.Query != query {
		return Page{}, ErrInvalidCursor
	}
	args := []any{chain, query + "%"}
	where := " AND (lower(t.name) LIKE $2 OR lower(t.symbol) LIKE $2 OR lower(t.token_address) LIKE $2)"
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.TokenAddress)
		where += " AND (t.block_number < $3 OR (t.block_number = $3 AND t.token_address > $4))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE 1=1"+where+" ORDER BY t.block_number DESC,t.token_address ASC LIMIT $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, e := scanToken(rows)
		if e != nil {
			return Page{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "search", Query: query, BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address})
	}
	return out, nil
}
func validCursorHex(value string, bytes int) bool {
	if len(value) != bytes+2 || value[:2] != "0x" {
		return false
	}
	_, e := hex.DecodeString(value[2:])
	return e == nil
}

func validCursorInteger(value string, allowZero bool) bool {
	if value == "" {
		return false
	}
	allZero := true
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return false
		}
		allZero = allZero && digit == '0'
	}
	return allowZero || !allZero
}

func (r *PostgresRepository) ListTokens(ctx context.Context, chain int64, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "tokens")
	if e != nil {
		return Page{}, e
	}
	args := []any{chain}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.TokenAddress)
		where = " AND (t.block_number < $2 OR (t.block_number = $2 AND t.token_address > $3))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE 1=1"+where+" ORDER BY t.block_number DESC,t.token_address ASC LIMIT $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, e := scanToken(rows)
		if e != nil {
			return Page{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "tokens", BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address})
	}
	return out, nil
}

// DiscoveryTokens provides stable, server-side filtered views for the launch
// marketplace. The cursor carries the complete ordering tuple for its view so
// clients never need to fetch the whole token set or re-rank partial pages.
func (r *PostgresRepository) DiscoveryTokens(ctx context.Context, chain int64, view string, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "discovery")
	if e != nil || (rawCursor != "" && c.View != view) {
		return Page{}, ErrInvalidCursor
	}
	args := []any{chain}
	where, order := "", ""
	switch view {
	case "linked":
		where = " AND coalesce(t.x_url,'')<>''"
		if rawCursor != "" {
			args = append(args, c.BlockNumber, c.TokenAddress)
			where += " AND (t.block_number<$2 OR (t.block_number=$2 AND t.token_address>$3))"
		}
		order = " ORDER BY t.block_number DESC,t.token_address ASC"
	case "top":
		if rawCursor != "" {
			args = append(args, c.Volume, c.BlockNumber, c.TokenAddress)
			where = " AND (coalesce(m.fully_diluted_value,0)<$2 OR (coalesce(m.fully_diluted_value,0)=$2 AND t.block_number<$3) OR (coalesce(m.fully_diluted_value,0)=$2 AND t.block_number=$3 AND t.token_address>$4))"
		}
		order = " ORDER BY coalesce(m.fully_diluted_value,0) DESC,t.block_number DESC,t.token_address ASC"
	case "near":
		where = " AND c.lifecycle='active' AND c.graduation_threshold>0 AND c.sold_supply<c.graduation_threshold"
		if rawCursor != "" {
			args = append(args, c.Volume, c.Threshold, c.BlockNumber, c.TokenAddress)
			where += " AND ((c.sold_supply*$3)<($2*c.graduation_threshold) OR ((c.sold_supply*$3)=($2*c.graduation_threshold) AND t.block_number<$4) OR ((c.sold_supply*$3)=($2*c.graduation_threshold) AND t.block_number=$4 AND t.token_address>$5))"
		}
		order = " ORDER BY (c.sold_supply/c.graduation_threshold) DESC,t.block_number DESC,t.token_address ASC"
	default:
		return Page{}, ErrInvalidCursor
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE 1=1"+where+order+" LIMIT $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, scanErr := scanToken(rows)
		if scanErr != nil {
			return Page{}, scanErr
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		next := pageCursor{Kind: "discovery", View: view, BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address}
		if view == "top" {
			next.Volume = optionalValue(last.Metrics.FullyDilutedValue)
			if next.Volume == "" {
				next.Volume = "0"
			}
		}
		if view == "near" && last.Curve != nil {
			next.Volume, next.Threshold = last.Curve.SoldSupply, last.Curve.GraduationThreshold
		}
		out.NextCursor = encodeCursor(next)
	}
	return out, nil
}
func (r *PostgresRepository) TrendingTokens(ctx context.Context, chain int64, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "trending")
	if e != nil {
		return Page{}, e
	}
	args := []any{chain}
	where := ""
	if rawCursor != "" {
		args = append(args, c.Volume, c.RecentTrades, c.RecentUsers, c.BlockNumber, c.TokenAddress)
		where = " AND (COALESCE(m.recent_volume,0) < $2 OR (COALESCE(m.recent_volume,0) = $2 AND COALESCE(m.recent_trade_count,0) < $3) OR (COALESCE(m.recent_volume,0) = $2 AND COALESCE(m.recent_trade_count,0) = $3 AND COALESCE(m.recent_trader_count,0) < $4) OR (COALESCE(m.recent_volume,0) = $2 AND COALESCE(m.recent_trade_count,0) = $3 AND COALESCE(m.recent_trader_count,0) = $4 AND t.block_number < $5) OR (COALESCE(m.recent_volume,0) = $2 AND COALESCE(m.recent_trade_count,0) = $3 AND COALESCE(m.recent_trader_count,0) = $4 AND t.block_number = $5 AND t.token_address > $6))"
	}
	args = append(args, limit+1)
	// Stable ranking: trailing canonical 24h volume, then trade count, then
	// distinct traders, then launch block and address. The window is indexed.
	order := " ORDER BY COALESCE(m.recent_volume,0) DESC,COALESCE(m.recent_trade_count,0) DESC,COALESCE(m.recent_trader_count,0) DESC,t.block_number DESC,t.token_address ASC LIMIT $" + strconv.Itoa(len(args))
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE 1=1"+where+order, args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, e := scanToken(rows)
		if e != nil {
			return Page{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		var recentVolume string
		var recentTrades, recentUsers int64
		e = r.pool.QueryRow(ctx, `SELECT recent_volume::text,recent_trade_count,recent_trader_count FROM token_metrics WHERE chain_id=$1 AND lower(token_address)=lower($2) ORDER BY (token_address=$2) DESC,block_number DESC,log_index DESC LIMIT 1`, chain, last.Address).Scan(&recentVolume, &recentTrades, &recentUsers)
		if e != nil {
			return Page{}, e
		}
		out.NextCursor = encodeCursor(pageCursor{Kind: "trending", Volume: recentVolume, RecentTrades: recentTrades, RecentUsers: recentUsers, BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address})
	}
	return out, nil
}
func (r *PostgresRepository) Token(ctx context.Context, chain int64, address string) (Token, error) {
	tx, indexedThrough, e := r.snapshot(ctx, chain)
	if e != nil {
		return Token{}, e
	}
	defer tx.Rollback(ctx)
	t, e := scanToken(tx.QueryRow(ctx, tokenSelect+" WHERE lower(t.token_address)=lower($2)", chain, address))
	if errors.Is(e, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	if e != nil {
		return t, e
	}
	t.IndexedThroughBlock = indexedThrough
	if e = tx.Commit(ctx); e != nil {
		return Token{}, e
	}
	return t, nil
}
func (r *PostgresRepository) CreatorTokens(ctx context.Context, chain int64, creator string, limit int, rawCursor string) (Page, error) {
	c, e := decodeCursor(rawCursor, "creator")
	if e != nil {
		return Page{}, e
	}
	args := []any{chain, creator}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.TokenAddress)
		where = " AND (t.block_number < $3 OR (t.block_number = $3 AND t.token_address > $4))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, tokenSelect+" WHERE lower(t.creator_address)=lower($2)"+where+" ORDER BY t.block_number DESC,t.token_address ASC LIMIT $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		return Page{}, e
	}
	defer rows.Close()
	out := Page{Items: []Token{}}
	for rows.Next() {
		t, e := scanToken(rows)
		if e != nil {
			return Page{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return Page{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "creator", BlockNumber: last.CreatedAt.BlockNumber, TokenAddress: last.Address})
	}
	return out, nil
}
func (r *PostgresRepository) Creator(ctx context.Context, chain int64, creator string, limit int, cursor string) (CreatorProfile, error) {
	tokens, e := r.CreatorTokens(ctx, chain, creator, limit, cursor)
	if e != nil {
		return CreatorProfile{}, e
	}
	var count int64
	var volume string
	e = r.pool.QueryRow(ctx, `SELECT count(*),coalesce((SELECT sum(CASE WHEN tr.source='uniswap_v3' THEN tr.reserve_amount*1000000000000::numeric ELSE tr.curve_value END) FROM trades tr JOIN tokens tk ON tk.chain_id=tr.chain_id AND lower(tk.token_address)=lower(tr.token_address) AND tk.is_canonical WHERE tr.chain_id=$1 AND tr.is_canonical AND lower(tk.creator_address)=lower($2) AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=tk.chain_id AND x.token_address=lower(tk.token_address))),'0') FROM tokens tk WHERE chain_id=$1 AND lower(creator_address)=lower($2) AND is_canonical AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=tk.chain_id AND x.token_address=lower(tk.token_address))`, chain, creator).Scan(&count, &volume)
	if e != nil {
		return CreatorProfile{}, e
	}
	return CreatorProfile{Address: creator, TokenCount: count, Volume: volume, Tokens: tokens.Items, NextCursor: tokens.NextCursor}, nil
}

func (r *PostgresRepository) WalletHoldings(ctx context.Context, chain int64, holder string, limit int, rawCursor string) (HoldingPage, error) {
	cursor, err := decodeCursor(rawCursor, "holdings")
	if err != nil {
		return HoldingPage{}, err
	}
	tx, indexedThrough, err := r.snapshot(ctx, chain)
	if err != nil {
		return HoldingPage{}, err
	}
	defer tx.Rollback(ctx)
	args := []any{chain, holder}
	where := ""
	if rawCursor != "" {
		args = append(args, cursor.TokenAddress)
		where = " AND lower(t.token_address)>lower($3)"
	}
	args = append(args, limit+1)
	rows, err := tx.Query(ctx, `WITH canonical_tokens AS (
		SELECT DISTINCT ON (lower(token_address)) chain_id,token_address,name,symbol,coalesce(image_url,'') image_url,token_decimals
		FROM tokens
		WHERE chain_id=$1 AND is_canonical
			AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=tokens.chain_id AND x.token_address=lower(tokens.token_address))
		ORDER BY lower(token_address),block_number DESC,log_index DESC,token_address ASC
	)
	SELECT t.token_address,t.name,t.symbol,t.image_url,b.balance::text,t.token_decimals,coalesce(c.lifecycle,''),m.current_price::text,
		CASE WHEN m.current_price IS NULL THEN NULL ELSE floor(b.balance*m.current_price/power(10::numeric,t.token_decimals))::text END,
		coalesce(m.trade_count,0),coalesce(m.volume,0)::text,m.holder_count
	FROM token_holder_balances b
	JOIN canonical_tokens t ON t.chain_id=b.chain_id AND lower(t.token_address)=lower(b.token_address)
	LEFT JOIN LATERAL (SELECT lifecycle FROM curves c WHERE c.chain_id=t.chain_id AND lower(c.token_address)=lower(t.token_address) AND c.is_canonical ORDER BY c.block_number DESC,c.log_index DESC LIMIT 1) c ON true
	LEFT JOIN LATERAL (SELECT current_price,trade_count,volume,holder_count FROM token_metrics m WHERE m.chain_id=t.chain_id AND lower(m.token_address)=lower(t.token_address) ORDER BY m.block_number DESC,m.log_index DESC LIMIT 1) m ON true
	WHERE b.chain_id=$1 AND lower(b.holder_address)=lower($2) AND b.balance>0`+where+`
	ORDER BY lower(t.token_address),t.token_address LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return HoldingPage{}, err
	}
	defer rows.Close()
	out := HoldingPage{IndexedThroughBlock: indexedThrough, Items: []Holding{}}
	for rows.Next() {
		var item Holding
		if err = rows.Scan(&item.TokenAddress, &item.Name, &item.Symbol, &item.ImageURL, &item.RawBalance, &item.TokenDecimals, &item.Lifecycle, &item.CurrentPrice, &item.EstimatedValue, &item.Metrics.TradeCount, &item.Metrics.Volume, &item.Metrics.HolderCount); err != nil {
			return HoldingPage{}, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return HoldingPage{}, err
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		out.NextCursor = encodeCursor(pageCursor{Kind: "holdings", TokenAddress: out.Items[len(out.Items)-1].TokenAddress})
	}
	if err = tx.Commit(ctx); err != nil {
		return HoldingPage{}, err
	}
	return out, nil
}
func (r *PostgresRepository) Trades(ctx context.Context, chain int64, token string, limit int, rawCursor string) (TradePage, error) {
	c, e := decodeCursor(rawCursor, "trades")
	if e != nil {
		return TradePage{}, e
	}
	args := []any{chain, token}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.TransactionIndex, c.Transaction, c.LogIndex)
		where = " AND (block_number < $3 OR (block_number = $3 AND (transaction_index < $4 OR (transaction_index = $4 AND (transaction_hash < $5 OR (transaction_hash = $5 AND log_index < $6))))))"
	}
	args = append(args, limit+1)
	tx, indexedThrough, e := r.snapshot(ctx, chain)
	if e != nil {
		return TradePage{}, e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, `SELECT token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,source,block_number,transaction_index,transaction_hash,log_index,(SELECT b.block_timestamp FROM chain_blocks b WHERE b.chain_id=trades.chain_id AND b.block_hash=trades.block_hash AND b.is_canonical) FROM trades WHERE chain_id=$1 AND lower(token_address)=lower($2) AND is_canonical AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=trades.chain_id AND x.token_address=lower(trades.token_address))`+where+` ORDER BY block_number DESC,transaction_index DESC,log_index DESC,transaction_hash DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if e != nil {
		return TradePage{}, e
	}
	defer rows.Close()
	out := TradePage{IndexedThroughBlock: indexedThrough, Items: []Trade{}}
	for rows.Next() {
		var t Trade
		e = rows.Scan(&t.TokenAddress, &t.Trader, &t.Side, &t.TokenAmount, &t.ReserveAmount, &t.CurveValue, &t.ProtocolFee, &t.CreatorFee, &t.Source, &t.BlockNumber, &t.TransactionIndex, &t.TransactionHash, &t.LogIndex, &t.BlockTimestamp)
		if e != nil {
			return TradePage{}, e
		}
		out.Items = append(out.Items, t)
	}
	if e = rows.Err(); e != nil {
		return TradePage{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "trades", BlockNumber: last.BlockNumber, TransactionIndex: last.TransactionIndex, Transaction: last.TransactionHash, LogIndex: last.LogIndex})
	}
	if e = tx.Commit(ctx); e != nil {
		return TradePage{}, e
	}
	return out, nil
}
func (r *PostgresRepository) Activity(ctx context.Context, chain int64, token string, limit int, rawCursor string) (ActivityPage, error) {
	c, e := decodeCursor(rawCursor, "activity")
	if e != nil {
		return ActivityPage{}, e
	}
	args := []any{chain, token}
	where := ""
	if rawCursor != "" {
		args = append(args, c.BlockNumber, c.TransactionIndex, c.Transaction, c.LogIndex)
		where = " AND (block_number < $3 OR (block_number = $3 AND (transaction_index < $4 OR (transaction_index = $4 AND (transaction_hash < $5 OR (transaction_hash = $5 AND log_index < $6))))))"
	}
	args = append(args, limit+1)
	rows, e := r.pool.Query(ctx, `SELECT event_name,decoded,block_number,transaction_index,transaction_hash,log_index FROM chain_events WHERE chain_id=$1 AND is_canonical AND (lower(decoded->>'token')=lower($2) OR (event_name='Transfer' AND lower(contract_address)=lower($2))) AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=chain_events.chain_id AND x.token_address=lower($2))`+where+` ORDER BY block_number DESC,transaction_index DESC,log_index DESC,transaction_hash DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if e != nil {
		return ActivityPage{}, e
	}
	defer rows.Close()
	out := ActivityPage{Items: []Activity{}}
	for rows.Next() {
		var a Activity
		var raw []byte
		e = rows.Scan(&a.EventName, &raw, &a.BlockNumber, &a.TransactionIndex, &a.TransactionHash, &a.LogIndex)
		if e != nil {
			return ActivityPage{}, e
		}
		_ = json.Unmarshal(raw, &a.Decoded)
		out.Items = append(out.Items, a)
	}
	if e = rows.Err(); e != nil {
		return ActivityPage{}, e
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(pageCursor{Kind: "activity", BlockNumber: last.BlockNumber, TransactionIndex: last.TransactionIndex, Transaction: last.TransactionHash, LogIndex: last.LogIndex})
	}
	return out, nil
}

var supportedChartIntervals = []string{"1m", "5m", "15m", "1h", "4h", "1d", "1w"}

type chartInterval struct {
	seconds int64
	weekly  bool
}

func parseChartInterval(value string) (chartInterval, bool) {
	intervals := map[string]chartInterval{
		"1m":  {seconds: 60},
		"5m":  {seconds: 5 * 60},
		"15m": {seconds: 15 * 60},
		"1h":  {seconds: 60 * 60},
		"4h":  {seconds: 4 * 60 * 60},
		"1d":  {seconds: 24 * 60 * 60},
		"1w":  {seconds: 7 * 24 * 60 * 60, weekly: true},
	}
	parsed, ok := intervals[value]
	return parsed, ok
}

func (r *PostgresRepository) Chart(ctx context.Context, chain int64, token, interval string, limit int) (ChartPage, error) {
	return r.ChartRange(ctx, chain, token, interval, nil, nil, limit)
}

// ChartRange returns a bounded canonical UTC bucket slice. `to` is exclusive,
// which makes adjacent history requests non-overlapping. Nil bounds retain the
// original most-recent chart behavior for existing clients.
func (r *PostgresRepository) ChartRange(ctx context.Context, chain int64, token, interval string, from, to *int64, limit int) (ChartPage, error) {
	spec, ok := parseChartInterval(interval)
	if !ok {
		return ChartPage{}, fmt.Errorf("unsupported chart interval %q", interval)
	}
	tx, indexedThrough, e := r.snapshot(ctx, chain)
	if e != nil {
		return ChartPage{}, e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, `WITH ordered AS (
		SELECT CASE WHEN $4::boolean
				THEN extract(epoch FROM date_trunc('week', to_timestamp(b.block_timestamp) AT TIME ZONE 'UTC'))::bigint
				ELSE (b.block_timestamp / $3::bigint) * $3::bigint
			END bucket_start,
			t.side,t.source,t.token_amount,t.reserve_amount,t.curve_value,t.trader_address,t.block_number,t.transaction_index,t.transaction_hash,t.log_index,tk.token_decimals,
			sum(CASE WHEN t.source='curve' AND t.side='buy' THEN t.token_amount WHEN t.source='curve' AND t.side='sell' THEN -t.token_amount ELSE 0 END) OVER (ORDER BY t.block_number,t.transaction_index,t.log_index,t.transaction_hash) sold_supply,
			sum(CASE WHEN t.source='curve' AND t.side='buy' THEN t.curve_value WHEN t.source='curve' AND t.side='sell' THEN -t.curve_value ELSE 0 END) OVER (ORDER BY t.block_number,t.transaction_index,t.log_index,t.transaction_hash) reserve_balance
		FROM trades t
		JOIN chain_blocks b ON b.chain_id=t.chain_id AND b.block_hash=t.block_hash AND b.is_canonical
		LEFT JOIN LATERAL (SELECT token_decimals FROM tokens tk WHERE tk.chain_id=t.chain_id AND lower(tk.token_address)=lower(t.token_address) AND tk.is_canonical ORDER BY tk.block_number DESC,tk.log_index DESC LIMIT 1) tk ON true
			WHERE t.chain_id=$1 AND lower(t.token_address)=lower($2) AND t.is_canonical
			  AND NOT EXISTS (SELECT 1 FROM application_token_exclusions x WHERE x.chain_id=t.chain_id AND x.token_address=lower(t.token_address))
	), priced AS (
		SELECT *,CASE WHEN source='uniswap_v3' THEN floor(reserve_amount * power(10::numeric, token_decimals + 12) / NULLIF(token_amount,0))
			WHEN sold_supply >= 0 AND sold_supply < 1066666666666666666666666667::numeric AND reserve_balance >= 0
			THEN ceil(((1000000000000000000::numeric + reserve_balance) * 1000000000000000000::numeric) / (1066666666666666666666666667::numeric - sold_supply)) END price
		FROM ordered
	), buckets AS (
		SELECT bucket_start,count(*) trade_count,count(*) FILTER (WHERE side='buy') buy_count,count(*) FILTER (WHERE side='sell') sell_count,
			coalesce(sum(CASE WHEN source='uniswap_v3' THEN reserve_amount*1000000000000::numeric ELSE curve_value END),0) volume,count(DISTINCT lower(trader_address)) unique_trader_count,
			CASE WHEN count(price)=count(*) THEN (array_agg(price ORDER BY block_number,transaction_index,log_index,transaction_hash))[1] END open_price,
			CASE WHEN count(price)=count(*) THEN max(price) END high_price,
			CASE WHEN count(price)=count(*) THEN min(price) END low_price,
			CASE WHEN count(price)=count(*) THEN (array_agg(price ORDER BY block_number DESC,transaction_index DESC,log_index DESC,transaction_hash DESC))[1] END close_price
		FROM priced GROUP BY bucket_start
	), ranged AS (
		SELECT * FROM buckets WHERE ($5::bigint IS NULL OR bucket_start >= $5) AND ($6::bigint IS NULL OR bucket_start < $6)
	), limited AS (
		SELECT * FROM ranged ORDER BY bucket_start DESC LIMIT $7
	)
	SELECT bucket_start,trade_count,buy_count,sell_count,volume::text,unique_trader_count,open_price::text,high_price::text,low_price::text,close_price::text
	FROM limited ORDER BY bucket_start ASC`, chain, token, spec.seconds, spec.weekly, from, to, limit)
	if e != nil {
		return ChartPage{}, e
	}
	defer rows.Close()
	out := ChartPage{IndexedThroughBlock: indexedThrough, Interval: interval, SupportedIntervals: append([]string(nil), supportedChartIntervals...), Candles: []ChartPoint{}}
	for rows.Next() {
		var point ChartPoint
		if e = rows.Scan(&point.BucketStart, &point.TradeCount, &point.BuyCount, &point.SellCount, &point.Volume, &point.UniqueTraderCount, &point.OpenPrice, &point.HighPrice, &point.LowPrice, &point.ClosePrice); e != nil {
			return ChartPage{}, e
		}
		out.Candles = append(out.Candles, point)
	}
	if e = rows.Err(); e != nil {
		return ChartPage{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return ChartPage{}, e
	}
	return out, nil
}
