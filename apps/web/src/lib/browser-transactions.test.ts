import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import { assertActiveWalletClient, contractAddresses, publicClient, quoteBuyByBudget, quoteSellAmount, readCurveAvailability, readTradeState, submitBuy, submitCreateToken, submitSell, type BrowserWalletClient } from "./contracts";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER } from "./arc-safety";

const factory = "0x90B371F571975a0b0693Dc3C46Eea19733c72ddD" as Address;
const token = "0xEC2710A9df34b66B07BF96933d13B76e1d526c07" as Address;
const curve = "0x83Cae06f86672038d203E3676Ae1943D36f3E2a2" as Address;
const wallet = "0x0000000000000000000000000000000000000022" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;

type TestWalletClient = BrowserWalletClient & {
  getChainId: ReturnType<typeof vi.fn>;
  getAddresses: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function walletClient(writeContract = vi.fn().mockResolvedValue(hash), address = wallet, chainId = 5042002, liveAddress = address): TestWalletClient {
  return {
    account: { address },
    getChainId: vi.fn().mockResolvedValue(chainId),
    getAddresses: vi.fn().mockResolvedValue(liveAddress ? [liveAddress] : []),
    writeContract,
  } as unknown as TestWalletClient;
}

afterEach(() => {
  vi.restoreAllMocks();
  contractAddresses.cooketFactory = undefined;
  contractAddresses.cooketCurve = undefined;
});

describe("Arc Testnet curve reads", () => {
  it("resolves a configured curve only from the Arc chain", async () => {
    contractAddresses.cooketFactory = factory;
    vi.spyOn(publicClient, "getChainId").mockResolvedValue(5042002);
    vi.spyOn(publicClient, "getBytecode").mockResolvedValue("0x6000");
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => {
      if (request.functionName === "curveOf") return curve;
      if (request.functionName === "factory") return factory;
      if (request.functionName === "token") return token;
      if (request.functionName === "creator") return wallet;
      if (request.functionName === "graduated") return false;
      throw new Error(`unexpected ${request.functionName}`);
    });
    await expect(readCurveAvailability(token)).resolves.toEqual({ address: curve, state: { creator: wallet, graduated: false } });
  });

  it.each([8453, 84532])("rejects Base RPC chain ID %i", async (chainId) => {
    contractAddresses.cooketFactory = factory;
    vi.spyOn(publicClient, "getChainId").mockResolvedValue(chainId);
    await expect(readCurveAvailability(token)).rejects.toThrow(new RegExp(`chain ID ${chainId}.*5042002`, "i"));
  });

  it("reports missing Arc factory and curve bytecode precisely", async () => {
    contractAddresses.cooketFactory = factory;
    vi.spyOn(publicClient, "getChainId").mockResolvedValue(5042002);
    const bytecode = vi.spyOn(publicClient, "getBytecode").mockResolvedValueOnce(undefined);
    await expect(readCurveAvailability(token)).rejects.toThrow(/no factory bytecode exists.*Arc Testnet/i);

    bytecode.mockResolvedValueOnce("0x6000").mockResolvedValueOnce(undefined);
    vi.spyOn(publicClient, "readContract").mockResolvedValue(curve as never);
    await expect(readCurveAvailability(token)).rejects.toThrow(/no curve bytecode exists.*Arc Testnet/i);
  });

  it("loads inherited curve state without reinterpreting its field names", async () => {
    contractAddresses.cooketCurve = curve;
    const balance = vi.spyOn(publicClient, "getBalance");
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => {
      if (request.functionName === "soldSupply") return BigInt(12);
      if (request.functionName === "activeEthReserve") return BigInt(34);
      if (request.functionName === "graduated") return false;
      if (request.functionName === "decimals") return 18;
      throw new Error(`wallet-dependent read attempted: ${request.functionName}`);
    });
    await expect(readTradeState(token)).resolves.toMatchObject({ soldSupply: BigInt(12), reserveBalance: BigInt(34), nativeBalance: BigInt(0), tokenBalance: BigInt(0), allowance: BigInt(0) });
    expect(balance).not.toHaveBeenCalled();
  });

  it("keeps inherited quote math available for analysis only", async () => {
    contractAddresses.cooketCurve = curve;
    vi.spyOn(publicClient, "readContract").mockImplementation(async (request) => request.functionName === "quoteBuy"
      ? { acceptedGross: BigInt(990), netCurveInput: BigInt(970), protocolFee: BigInt(3), creatorFee: BigInt(4), tokensOut: BigInt(1000) }
      : { netSellerOutput: BigInt(900), grossCurveOutput: BigInt(920), protocolFee: BigInt(3), creatorFee: BigInt(4) });
    await expect(quoteBuyByBudget(token, BigInt(1000), { soldSupply: BigInt(0), graduationThreshold: BigInt(1) }, 50)).resolves.toMatchObject({ tokenAmount: BigInt(1000), maxReserveIn: BigInt(1000) });
    await expect(quoteSellAmount(token, BigInt(1000), 50)).resolves.toMatchObject({ tokenAmount: BigInt(1000), minReserveOut: BigInt(895) });
  });

  it("rejects invalid quote inputs before reading inherited curve math", async () => {
    contractAddresses.cooketCurve = curve;
    const read = vi.spyOn(publicClient, "readContract");
    await expect(quoteBuyByBudget(token, BigInt(0), { soldSupply: BigInt(0), graduationThreshold: BigInt(1) }, 50)).rejects.toThrow(/greater than zero/i);
    await expect(quoteSellAmount(token, BigInt(0), 50)).rejects.toThrow(/greater than zero/i);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("Arc wallet context validation", () => {
  it("accepts only the expected Arc Testnet signer and live account", async () => {
    await expect(assertActiveWalletClient(walletClient(), wallet)).resolves.toBeUndefined();
  });

  it("fails closed for configured signer, live account, and Base chain changes", async () => {
    const other = "0x0000000000000000000000000000000000000033" as Address;
    await expect(assertActiveWalletClient(walletClient(vi.fn(), other), wallet)).rejects.toThrow(/signer does not match/i);
    await expect(assertActiveWalletClient(walletClient(vi.fn(), wallet, 5042002, other), wallet)).rejects.toThrow(/changed accounts/i);
    await expect(assertActiveWalletClient(walletClient(vi.fn(), wallet, 8453), wallet)).rejects.toThrow(/chain 8453.*Arc Testnet/i);
    await expect(assertActiveWalletClient(walletClient(vi.fn(), wallet, 84532), wallet)).rejects.toThrow(/chain 84532.*Arc Testnet/i);
  });
});

describe("Arc Phase 0 write safety", () => {
  it("blocks create, buy, and sell before simulation or wallet submission", async () => {
    const simulate = vi.spyOn(publicClient, "simulateContract");
    const client = walletClient();
    const callbacks = { onApprovalRequested() {}, onApprovalSubmitted() {}, onApprovalConfirmed() {}, onSellRequested() {} };
    await expect(submitCreateToken(client, wallet, "Cooket", "COOKET", `0x${"12".repeat(32)}`)).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    await expect(submitBuy(client, wallet, token, { reserveIn: BigInt(1), curveCost: BigInt(1), protocolFee: BigInt(0), creatorFee: BigInt(0), tokenAmount: BigInt(1), maxReserveIn: BigInt(1), slippageBps: 50, deadline: BigInt(1) })).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    await expect(submitSell(client, wallet, token, { reserveOut: BigInt(1), curveValue: BigInt(1), protocolFee: BigInt(0), creatorFee: BigInt(0), tokenAmount: BigInt(1), minReserveOut: BigInt(1), slippageBps: 50, deadline: BigInt(1) }, callbacks)).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    expect(simulate).not.toHaveBeenCalled();
    expect(client.getChainId).not.toHaveBeenCalled();
    expect(client.getAddresses).not.toHaveBeenCalled();
    expect(client.writeContract).not.toHaveBeenCalled();
  });
});
