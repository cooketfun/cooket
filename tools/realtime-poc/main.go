package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

const (
	arcWebSocketURL = "wss://rpc.testnet.arc.io"
	canonicalPool   = "0x8F064B62AD5D09346E5eb4b664a38319A944Eb6f"
	swapTopic       = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
)

type receivedLog struct {
	ReceivedAt  string   `json:"received_at"`
	BlockNumber uint64   `json:"block_number"`
	Transaction string   `json:"transaction_hash"`
	LogIndex    uint     `json:"log_index"`
	Removed     bool     `json:"removed"`
	Data        string   `json:"data"`
	Topics      []string `json:"topics"`
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := listen(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "realtime-poc: %v\n", err)
		os.Exit(1)
	}
}

func listen(ctx context.Context) error {
	client, err := ethclient.DialContext(ctx, arcWebSocketURL)
	if err != nil {
		return fmt.Errorf("connect to Arc WebSocket RPC: %w", err)
	}
	defer client.Close()

	query := ethereum.FilterQuery{
		Addresses: []common.Address{common.HexToAddress(canonicalPool)},
		Topics:    [][]common.Hash{{common.HexToHash(swapTopic)}},
	}
	logs := make(chan types.Log)
	subscription, err := client.SubscribeFilterLogs(ctx, query, logs)
	if err != nil {
		return fmt.Errorf("subscribe to canonical pool Swap logs: %w", err)
	}
	defer subscription.Unsubscribe()

	fmt.Fprintf(os.Stderr, "realtime-poc: subscribed chain_id=5042002 pool=%s topic0=%s\n", canonicalPool, swapTopic)
	for {
		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.Canceled) {
				fmt.Fprintln(os.Stderr, "realtime-poc: shutdown requested")
				return nil
			}
			return ctx.Err()
		case err, ok := <-subscription.Err():
			if !ok {
				return errors.New("Arc log subscription connection closed")
			}
			if err == nil {
				return errors.New("Arc log subscription ended")
			}
			return fmt.Errorf("Arc log subscription failed: %w", err)
		case entry, ok := <-logs:
			if !ok {
				return errors.New("Arc log subscription delivery channel closed")
			}
			line, err := formatReceivedLog(time.Now(), entry)
			if err != nil {
				return fmt.Errorf("format received Swap log: %w", err)
			}
			fmt.Println(string(line))
		}
	}
}

func formatReceivedLog(receivedAt time.Time, entry types.Log) ([]byte, error) {
	topics := make([]string, len(entry.Topics))
	for index, topic := range entry.Topics {
		topics[index] = topic.Hex()
	}
	return json.Marshal(receivedLog{
		ReceivedAt:  receivedAt.UTC().Format(time.RFC3339Nano),
		BlockNumber: entry.BlockNumber,
		Transaction: entry.TxHash.Hex(),
		LogIndex:    entry.Index,
		Removed:     entry.Removed,
		Data:        "0x" + hex.EncodeToString(entry.Data),
		Topics:      topics,
	})
}
