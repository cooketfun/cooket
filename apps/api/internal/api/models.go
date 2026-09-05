package api

type Token struct {
	IndexedThroughBlock uint64      `json:"indexed_through_block"`
	Address             string      `json:"address"`
	Creator             string      `json:"creator"`
	Name                string      `json:"name"`
	Symbol              string      `json:"symbol"`
	InitialSupply       string      `json:"initial_supply"`
	Description         string      `json:"description,omitempty"`
	ImageURL            string      `json:"image_url,omitempty"`
	MetadataURL         string      `json:"metadata_url,omitempty"`
	WebsiteURL          string      `json:"website_url,omitempty"`
	XURL                string      `json:"x_url,omitempty"`
	TelegramURL         string      `json:"telegram_url,omitempty"`
	DiscordURL          string      `json:"discord_url,omitempty"`
	CreatedAt           BlockRef    `json:"created_at"`
	Curve               *Curve      `json:"curve,omitempty"`
	Metrics             Metrics     `json:"metrics"`
	Graduation          *Graduation `json:"graduation,omitempty"`
	// LatestTradeSource is an internal provenance field used by the pricing
	// endpoint; it is intentionally not part of the public token contract.
	LatestTradeSource *string `json:"-"`
}
type MetadataDraft struct {
	ID            string `json:"draft_id"`
	Name          string `json:"name"`
	Symbol        string `json:"symbol"`
	InitialSupply string `json:"initial_supply"`
	Description   string `json:"description"`
	ImageURL      string `json:"image_url"`
	MetadataURL   string `json:"metadata_url"`
	WebsiteURL    string `json:"website_url,omitempty"`
	XURL          string `json:"x_url,omitempty"`
	TelegramURL   string `json:"telegram_url,omitempty"`
	DiscordURL    string `json:"discord_url,omitempty"`
}
type BlockRef struct {
	BlockNumber     int64  `json:"block_number"`
	BlockTimestamp  *int64 `json:"block_timestamp,omitempty"`
	TransactionHash string `json:"transaction_hash"`
	LogIndex        int64  `json:"log_index"`
}
type Curve struct {
	Address              string `json:"address"`
	CanonicalPoolAddress string `json:"canonical_pool_address,omitempty"`
	Supply               string `json:"supply,omitempty"`
	SoldSupply           string `json:"sold_supply"`
	ReserveBalance       string `json:"reserve_balance"`
	StartingPrice        string `json:"starting_price,omitempty"`
	Slope                string `json:"slope,omitempty"`
	GraduationThreshold  string `json:"graduation_threshold,omitempty"`
	Lifecycle            string `json:"lifecycle,omitempty"`
}
type Metrics struct {
	TradeCount           int64   `json:"trade_count"`
	BuyCount             int64   `json:"buy_count"`
	SellCount            int64   `json:"sell_count"`
	Volume               string  `json:"volume"`
	Fees                 string  `json:"fees"`
	UniqueTraderCount    int64   `json:"unique_trader_count"`
	LatestTradeTimestamp *int64  `json:"latest_trade_timestamp"`
	CurrentPrice         *string `json:"current_price"`
	FullyDilutedValue    *string `json:"fully_diluted_value"`
	HolderCount          *int64  `json:"holder_count"`
}
type Graduation struct {
	Phase                    string `json:"phase"`
	CanonicalPoolAddress     string `json:"canonical_pool_address,omitempty"`
	GraduationManagerAddress string `json:"graduation_manager_address,omitempty"`
	LPCustodianAddress       string `json:"lp_custodian_address,omitempty"`
	PositionTokenID          string `json:"position_token_id,omitempty"`
	Liquidity                string `json:"liquidity,omitempty"`
	TokenAmount              string `json:"token_amount,omitempty"`
	// NativeUsdcAmount is the 18-decimal Arc native-USDC principal forwarded by
	// CooketCurveV3.Graduated. It is an integer decimal string, never float64.
	NativeUsdcAmount string    `json:"native_usdc_amount,omitempty"`
	SoldSupply       string    `json:"sold_supply,omitempty"`
	CurveTerminalAt  *BlockRef `json:"curve_terminal_at,omitempty"`
	SettledAt        *BlockRef `json:"settled_at,omitempty"`
	// Legacy generic fields remain additive for existing clients. Endpoint-cp-v3
	// code must use the explicit fields above.
	LiquidityToken  *string `json:"liquidity_token,omitempty"`
	QuoteAmount     *string `json:"quote_amount,omitempty"`
	LiquidityAmount *string `json:"liquidity_amount,omitempty"`
	LockID          *string `json:"lock_id,omitempty"`
	UnlockTimestamp *int64  `json:"unlock_timestamp,omitempty"`
}
type Page struct {
	Items      []Token `json:"items"`
	NextCursor string  `json:"next_cursor,omitempty"`
}
type TradePage struct {
	IndexedThroughBlock uint64  `json:"indexed_through_block"`
	Items               []Trade `json:"items"`
	NextCursor          string  `json:"next_cursor,omitempty"`
}
type ActivityPage struct {
	Items      []Activity `json:"items"`
	NextCursor string     `json:"next_cursor,omitempty"`
}
type ChartPoint struct {
	BucketStart       int64   `json:"bucket_start"`
	TradeCount        int64   `json:"trade_count"`
	BuyCount          int64   `json:"buy_count"`
	SellCount         int64   `json:"sell_count"`
	Volume            string  `json:"volume"`
	UniqueTraderCount int64   `json:"unique_trader_count"`
	OpenPrice         *string `json:"open_price"`
	HighPrice         *string `json:"high_price"`
	LowPrice          *string `json:"low_price"`
	ClosePrice        *string `json:"close_price"`
}
type ChartPage struct {
	IndexedThroughBlock uint64       `json:"indexed_through_block"`
	Interval            string       `json:"interval"`
	SupportedIntervals  []string     `json:"supported_intervals"`
	Candles             []ChartPoint `json:"candles"`
}
type Pricing struct {
	TokenAddress      string  `json:"token_address"`
	CurrentPrice      *string `json:"current_price"`
	FullyDilutedValue *string `json:"fully_diluted_value"`
	Source            string  `json:"source"`
}
type Trade struct {
	TokenAddress     string `json:"token_address"`
	Trader           string `json:"trader"`
	Side             string `json:"side"`
	TokenAmount      string `json:"token_amount"`
	ReserveAmount    string `json:"reserve_amount"`
	CurveValue       string `json:"curve_value"`
	ProtocolFee      string `json:"protocol_fee"`
	CreatorFee       string `json:"creator_fee"`
	Source           string `json:"source"`
	BlockNumber      int64  `json:"block_number"`
	TransactionIndex int64  `json:"transaction_index"`
	TransactionHash  string `json:"transaction_hash"`
	LogIndex         int64  `json:"log_index"`
}
type Activity struct {
	EventName        string         `json:"event_name"`
	Decoded          map[string]any `json:"decoded"`
	BlockNumber      int64          `json:"block_number"`
	TransactionIndex int64          `json:"transaction_index"`
	TransactionHash  string         `json:"transaction_hash"`
	LogIndex         int64          `json:"log_index"`
}
type CreatorProfile struct {
	Address    string  `json:"address"`
	TokenCount int64   `json:"token_count"`
	Volume     string  `json:"volume"`
	Tokens     []Token `json:"tokens"`
	NextCursor string  `json:"next_cursor,omitempty"`
}

// IndexedProvenance is canonical indexed event identity, including block hash so
// clients can display finality without treating API data as chain authority.
type IndexedProvenance struct {
	BlockNumber     int64  `json:"block_number"`
	BlockHash       string `json:"block_hash"`
	TransactionHash string `json:"transaction_hash"`
	LogIndex        int64  `json:"log_index"`
}

type CTOStatus struct {
	ChainID           int64              `json:"chain_id"`
	Token             string             `json:"token"`
	Active            bool               `json:"active"`
	Registry          string             `json:"registry,omitempty"`
	Treasury          string             `json:"treasury,omitempty"`
	Controller        string             `json:"controller,omitempty"`
	PreviousRecipient string             `json:"previous_recipient,omitempty"`
	ActiveProposalID  string             `json:"active_proposal_id,omitempty"`
	Activation        *IndexedProvenance `json:"activation,omitempty"`
}

type CTOProposal struct {
	ProposalID         string             `json:"proposal_id"`
	Token              string             `json:"token"`
	Registry           string             `json:"registry"`
	Treasury           string             `json:"treasury"`
	Creator            string             `json:"creator"`
	Controller         string             `json:"controller"`
	PreviousRecipient  string             `json:"previous_recipient"`
	Nonce              string             `json:"nonce"`
	MetadataHash       string             `json:"metadata_hash"`
	MetadataURI        string             `json:"metadata_uri"`
	State              string             `json:"state"`
	CreatedTimestamp   int64              `json:"created_timestamp"`
	Created            IndexedProvenance  `json:"created"`
	AcceptanceDeadline int64              `json:"acceptance_deadline"`
	AcceptedAt         *int64             `json:"accepted_at,omitempty"`
	Accepted           *IndexedProvenance `json:"accepted,omitempty"`
	ExecuteAfter       *int64             `json:"execute_after,omitempty"`
	ExecuteDeadline    *int64             `json:"execute_deadline,omitempty"`
	Ready              *IndexedProvenance `json:"ready,omitempty"`
	CancelledAt        *int64             `json:"cancelled_at,omitempty"`
	Cancelled          *IndexedProvenance `json:"cancelled,omitempty"`
	ExpiredAt          *int64             `json:"expired_at,omitempty"`
	Expired            *IndexedProvenance `json:"expired,omitempty"`
	ActivatedAt        *int64             `json:"activated_at,omitempty"`
	Activated          *IndexedProvenance `json:"activated,omitempty"`
	lifecycle          IndexedProvenance  `json:"-"`
}

type CTOProposalPage struct {
	Items      []CTOProposal `json:"items"`
	NextCursor string        `json:"next_cursor,omitempty"`
}

type CTOSupportedAsset struct {
	Asset      string            `json:"asset"`
	Controller string            `json:"controller"`
	Registered IndexedProvenance `json:"registered"`
}

type CTOTreasuryTransfer struct {
	Asset      string            `json:"asset"`
	Recipient  string            `json:"recipient"`
	Amount     string            `json:"amount"`
	Controller string            `json:"controller"`
	Provenance IndexedProvenance `json:"provenance"`
}

type CTOFeePull struct {
	Token       string            `json:"token"`
	Asset       string            `json:"asset"`
	Amount      string            `json:"amount"`
	TriggeredBy string            `json:"triggered_by"`
	Provenance  IndexedProvenance `json:"provenance"`
}

type CTOTreasuryTransferPage struct {
	Items      []CTOTreasuryTransfer `json:"items"`
	NextCursor string                `json:"next_cursor,omitempty"`
}

type CTOFeePullPage struct {
	Items      []CTOFeePull `json:"items"`
	NextCursor string       `json:"next_cursor,omitempty"`
}

type CTOTreasury struct {
	Treasury            string                `json:"treasury"`
	Registry            string                `json:"registry"`
	Token               string                `json:"token"`
	Controller          string                `json:"controller"`
	CanonicalUsdc       string                `json:"canonical_usdc,omitempty"`
	Nonce               string                `json:"nonce"`
	Deployment          IndexedProvenance     `json:"deployment"`
	SupportedAssets     []CTOSupportedAsset   `json:"supported_assets"`
	RecentTransfers     []CTOTreasuryTransfer `json:"recent_transfers"`
	TransfersNextCursor string                `json:"transfers_next_cursor,omitempty"`
	RecentFeePulls      []CTOFeePull          `json:"recent_fee_pulls"`
	FeePullsNextCursor  string                `json:"fee_pulls_next_cursor,omitempty"`
}

type CTOCheckpointAggregate struct {
	Token        string `json:"token"`
	Recipient    string `json:"recipient"`
	Checkpointed string `json:"checkpointed"`
	Claimed      string `json:"claimed"`
	Outstanding  string `json:"outstanding"`
}

type CTOCheckpointEvent struct {
	Recipient   string            `json:"recipient"`
	Action      string            `json:"action"`
	Amount      string            `json:"amount"`
	TriggeredBy string            `json:"triggered_by,omitempty"`
	Provenance  IndexedProvenance `json:"provenance"`
}

type CTOCheckpointPage struct {
	Token      string                   `json:"token"`
	Aggregates []CTOCheckpointAggregate `json:"aggregates"`
	Items      []CTOCheckpointEvent     `json:"items"`
	NextCursor string                   `json:"next_cursor,omitempty"`
}
