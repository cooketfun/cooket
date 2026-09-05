package market

import (
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

var curveABI = mustABI(`[
{"anonymous":false,"inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"buyer","type":"address"},{"indexed":false,"name":"submittedGross","type":"uint256"},{"indexed":false,"name":"acceptedGross","type":"uint256"},{"indexed":false,"name":"netCurveInput","type":"uint256"},{"indexed":false,"name":"tokensOut","type":"uint256"},{"indexed":false,"name":"totalFee","type":"uint256"},{"indexed":false,"name":"creatorFee","type":"uint256"},{"indexed":false,"name":"protocolFee","type":"uint256"},{"indexed":false,"name":"communityFee","type":"uint256"},{"indexed":false,"name":"traderRewardsFee","type":"uint256"},{"indexed":false,"name":"refund","type":"uint256"}],"name":"TokensBought","type":"event"},
{"anonymous":false,"inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"seller","type":"address"},{"indexed":false,"name":"tokensIn","type":"uint256"},{"indexed":false,"name":"grossCurveOutput","type":"uint256"},{"indexed":false,"name":"netSellerOutput","type":"uint256"},{"indexed":false,"name":"totalFee","type":"uint256"},{"indexed":false,"name":"creatorFee","type":"uint256"},{"indexed":false,"name":"protocolFee","type":"uint256"},{"indexed":false,"name":"communityFee","type":"uint256"},{"indexed":false,"name":"traderRewardsFee","type":"uint256"}],"name":"TokensSold","type":"event"}
]`)

var uniswapV3PoolABI = mustABI(`[
{"anonymous":false,"inputs":[{"indexed":true,"name":"sender","type":"address"},{"indexed":true,"name":"recipient","type":"address"},{"indexed":false,"name":"amount0","type":"int256"},{"indexed":false,"name":"amount1","type":"int256"},{"indexed":false,"name":"sqrtPriceX96","type":"uint160"},{"indexed":false,"name":"liquidity","type":"uint128"},{"indexed":false,"name":"tick","type":"int24"}],"name":"Swap","type":"event"}
]`)

var (
	TokensBoughtTopic = curveABI.Events["TokensBought"].ID
	TokensSoldTopic   = curveABI.Events["TokensSold"].ID
	SwapTopic         = uniswapV3PoolABI.Events["Swap"].ID
)

func SubscriptionTopics() []common.Hash {
	return []common.Hash{TokensBoughtTopic, TokensSoldTopic, SwapTopic}
}

func SubscriptionTopicsFor(source Source) []common.Hash {
	switch source {
	case SourceCurve:
		return []common.Hash{TokensBoughtTopic, TokensSoldTopic}
	case SourceUniswapV3:
		return []common.Hash{SwapTopic}
	default:
		return nil
	}
}

func mustABI(raw string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(raw))
	if err != nil {
		panic(err)
	}
	return parsed
}

func indexedArguments(arguments abi.Arguments) abi.Arguments {
	indexed := make(abi.Arguments, 0, len(arguments))
	for _, argument := range arguments {
		if argument.Indexed {
			indexed = append(indexed, argument)
		}
	}
	return indexed
}
