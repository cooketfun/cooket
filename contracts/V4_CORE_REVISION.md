# Uniswap v4-core pin

Cooket endpoint-cp-v5 imports the official Uniswap v4-core Solidity types from
`contracts/lib/v4-core` at the exact upstream revision:

`46c6834698c48bc4a463a86d8420f4eb1d7f3b75`

Upstream: `https://github.com/Uniswap/v4-core`

Only the upstream `src/`, `licenses/`, and `README.md` trees are vendored. The
dependency is never resolved from a moving branch. Upstream's own Foundry
profile uses Solidity `0.8.26`, Cancun, IR compilation, 44,444,444 optimizer
runs, and no bytecode metadata. Cooket does not deploy upstream PoolManager
bytecode in this checkpoint; it imports the reviewed hook and pool types using
their compatible pragmas. Cooket retains its existing Solidity `0.8.28` and
200-run non-IR optimizer configuration, explicitly pins Cancun and IPFS
metadata, and maps imports with:

`v4-core/=lib/v4-core/`

Runtime bytecode identity depends on the compiler version, optimizer settings,
metadata setting, linked libraries, and immutable constructor values. The V5
deployment process must derive `expectedLaunchHookRuntimeCodeHash` from these
exact pinned inputs.
