import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { waitForTransactionReceipt, sendTransaction, swapState, wallet } = vi.hoisted(() => ({
  wallet: "0x0000000000000000000000000000000000000022" as const,
  waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  sendTransaction: vi.fn().mockResolvedValue(`0x${"ab".repeat(32)}`),
  swapState: { allowance: BigInt(0), usdc: BigInt("1000000"), token: BigInt("5000000000000000000"), quoteIsFresh: true },
}));

vi.mock("@/providers/active-wallet-provider", () => ({
  useActiveWallet: () => ({
    connected: true,
    canTransact: true,
    status: "wallet_ready",
    activeAddress: wallet,
    activeChainId: 5042002,
    walletClient: {
      account: { address: wallet },
      getChainId: vi.fn().mockResolvedValue(5042002),
      getAddresses: vi.fn().mockResolvedValue([wallet]),
      sendTransaction,
    },
  }),
}));

vi.mock("@/lib/arc-safety", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/arc-safety")>();
  return { ...original, assertArcProtocolEconomicsReady: vi.fn(original.assertArcProtocolEconomicsReady) };
});

vi.mock("@/lib/uniswap-v3", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/uniswap-v3")>();
  return {
    ...original,
    configuredUniswapV3: () => ({ quoter: "0x1", router: "0x2", factory: "0x3" }),
    validateCanonicalPool: vi.fn().mockResolvedValue({ router: "0x0000000000000000000000000000000000000099", pool: "0x0000000000000000000000000000000000000088" }),
    quoteGraduatedSwap: vi.fn().mockResolvedValue({
      amountIn: BigInt("100000"),
      amountOut: BigInt("1"),
      minimumOut: BigInt("1"),
      deadline: BigInt(2_000_000_000),
    }),
    quoteIsFresh: vi.fn(() => swapState.quoteIsFresh),
    readGraduatedSwapState: vi.fn(async () => ({ usdc: swapState.usdc, token: swapState.token, allowance: swapState.allowance })),
    readGraduatedAllowance: vi.fn(async () => swapState.allowance),
    readGraduatedTokenDecimals: vi.fn().mockResolvedValue(18),
    buildGraduatedSwapTransaction: vi.fn(),
    orchestrateGraduatedSwap: vi.fn(),
    approvalCall: vi.fn(),
  };
});

vi.mock("@/lib/contracts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contracts")>();
  return {
    ...original,
    publicClient: {
      getBalance: vi.fn().mockResolvedValue(BigInt("1000000000000000000")),
      readContract: vi.fn().mockImplementation(async ({ address, functionName }: { address: string; functionName: string }) => {
        if (functionName === "decimals") return 18;
        if (functionName === "balanceOf" && address.toLowerCase() === "0x3600000000000000000000000000000000000000") return BigInt("1000000");
        if (functionName === "balanceOf") return BigInt("5000000000000000000");
        return BigInt(0);
      }),
      waitForTransactionReceipt,
    },
  };
});

import { GraduatedTokenSwap } from "./graduated-token-swap";
import { walletTransport } from "./graduated-token-swap";
import { GraduatedSwapRpcTimeoutError, orchestrateGraduatedSwap, quoteIsFresh, readGraduatedAllowance } from "@/lib/uniswap-v3";
import { approvalCall, buildGraduatedSwapTransaction } from "@/lib/uniswap-v3";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER, assertArcProtocolEconomicsReady } from "@/lib/arc-safety";
import type { Hash } from "viem";

const source = readFileSync(resolve(process.cwd(), "src/components/graduated-token-swap.tsx"), "utf8");

function renderSwap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(
    <GraduatedTokenSwap
      tokenAddress="0x0000000000000000000000000000000000000011"
      canonicalPoolAddress="0x0000000000000000000000000000000000000033"
      symbol="COOKET"
    />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  swapState.allowance = BigInt(0);
  swapState.usdc = BigInt("1000000");
  swapState.token = BigInt("5000000000000000000");
  swapState.quoteIsFresh = true;
  waitForTransactionReceipt.mockReset();
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  sendTransaction.mockReset();
  sendTransaction.mockResolvedValue(`0x${"ab".repeat(32)}`);
  vi.mocked(orchestrateGraduatedSwap).mockReset();
  vi.mocked(buildGraduatedSwapTransaction).mockReset();
  vi.mocked(approvalCall).mockReset();
  vi.mocked(readGraduatedAllowance).mockReset();
  vi.mocked(readGraduatedAllowance).mockImplementation(async () => swapState.allowance);
  vi.mocked(quoteIsFresh).mockImplementation(() => swapState.quoteIsFresh);
  vi.mocked(assertArcProtocolEconomicsReady).mockImplementation(() => {
    throw new Error(ARC_PROTOCOL_ECONOMICS_BLOCKER);
  });
});

describe("graduated swap presets", () => {
  it("blocks the retained Base swap transport before any Arc wallet send", async () => {
    vi.stubEnv("NEXT_PUBLIC_ARC_TESTNET_FINANCIAL_EXECUTION_ENABLED", "");
    const sendTransaction = vi.fn().mockResolvedValue(`0x${"ab".repeat(32)}`);
    const active = "0x0000000000000000000000000000000000000022";
    const send = walletTransport({ account: { address: active }, getChainId: vi.fn().mockResolvedValue(5042002), getAddresses: vi.fn().mockResolvedValue([active]), sendTransaction } as never, active);
    const approval = { to: "0x0000000000000000000000000000000000000011", data: "0x1234", value: BigInt(0) } as const;
    const swap = { to: "0x0000000000000000000000000000000000000099", data: "0x5678", value: BigInt(10) } as const;
    vi.mocked(approvalCall).mockReturnValue(approval);
    vi.mocked(buildGraduatedSwapTransaction).mockReturnValue(swap);

    await expect(send(approvalCall(approval.to, swap.to, BigInt(10)), "Approve token")).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);
    await expect(send(buildGraduatedSwapTransaction({} as never, {} as never, "0x0000000000000000000000000000000000000022"), "Swap")).rejects.toThrow(ARC_PROTOCOL_ECONOMICS_BLOCKER);

    expect(sendTransaction).not.toHaveBeenCalled();
    expect(approval).not.toHaveProperty("dataSuffix");
    expect(swap).not.toHaveProperty("dataSuffix");
  });

  it("reuses the shared preset helper and existing quote lifecycle", () => {
    expect(source).toContain("TradeAmountPresets");
    expect(source).toContain("changeAmount");
    expect(source).toContain("setQuote(undefined)");
    expect(source).not.toContain("quoteBuyByBudget");
    expect(source).not.toContain("preparing_sell");
    expect(source).not.toContain("simulateGraduatedSwapTransaction");
    expect(source).not.toContain("simulating_swap");
    expect(source).toContain("refreshing_state");
    expect(source).toContain("readGraduatedTokenDecimals");
  });

  it("applies buy 10%, 50%, and exact MAX from the canonical ERC20 USDC balance", async () => {
    const user = userEvent.setup();
    renderSwap();
    const ten = await screen.findByRole("button", { name: "Use 10% of USDC balance" });
    await waitFor(() => expect((ten as HTMLButtonElement).disabled).toBe(false));
    await user.click(ten);
    expect((screen.getByLabelText("ERC20 USDC amount") as HTMLInputElement).value).toBe("0.1");
    await user.click(screen.getByRole("button", { name: "Use 50% of USDC balance" }));
    expect((screen.getByLabelText("ERC20 USDC amount") as HTMLInputElement).value).toBe("0.5");
    await user.click(screen.getByRole("button", { name: "Use exact USDC balance" }));
    expect((screen.getByLabelText("ERC20 USDC amount") as HTMLInputElement).value).toBe("1");
  });

  it("uses the exact token balance for graduated sell MAX", async () => {
    const user = userEvent.setup();
    renderSwap();
    await user.click(await screen.findByRole("button", { name: "Sell COOKET" }));
    await user.click(screen.getByRole("button", { name: "Use exact token balance" }));
    expect((screen.getByLabelText("COOKET amount") as HTMLInputElement).value).toBe("5");
  });

  it("reviews graduated swap values in the shared modal before execution", async () => {
    const user = userEvent.setup();
    renderSwap();
    const amount = await screen.findByLabelText("ERC20 USDC amount");
    await user.type(amount, "0.1");
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    await user.click(review);
    expect(screen.getByRole("dialog").textContent).toContain("Arc Testnet · 5042002");
    expect(screen.getByRole("dialog").textContent).toContain("0.1 ERC20 USDC");
    expect(orchestrateGraduatedSwap).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start approval + swap" }));
    expect(orchestrateGraduatedSwap).toHaveBeenCalledOnce();
  });
});

const swapHash = `0x${"ab".repeat(32)}` as Hash;
const approvalHash = `0x${"cd".repeat(32)}` as Hash;
const swapTx = { to: "0x0000000000000000000000000000000000000099" as const, data: "0x1234" as const, value: BigInt(0) };
const approvalTx = { to: "0x0000000000000000000000000000000000000011" as const, data: "0xabcd" as const, value: BigInt(0) };

function allowArcWrites() {
  vi.mocked(assertArcProtocolEconomicsReady).mockImplementation(() => undefined);
}

function mockDirectSend() {
  vi.mocked(buildGraduatedSwapTransaction).mockReturnValue(swapTx);
  vi.mocked(orchestrateGraduatedSwap).mockImplementation(async (input) => {
    expect(input).not.toHaveProperty("simulate");
    input.assertContext();
    return input.send(input.buildTransaction());
  });
}

function mockApprovalThenSend(allowanceAfterApproval = BigInt("100000")) {
  vi.mocked(approvalCall).mockReturnValue(approvalTx);
  vi.mocked(buildGraduatedSwapTransaction).mockReturnValue(swapTx);
  vi.mocked(readGraduatedAllowance).mockImplementation(async () => allowanceAfterApproval);
  vi.mocked(orchestrateGraduatedSwap).mockImplementation(async (input) => {
    expect(input).not.toHaveProperty("simulate");
    await input.approve();
    const allowance = await input.readAllowance();
    if (allowance < input.amountIn) throw new Error("Confirmed approval is still insufficient; swap was not submitted.");
    input.assertContext();
    return input.send(input.buildTransaction());
  });
}

async function reviewAndConfirm(user: ReturnType<typeof userEvent.setup>, side: "buy" | "sell" = "buy", confirmLabel = "Start approval + swap") {
  renderSwap();
  if (side === "sell") await user.click(await screen.findByRole("button", { name: "Sell COOKET" }));
  const amount = await screen.findByLabelText(side === "buy" ? "ERC20 USDC amount" : "COOKET amount");
  await user.type(amount, side === "buy" ? "0.1" : "1");
  const review = await screen.findByRole("button", { name: "Review swap" });
  await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText("Simulating transaction")).toBeNull();
  expect(screen.queryByText("Simulating swap on Arc Testnet")).toBeNull();
  await user.click(review);
  await user.click(screen.getByRole("button", { name: confirmLabel }));
}

function expectNoSimulationCopy() {
  expect(screen.queryByText("Simulating transaction")).toBeNull();
  expect(screen.queryByText("Simulating swap on Arc Testnet")).toBeNull();
  expect(screen.queryByText(`Simulating swap on Arc Testnet`)).toBeNull();
}

describe("graduated swap sufficient allowance", () => {
  it.each(["buy", "sell"] as const)("sends a %s directly after local validation without approval or simulation", async (side) => {
    const user = userEvent.setup();
    swapState.allowance = BigInt("100000");
    allowArcWrites();
    mockDirectSend();
    await reviewAndConfirm(user, side, "Confirm swap");
    expect(await screen.findByText("Transaction confirmed")).toBeTruthy();
    expect(orchestrateGraduatedSwap).toHaveBeenCalledOnce();
    const input = vi.mocked(orchestrateGraduatedSwap).mock.calls[0]?.[0];
    expect(input).not.toHaveProperty("simulate");
    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ account: wallet, ...swapTx }));
    expect(readGraduatedAllowance).not.toHaveBeenCalled();
    expect(approvalCall).not.toHaveBeenCalled();
    expectNoSimulationCopy();
    expect(screen.queryByText("Confirming token allowance on Arc Testnet")).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review swap" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("graduated swap approval-required flow", () => {
  it.each(["buy", "sell"] as const)("approves a %s, rereads allowance, then sends the swap", async (side) => {
    const user = userEvent.setup();
    allowArcWrites();
    sendTransaction.mockResolvedValueOnce(approvalHash).mockResolvedValueOnce(swapHash);
    mockApprovalThenSend();
    await reviewAndConfirm(user, side);
    expect(await screen.findByText("Transaction confirmed")).toBeTruthy();
    expect(approvalCall).toHaveBeenCalledOnce();
    expect(readGraduatedAllowance).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(sendTransaction.mock.calls[0]?.[0]).toMatchObject({ account: wallet, ...approvalTx });
    expect(sendTransaction.mock.calls[1]?.[0]).toMatchObject({ account: wallet, ...swapTx });
    expectNoSimulationCopy();
  });

  it.each(["buy", "sell"] as const)("does not send a %s when confirmed approval is still insufficient", async (side) => {
    const user = userEvent.setup();
    allowArcWrites();
    sendTransaction.mockResolvedValueOnce(approvalHash);
    mockApprovalThenSend(BigInt(1));
    await reviewAndConfirm(user, side);
    expect(await screen.findByText("Transaction failed")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toMatch(/Confirmed approval is still insufficient/);
    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining(approvalTx));
    expectNoSimulationCopy();
  });

  it.each(["buy", "sell"] as const)("fails a %s swap after a post-approval allowance RPC timeout and allows close", async (side) => {
    const user = userEvent.setup();
    let rejectRefresh: (reason: unknown) => void = () => undefined;
    let sent = false;
    vi.mocked(orchestrateGraduatedSwap).mockImplementation(async (input) => {
      void input.readAllowance();
      await new Promise((_, reject) => { rejectRefresh = reject; });
      sent = true;
      return input.send(swapTx);
    });
    await reviewAndConfirm(user, side);
    expect(await screen.findByText("Confirming token allowance on Arc Testnet")).toBeTruthy();
    expect(screen.queryByText("Preparing sell")).toBeNull();
    expectNoSimulationCopy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    rejectRefresh(new GraduatedSwapRpcTimeoutError(15_000, "Refreshing token allowance"));
    expect(await screen.findByText("Transaction failed")).toBeTruthy();
    expect(sent).toBe(false);
    expect(screen.getByRole("dialog").textContent).toMatch(/Refreshing token allowance timed out.*No wallet request was made/i);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review swap" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("graduated swap local validation", () => {
  it("does not send when the quote is stale", async () => {
    const user = userEvent.setup();
    swapState.allowance = BigInt("100000");
    allowArcWrites();
    mockDirectSend();
    renderSwap();
    const amount = await screen.findByLabelText("ERC20 USDC amount");
    await user.type(amount, "0.1");
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    await user.click(review);
    swapState.quoteIsFresh = false;
    vi.mocked(quoteIsFresh).mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(await screen.findByText("Transaction failed")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toMatch(/stale or the wallet\/network changed/i);
    expect(orchestrateGraduatedSwap).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("does not send when the wallet or network changed", async () => {
    const user = userEvent.setup();
    swapState.allowance = BigInt("100000");
    allowArcWrites();
    mockDirectSend();
    vi.mocked(quoteIsFresh).mockImplementation(() => false);
    await reviewAndConfirm(user, "buy", "Confirm swap");
    expect(await screen.findByText("Transaction failed")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toMatch(/stale or the wallet\/network changed/i);
    expect(orchestrateGraduatedSwap).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("does not send when the USDC balance is insufficient", async () => {
    const user = userEvent.setup();
    swapState.usdc = BigInt(1);
    allowArcWrites();
    mockDirectSend();
    renderSwap();
    const amount = await screen.findByLabelText("ERC20 USDC amount");
    await user.type(amount, "0.1");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Insufficient canonical ERC20 USDC balance/i));
    expect(screen.getByRole("button", { name: "Review swap" })).toHaveProperty("disabled", true);
    expect(orchestrateGraduatedSwap).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expectNoSimulationCopy();
  });

  it("keeps an on-chain revert after send distinct from a pre-wallet failure", async () => {
    const user = userEvent.setup();
    swapState.allowance = BigInt("100000");
    allowArcWrites();
    mockDirectSend();
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    await reviewAndConfirm(user, "buy", "Confirm swap");
    expect(await screen.findByText("Transaction failed")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toMatch(/swap reverted on Arc Testnet/i);
    expect(screen.getByRole("dialog").textContent).not.toMatch(/No wallet request was made/i);
    expect(sendTransaction).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expectNoSimulationCopy();
  });

  it("does not open a simulation modal while quoting", async () => {
    const user = userEvent.setup();
    renderSwap();
    await user.type(await screen.findByLabelText("ERC20 USDC amount"), "0.1");
    await waitFor(() => expect((screen.getByRole("button", { name: "Review swap" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expectNoSimulationCopy();
  });
});
