# Cooket Arc readiness

Cooket currently runs only its Arc Testnet safety shell. The application must
remain fail-closed until all of the following are independently approved:

- Cooket Arc economics, token contracts, and deployment configuration.
- Contract addresses and bytecode verification on Arc Testnet.
- A reviewed indexing schema and an explicit activation start block.
- A reviewed trading, graduation, and oracle integration for Arc native USDC.
- Operational approval for any broadcast or production deployment.

Until then, only external EOA wallet connection on Arc Testnet is available.
Creation, buys, sells, graduation, deployment, and active indexing are denied.

Native USDC uses 18-decimal native units. The 6-decimal USDC ERC-20
representation is a distinct token view and must not be mixed with native
amounts. Indexed graduation principal is `native_usdc_amount`.

Read-only CTO API and token-page presentation consume indexed GET data only.
They are not chain authority, do not fetch `metadata_uri`, and do not submit
CTO transactions.

The following remain later phases and are not enabled by the D3 frontend work:

- Applying migration 012 to any live or persistent environment
- Arc RPC/DEX verification
- Deployment and testnet execution
- Frontend CTO writes or controller actions
- Graduated-swap execution
