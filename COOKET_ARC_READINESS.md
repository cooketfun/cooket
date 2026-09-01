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
