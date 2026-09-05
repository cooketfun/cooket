package market

import (
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

const ChainID int64 = 5042002

type Stage string

const (
	StageCurve     Stage = "curve"
	StageGraduated Stage = "graduated"
)

type Source string

const (
	SourceCurve     Source = "curve"
	SourceUniswapV3 Source = "uniswap_v3"
)

type Side string

const (
	SideBuy  Side = "buy"
	SideSell Side = "sell"
)

type Market struct {
	Token            common.Address
	Curve            common.Address
	Stage            Stage
	CanonicalPool    common.Address
	SourceStartBlock uint64
}

func (m Market) Validate() error {
	if m.Token == (common.Address{}) || m.Curve == (common.Address{}) {
		return fmt.Errorf("market token and curve must be nonzero")
	}
	if m.Stage != StageCurve && m.Stage != StageGraduated {
		return fmt.Errorf("unsupported market stage %q", m.Stage)
	}
	if m.Stage == StageGraduated && m.CanonicalPool == (common.Address{}) {
		return fmt.Errorf("graduated market %s has no canonical pool", m.Token.Hex())
	}
	if m.SourceStartBlock == 0 {
		return fmt.Errorf("market %s has no canonical source start block", m.Token.Hex())
	}
	return nil
}

type EventID struct {
	ChainID         int64
	TransactionHash common.Hash
	LogIndex        uint
}

func (id EventID) String() string {
	return fmt.Sprintf("%d:%s:%d", id.ChainID, id.TransactionHash.Hex(), id.LogIndex)
}

type Event struct {
	Identity    string `json:"identity"`
	ChainID     int64  `json:"chain_id"`
	Token       string `json:"token"`
	Market      string `json:"market"`
	Source      Source `json:"source"`
	Side        Side   `json:"side"`
	BlockNumber uint64 `json:"block_number"`
	// BlockTimestamp is the canonical Arc block-header timestamp (Unix seconds).
	// It is omitted only for a removed log whose original header was not cached.
	BlockTimestamp  *uint64           `json:"block_timestamp,omitempty"`
	TransactionHash string            `json:"transaction_hash"`
	LogIndex        uint              `json:"log_index"`
	Removed         bool              `json:"removed"`
	ReceivedAt      time.Time         `json:"received_at"`
	TokenAmountRaw  string            `json:"token_amount_raw"`
	USDCAmountRaw   string            `json:"usdc_amount_raw"`
	USDCDecimals    uint8             `json:"usdc_decimals"`
	RawFields       map[string]string `json:"raw_fields"`
	SqrtPriceX96    string            `json:"sqrt_price_x96,omitempty"`
	Tick            string            `json:"tick,omitempty"`
}

func absolute(value *big.Int) *big.Int {
	return new(big.Int).Abs(new(big.Int).Set(value))
}
