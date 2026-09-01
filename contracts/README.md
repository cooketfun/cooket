# Cooket contracts

> **Arc Phase 0 safety boundary:** these contracts retain dormant reference
> economics. There is no Arc deployment script, and
> this contract graph is not approved for Arc Testnet or Arc mainnet deployment.

The contract layer is the source of truth for token creation, curve inventory,
trading reserve, fee policy, and accrued fee liabilities.

Current endpoint-cp-v3 modules:

- `CooketFactoryV3`: permissionless atomic token and curve launch plus the canonical
  token-to-curve registry;
- `CooketTokenV3`: fixed 1 billion supply ERC-20 minted once to its launched curve;
- `CooketCurveV3`: endpoint constant-product trading, reserve accounting, fees, and
  terminal graduation trigger;
- `FeeManagerV3`: protocol and creator fee accounting;
- `GraduationManagerV3`: canonical Uniswap V3 graduation orchestration;
- `PermanentLPFeeVaultV3` and `PermanentLPCustodianDeployerV3`: permanent LP
  custody and post-graduation fee collection.

The supported launch event is `TokenLaunchedV3`; curve trade events are
`TokensBought` and `TokensSold`. There are no Cooket deployment records.

V3 graduation uses the canonical Uniswap V3 position manager and permanent
custody contracts; it does not use an adapter, fungible LP locker, or manual
post-launch curve configuration.

## Local validation

```shell
forge fmt --check
forge build
forge test
```

Deployment scripts read runtime configuration through environment-variable
names. Never pass or commit private keys, mnemonics, authenticated RPC URLs, or
other credentials in source files or command arguments. No deployment is part
of the local test suite.
