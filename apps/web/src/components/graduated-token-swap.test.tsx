import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/providers/active-wallet-provider", () => ({
  useActiveWallet: () => ({
    connected: true,
    canTransact: true,
    status: "wallet_ready",
    activeAddress: "0x0000000000000000000000000000000000000022",
    activeChainId: 5042002,
    walletClient: { sendTransaction: vi.fn() },
  }),
}));

vi.mock("@/lib/uniswap-v3", () => ({
  configuredUniswapV3: () => ({ quoter: "0x1", router: "0x2", factory: "0x3" }),
  validateCanonicalPool: vi.fn().mockResolvedValue({ router: "0x0000000000000000000000000000000000000099", pool: "0x0000000000000000000000000000000000000088" }),
  quoteGraduatedSwap: vi.fn().mockResolvedValue({
    amountIn: BigInt("100000000000000000"),
    amountOut: BigInt("1"),
    minimumOut: BigInt("1"),
    deadline: BigInt(2_000_000_000),
  }),
  quoteIsFresh: () => true,
  buildGraduatedSwapTransaction: vi.fn(),
  simulateGraduatedSwapTransaction: vi.fn(),
  orchestrateGraduatedSwap: vi.fn(),
  approvalCall: vi.fn(),
}));

vi.mock("@/lib/contracts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contracts")>();
  return {
    ...original,
    publicClient: {
      getBalance: vi.fn().mockResolvedValue(BigInt("1000000000000000000")),
      readContract: vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") return 18;
        if (functionName === "balanceOf") return BigInt("5000000000000000000");
        return BigInt(0);
      }),
    },
  };
});

import { GraduatedTokenSwap } from "./graduated-token-swap";
import { walletTransport } from "./graduated-token-swap";
import { orchestrateGraduatedSwap } from "@/lib/uniswap-v3";
import { approvalCall, buildGraduatedSwapTransaction } from "@/lib/uniswap-v3";
import { ARC_PROTOCOL_ECONOMICS_BLOCKER } from "@/lib/arc-safety";

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
});

describe("graduated swap presets", () => {
  it("blocks the retained Base swap transport before any Arc wallet send", async () => {
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
  });

  it("applies buy 10%, 50%, and gas-reserving MAX from the wallet ETH balance", async () => {
    const user = userEvent.setup();
    renderSwap();
    const ten = await screen.findByRole("button", { name: "Use 10% of native USDC balance" });
    await waitFor(() => expect((ten as HTMLButtonElement).disabled).toBe(false));
    await user.click(ten);
    expect((screen.getByLabelText("Native USDC amount") as HTMLInputElement).value).toBe("0.1");
    await user.click(screen.getByRole("button", { name: "Use 50% of native USDC balance" }));
    expect((screen.getByLabelText("Native USDC amount") as HTMLInputElement).value).toBe("0.5");
    await user.click(screen.getByRole("button", { name: "Use maximum native USDC after gas reserve" }));
    expect((screen.getByLabelText("Native USDC amount") as HTMLInputElement).value).toBe("0.999");
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
    const amount = await screen.findByLabelText("Native USDC amount");
    await user.type(amount, "0.1");
    const review = await screen.findByRole("button", { name: "Review swap" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    await user.click(review);
    expect(screen.getByRole("dialog").textContent).toContain("Arc Testnet · 5042002");
    expect(screen.getByRole("dialog").textContent).toContain("0.1 native USDC");
    expect(orchestrateGraduatedSwap).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(orchestrateGraduatedSwap).toHaveBeenCalledOnce();
  });
});
