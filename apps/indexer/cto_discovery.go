package indexer

import (
	"context"
	"fmt"
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func callView(ctx context.Context, rpc RPC, contract common.Address, decoder abi.ABI, method string, block *big.Int, args ...any) ([]any, error) {
	m, ok := decoder.Methods[method]
	if !ok {
		return nil, fmt.Errorf("ABI method %s is unavailable", method)
	}
	input, err := m.Inputs.Pack(args...)
	if err != nil {
		return nil, err
	}
	data, err := rpc.CallContract(ctx, ethereum.CallMsg{To: &contract, Data: append(m.ID, input...)}, block)
	if err != nil {
		return nil, err
	}
	return m.Outputs.Unpack(data)
}

func callAddress(ctx context.Context, rpc RPC, contract common.Address, decoder abi.ABI, method string, block *big.Int, args ...any) (common.Address, error) {
	values, err := callView(ctx, rpc, contract, decoder, method, block, args...)
	if err != nil || len(values) != 1 {
		return common.Address{}, fmt.Errorf("read %s from %s: %w", method, contract.Hex(), err)
	}
	value, ok := values[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("read %s from %s returned %T", method, contract.Hex(), values[0])
	}
	return value, nil
}

func callBool(ctx context.Context, rpc RPC, contract common.Address, decoder abi.ABI, method string, block *big.Int, args ...any) (bool, error) {
	values, err := callView(ctx, rpc, contract, decoder, method, block, args...)
	if err != nil || len(values) != 1 {
		return false, fmt.Errorf("read %s from %s: %w", method, contract.Hex(), err)
	}
	value, ok := values[0].(bool)
	if !ok {
		return false, fmt.Errorf("read %s from %s returned %T", method, contract.Hex(), values[0])
	}
	return value, nil
}

func DiscoverCTORoots(ctx context.Context, rpc RPC, factory, feeManager common.Address) (CTOProvenance, error) {
	if factory == (common.Address{}) || feeManager == (common.Address{}) {
		return CTOProvenance{}, fmt.Errorf("factory and fee manager roots are required")
	}
	boundFactory, err := callAddress(ctx, rpc, feeManager, feeManagerABI, "factory", nil)
	if err != nil || boundFactory != factory {
		return CTOProvenance{}, fmt.Errorf("fee manager factory root mismatch")
	}
	boundFees, err := callAddress(ctx, rpc, factory, factoryABI, "feeManager", nil)
	if err != nil || boundFees != feeManager {
		return CTOProvenance{}, fmt.Errorf("factory fee manager root mismatch")
	}
	registry, err := callAddress(ctx, rpc, feeManager, feeManagerABI, "ctoRegistry", nil)
	if err != nil || registry == (common.Address{}) {
		return CTOProvenance{}, fmt.Errorf("fee manager CTO registry is invalid")
	}
	boundFees, err = callAddress(ctx, rpc, registry, ctoRegistryABI, "feeManager", nil)
	if err != nil || boundFees != feeManager {
		return CTOProvenance{}, fmt.Errorf("CTO registry fee manager root mismatch")
	}
	return CTOProvenance{Factory: factory, FeeManager: feeManager, Registry: registry}, nil
}

func (x *Indexer) validateCanonicalTreasury(ctx context.Context, roots CTOProvenance, token, controller, treasury common.Address, block uint64) error {
	at := new(big.Int).SetUint64(block)
	canonical, err := callBool(ctx, x.rpc, roots.Registry, ctoRegistryABI, "isCanonicalTreasury", at, token, treasury)
	if err != nil || !canonical {
		return fmt.Errorf("registry does not recognize CTO treasury %s", treasury.Hex())
	}
	checks := []struct {
		contract common.Address
		decoder  abi.ABI
		method   string
		want     common.Address
	}{
		{treasury, ctoTreasuryABI, "registry", roots.Registry},
		{treasury, ctoTreasuryABI, "launchToken", token},
		{treasury, ctoTreasuryABI, "controller", controller},
	}
	for _, check := range checks {
		got, readErr := callAddress(ctx, x.rpc, check.contract, check.decoder, check.method, at)
		if readErr != nil || got != check.want {
			return fmt.Errorf("treasury %s mismatch", check.method)
		}
	}
	isToken, err := callBool(ctx, x.rpc, roots.Factory, factoryABI, "isToken", at, token)
	if err != nil || !isToken {
		return fmt.Errorf("treasury launch token is not canonical")
	}
	creator, err := callAddress(ctx, x.rpc, roots.FeeManager, feeManagerABI, "creatorOf", at, token)
	if err != nil || creator == (common.Address{}) {
		return fmt.Errorf("fee manager creator relationship is invalid")
	}
	curve, err := callAddress(ctx, x.rpc, roots.FeeManager, feeManagerABI, "curveOf", at, token)
	if err != nil || curve == (common.Address{}) {
		return fmt.Errorf("fee manager curve relationship is invalid")
	}
	tokenFactory, err := callAddress(ctx, x.rpc, token, tokenABI, "factory", at)
	if err != nil || tokenFactory != roots.Factory {
		return fmt.Errorf("launch token factory relationship is invalid")
	}
	manager, err := callAddress(ctx, x.rpc, roots.Factory, factoryABI, "graduationManager", at)
	if err != nil || manager == (common.Address{}) {
		return fmt.Errorf("canonical graduation manager is invalid")
	}
	canonicalUsdc, err := callAddress(ctx, x.rpc, manager, graduationManagerABI, "canonicalUsdc", at)
	if err != nil || canonicalUsdc != common.HexToAddress(ArcCanonicalUsdc) {
		return fmt.Errorf("graduation manager canonical USDC mismatch")
	}
	managerFactory, err := callAddress(ctx, x.rpc, manager, graduationManagerABI, "factory", at)
	if err != nil || managerFactory != roots.Factory {
		return fmt.Errorf("graduation manager factory relationship is invalid")
	}
	treasuryUsdc, err := callAddress(ctx, x.rpc, treasury, ctoTreasuryABI, "canonicalUsdc", at)
	if err != nil || treasuryUsdc != canonicalUsdc {
		return fmt.Errorf("treasury canonical USDC mismatch")
	}
	return nil
}

func (x *Indexer) discoverCTOTreasuryLogs(ctx context.Context, roots CTOProvenance, end uint64, logs []types.Log) ([]types.Log, error) {
	type deployment struct {
		token, controller, treasury common.Address
		block                       uint64
	}
	deployments := []deployment{}
	for _, l := range logs {
		if l.Address != roots.Registry || len(l.Topics) == 0 || l.Topics[0] != ctoRegistryABI.Events["CTOTreasuryDeployed"].ID {
			continue
		}
		values, err := decodeLog(ctoRegistryABI, "CTOTreasuryDeployed", l)
		if err != nil {
			return nil, err
		}
		deployment := deployment{token: values["token"].(common.Address), controller: values["controller"].(common.Address), treasury: values["treasury"].(common.Address), block: l.BlockNumber}
		if err := x.validateCanonicalTreasury(ctx, roots, deployment.token, deployment.controller, deployment.treasury, deployment.block); err != nil {
			return nil, err
		}
		deployments = append(deployments, deployment)
	}
	sort.Slice(deployments, func(i, j int) bool { return deployments[i].treasury.Hex() < deployments[j].treasury.Hex() })
	out := append([]types.Log(nil), logs...)
	for _, deployment := range deployments {
		discovered, err := x.rpc.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(deployment.block), ToBlock: new(big.Int).SetUint64(end),
			Addresses: []common.Address{deployment.treasury}, Topics: [][]common.Hash{{
				ctoTreasuryABI.Events["CTOAcceptanceSubmitted"].ID,
				ctoTreasuryABI.Events["SupportedAssetRegistered"].ID,
				ctoTreasuryABI.Events["TreasuryAssetTransferred"].ID,
				ctoTreasuryABI.Events["CreatorFeesPulled"].ID,
			}},
		})
		if err != nil {
			return nil, err
		}
		for _, l := range discovered {
			if l.Address != deployment.treasury || l.BlockNumber < deployment.block || l.BlockNumber > end {
				return nil, fmt.Errorf("treasury discovery returned invalid provenance")
			}
		}
		out = append(out, discovered...)
	}
	return canonicalLogs(out)
}
