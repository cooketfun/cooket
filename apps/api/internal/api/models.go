package api

type Token struct {
	Address       string      `json:"address"`
	Creator       string      `json:"creator"`
	Name          string      `json:"name"`
	Symbol        string      `json:"symbol"`
	InitialSupply string      `json:"initial_supply"`
	Description   string      `json:"description,omitempty"`
	ImageURL      string      `json:"image_url,omitempty"`
	MetadataURL   string      `json:"metadata_url,omitempty"`
	WebsiteURL    string      `json:"website_url,omitempty"`
	XURL          string      `json:"x_url,omitempty"`
	TelegramURL   string      `json:"telegram_url,omitempty"`
	DiscordURL    string      `json:"discord_url,omitempty"`
	CreatedAt     BlockRef    `json:"created_at"`
	Curve         *Curve      `json:"curve,omitempty"`
	Metrics       Metrics     `json:"metrics"`
	Graduation    *Graduation `json:"graduation,omitempty"`
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
	Phase                    string    `json:"phase"`
	CanonicalPoolAddress     string    `json:"canonical_pool_address,omitempty"`
	GraduationManagerAddress string    `json:"graduation_manager_address,omitempty"`
	LPCustodianAddress       string    `json:"lp_custodian_address,omitempty"`
	PositionTokenID          string    `json:"position_token_id,omitempty"`
	Liquidity                string    `json:"liquidity,omitempty"`
	TokenAmount              string    `json:"token_amount,omitempty"`
	ETHAmount                string    `json:"eth_amount,omitempty"`
	SoldSupply               string    `json:"sold_supply,omitempty"`
	CurveTerminalAt          *BlockRef `json:"curve_terminal_at,omitempty"`
	SettledAt                *BlockRef `json:"settled_at,omitempty"`
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
	Items      []Trade `json:"items"`
	NextCursor string  `json:"next_cursor,omitempty"`
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
	Interval           string       `json:"interval"`
	SupportedIntervals []string     `json:"supported_intervals"`
	Candles            []ChartPoint `json:"candles"`
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
