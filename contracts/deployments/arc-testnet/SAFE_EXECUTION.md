# Cooket Arc Testnet Safe bootstrap

Safe: `0x2741b0E8bC8c90A48CA16cd983a9Ade0dF716d9a` (2-of-3 confirmations).

1. Run `stage1-manifest`. In the Safe Transaction Builder on Arc Testnet, add each
   `transactions[]` entry from `safe-stage1.json` in order, using its `target`,
   `calldata`, and value `0`. Obtain two owner confirmations and execute the batch.
2. Run `verify-stage1`; do not continue unless it succeeds.
3. Run `lp-deploy`, then `stage2-manifest`.
4. Add each `transactions[]` entry from `safe-stage2.json` in order, again with value
   `0`. Obtain two owner confirmations and execute the batch.
5. Run `verify-stage2` and `verify-final`.

`GraduationManagerV3.bindDependenciesOnce` performs the vault's one-time custodian
deployer binding internally. It must not be duplicated as a direct Safe call.
