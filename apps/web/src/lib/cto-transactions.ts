import { contractAddresses, cooketFactoryAbi, ctoRegistryV3Abi, ctoTreasuryV3Abi, feeManagerV3Abi } from "@cooket/contracts-sdk";
import { encodeFunctionData, getAddress, isAddress, keccak256, stringToBytes, zeroAddress, zeroHash, type Address, type Hash, type Hex } from "viem";
import { assertArcProtocolEconomicsReady } from "@/lib/arc-safety";
import { assertActiveWalletClient, publicClient, type BrowserWalletClient } from "@/lib/contracts";

export const CTO_ACCEPTANCE_WINDOW = 7 * 24 * 60 * 60;
export const CTO_EXECUTION_DELAY = 72 * 60 * 60;
export const CTO_EXECUTION_GRACE_PERIOD = 7 * 24 * 60 * 60;

export type OnchainCTOProposal = {
  token: Address; creator: Address; controller: Address; treasury: Address; previousRecipient: Address;
  metadataHash: Hex; nonce: bigint; createdAt: bigint; acceptedAt: bigint; state: number;
};

export type CTOChainState = {
  registry: Address;
  creator: Address;
  currentProposalId: Hex;
  proposal?: OnchainCTOProposal;
  currentPayout: Address;
  blockTimestamp: number;
  acceptanceWindow: number;
  executionDelay: number;
  executionGracePeriod: number;
};

export function configuredCTORegistry(): Address {
  const registry = contractAddresses.ctoRegistry;
  if (!registry) throw new Error("The CTO registry address is not configured.");
  return getAddress(registry);
}

export function resolveCTOMetadata(metadataURI: string): { metadataURI: string; metadataHash: Hex } {
  const normalized = metadataURI.trim();
  const bytes = stringToBytes(normalized);
  if (bytes.length > 256) throw new Error("The metadata URI must not exceed 256 UTF-8 bytes.");
  return { metadataURI: normalized, metadataHash: normalized ? keccak256(bytes) : zeroHash };
}

export function validateControllerAddress(value: string): Address {
  if (!isAddress(value)) throw new Error("Enter a valid EVM controller contract address.");
  const address = getAddress(value);
  if (address === zeroAddress) throw new Error("The controller cannot be the zero address.");
  return address;
}

export function requireDeployedController(value: string, bytecode: Hex | undefined): Address {
  const address = validateControllerAddress(value);
  if (!bytecode || bytecode === "0x") throw new Error("The controller must be a deployed contract, normally a Safe.");
  return address;
}

export function buildCTOAcceptancePayload(treasury: Address, proposalId: Hex) {
  return {
    target: getAddress(treasury),
    value: BigInt(0),
    data: encodeFunctionData({ abi: ctoTreasuryV3Abi, functionName: "acceptCTO", args: [proposalId] }),
  } as const;
}

export async function readCTOChainState(tokenInput: Address): Promise<CTOChainState> {
  const registry = configuredCTORegistry();
  const factory = contractAddresses.cooketFactory;
  if (!factory) throw new Error("The Cooket factory address is not configured.");
  const token = getAddress(tokenInput);
  const [tokenInfo, currentProposalId, feeManager, latestBlock, acceptanceWindow, executionDelay, executionGracePeriod] = await Promise.all([
    publicClient.readContract({ address: factory, abi: cooketFactoryAbi, functionName: "tokenInfo", args: [token] }),
    publicClient.readContract({ address: registry, abi: ctoRegistryV3Abi, functionName: "currentProposalId", args: [token] }),
    publicClient.readContract({ address: registry, abi: ctoRegistryV3Abi, functionName: "feeManager" }),
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({ address: registry, abi: ctoRegistryV3Abi, functionName: "ACCEPTANCE_WINDOW" }),
    publicClient.readContract({ address: registry, abi: ctoRegistryV3Abi, functionName: "EXECUTION_DELAY" }),
    publicClient.readContract({ address: registry, abi: ctoRegistryV3Abi, functionName: "EXECUTION_GRACE_PERIOD" }),
  ]);
  const [proposal, currentPayout] = await Promise.all([
    currentProposalId === zeroHash ? Promise.resolve(undefined) : publicClient.readContract({ address: registry, abi: ctoRegistryV3Abi, functionName: "proposal", args: [currentProposalId] }),
    publicClient.readContract({ address: feeManager, abi: feeManagerV3Abi, functionName: "creatorPayoutOf", args: [token] }),
  ]);
  if (contractAddresses.feeManager && getAddress(feeManager) !== getAddress(contractAddresses.feeManager)) throw new Error("The CTO registry does not reference the configured FeeManagerV3.");
  const raw = proposal as OnchainCTOProposal | undefined;
  return {
    registry,
    creator: getAddress(tokenInfo[0]),
    currentProposalId,
    proposal: raw ? { ...raw, token: getAddress(raw.token), creator: getAddress(raw.creator), controller: getAddress(raw.controller), treasury: getAddress(raw.treasury), previousRecipient: getAddress(raw.previousRecipient), state: Number(raw.state) } : undefined,
    currentPayout: getAddress(currentPayout),
    blockTimestamp: Number(latestBlock.timestamp),
    acceptanceWindow: Number(acceptanceWindow),
    executionDelay: Number(executionDelay),
    executionGracePeriod: Number(executionGracePeriod),
  };
}

async function submitAndConfirm(client: BrowserWalletClient, account: Address, request: Parameters<BrowserWalletClient["writeContract"]>[0]): Promise<Hash> {
  await assertActiveWalletClient(client, account);
  const hash = await client.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("The CTO transaction reverted.");
  return hash;
}

export async function proposeCTO(client: BrowserWalletClient, accountInput: Address, tokenInput: Address, controllerInput: string, metadataURIInput: string): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const account = getAddress(accountInput), token = getAddress(tokenInput), controller = validateControllerAddress(controllerInput);
  const [{ metadataHash, metadataURI }, controllerCode, state] = await Promise.all([
    Promise.resolve(resolveCTOMetadata(metadataURIInput)),
    publicClient.getBytecode({ address: controller }),
    readCTOChainState(token),
  ]);
  requireDeployedController(controller, controllerCode);
  if (state.creator !== account) throw new Error("Only the canonical token creator can start a community takeover.");
  if (state.proposal && (state.proposal.state === 1 || state.proposal.state === 2 || state.proposal.state === 5)) throw new Error("This token already has a live CTO proposal.");
  const { request } = await publicClient.simulateContract({ address: state.registry, abi: ctoRegistryV3Abi, functionName: "proposeCTO", args: [token, controller, metadataHash, metadataURI], account });
  return submitAndConfirm(client, account, request);
}

async function freshProposal(token: Address, proposalId: Hex, states: number[]) {
  const state = await readCTOChainState(token);
  if (state.currentProposalId !== proposalId || !state.proposal || state.proposal.token !== getAddress(token) || !states.includes(state.proposal.state)) throw new Error("The on-chain CTO proposal state changed. Refresh before continuing.");
  return state;
}

export async function acceptCTOFromController(client: BrowserWalletClient, accountInput: Address, token: Address, proposalId: Hex): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const account = getAddress(accountInput);
  const state = await freshProposal(token, proposalId, [1]);
  const proposal = state.proposal!;
  if (account !== proposal.controller) throw new Error("Acceptance must be submitted by the proposal controller contract.");
  const [accountCode, treasuryController, treasuryRegistry, treasuryToken] = await Promise.all([
    publicClient.getBytecode({ address: account }),
    publicClient.readContract({ address: proposal.treasury, abi: ctoTreasuryV3Abi, functionName: "controller" }),
    publicClient.readContract({ address: proposal.treasury, abi: ctoTreasuryV3Abi, functionName: "registry" }),
    publicClient.readContract({ address: proposal.treasury, abi: ctoTreasuryV3Abi, functionName: "launchToken" }),
  ]);
  if (!accountCode || accountCode === "0x") throw new Error("An ordinary EOA cannot accept this proposal. Submit the payload through the controller contract wallet.");
  if (getAddress(treasuryController) !== account || getAddress(treasuryRegistry) !== state.registry || getAddress(treasuryToken) !== getAddress(token)) throw new Error("The CTO treasury relationships do not match the indexed proposal.");
  const { request } = await publicClient.simulateContract({ address: proposal.treasury, abi: ctoTreasuryV3Abi, functionName: "acceptCTO", args: [proposalId], account });
  return submitAndConfirm(client, account, request);
}

export async function cancelCTO(client: BrowserWalletClient, accountInput: Address, token: Address, proposalId: Hex): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const account = getAddress(accountInput), state = await freshProposal(token, proposalId, [1, 2]);
  if (state.creator !== account || state.proposal!.creator !== account) throw new Error("Only the canonical token creator can cancel this proposal.");
  const { request } = await publicClient.simulateContract({ address: state.registry, abi: ctoRegistryV3Abi, functionName: "cancelCTO", args: [proposalId], account });
  return submitAndConfirm(client, account, request);
}

export async function expireCTO(client: BrowserWalletClient, account: Address, token: Address, proposalId: Hex): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const state = await freshProposal(token, proposalId, [1, 2]);
  const { request } = await publicClient.simulateContract({ address: state.registry, abi: ctoRegistryV3Abi, functionName: "expireCTO", args: [proposalId], account });
  return submitAndConfirm(client, account, request);
}

export async function executeCTO(client: BrowserWalletClient, account: Address, token: Address, proposalId: Hex): Promise<Hash> {
  assertArcProtocolEconomicsReady();
  const state = await freshProposal(token, proposalId, [2]);
  if (state.currentPayout !== state.proposal!.previousRecipient) throw new Error("The creator payout changed after proposal creation; execution is no longer safe.");
  const { request } = await publicClient.simulateContract({ address: state.registry, abi: ctoRegistryV3Abi, functionName: "executeCTO", args: [proposalId], account });
  return submitAndConfirm(client, account, request);
}
