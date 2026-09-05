import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiAssetURL } from "@/lib/api";
import { pendingTradeKey, persistPendingTrade, readPendingTrade } from "@/lib/transactions";
import { TokenTradePanel, type TradeExecution } from "./token-trade-panel";
import { USDC_TOKEN_LOGO_SRC } from "./trade-asset-identity";

const panelSource = readFileSync(resolve(process.cwd(), "src/components/token-trade-panel.tsx"), "utf8");

const token = "0x0000000000000000000000000000000000000011" as const;
const otherToken = "0x0000000000000000000000000000000000000012" as const;
const wallet = "0x0000000000000000000000000000000000000022" as const;
const otherWallet = "0x0000000000000000000000000000000000000023" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const replacementHash = `0x${"cd".repeat(32)}` as const;
const recovery = { sender: wallet, nonce: 4, to: token, value: "100", input: "0x1234", nextScanBlock: "99" } as const;
const state = {
  curveSupply: BigInt("100000000000000000000"),
  soldSupply: BigInt("10000000000000000000"),
  reserveBalance: BigInt("10000000000000000"),
  graduationThreshold: BigInt("90000000000000000000"),
  lifecycle: 0,
  nativeBalance: BigInt("1000000000000000000"),
  tokenBalance: BigInt("5000000000000000000"),
  allowance: BigInt(0),
  decimals: 18,
};
const buyQuote = {
  tokenAmount: BigInt("1000000000000000000"), reserveIn: BigInt("10000000000000000"),
  maxReserveIn: BigInt("10100000000000000"), curveCost: BigInt("9800000000000000"),
  protocolFee: BigInt("100000000000000"), creatorFee: BigInt("100000000000000"),
  slippageBps: 100, deadline: BigInt(2_000_000_000),
};
const sellQuote = {
  tokenAmount: BigInt("1000000000000000000"), reserveOut: BigInt("10000000000000000"),
  minReserveOut: BigInt("9900000000000000"), curveValue: BigInt("10200000000000000"),
  protocolFee: BigInt("100000000000000"), creatorFee: BigInt("100000000000000"),
  slippageBps: 100, deadline: BigInt(2_000_000_000),
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderPanel(overrides: Partial<ComponentProps<typeof TokenTradePanel>> = {}) {
  const quoteBuy = vi.fn().mockResolvedValue(buyQuote);
  const quoteSell = vi.fn().mockResolvedValue(sellQuote);
  const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report, assertReady) => {
    report("preparing");
    assertReady();
    report("awaiting_wallet");
    report("submitted", hash);
    report("confirming", hash);
    return { status: "confirmed", hash };
  });
  const resume = vi.fn().mockResolvedValue({ status: "confirmed", hash });
  const check = vi.fn().mockResolvedValue({ status: "pending", hash });
  const onConfirmed = vi.fn();
  const view = render(<TokenTradePanel
    walletConnected walletMode="browser" chainId={5042002} walletAddress={wallet} tokenAddress={token} symbol="COOKET"
    state={state} statePending={false} quoteBuy={quoteBuy} quoteSell={quoteSell}
    execute={execute} resume={resume} check={check} onConfirmed={onConfirmed} {...overrides}
  />);
  return { ...view, quoteBuy, quoteSell, execute, resume, check, onConfirmed };
}

async function requestBuyQuote(user: ReturnType<typeof userEvent.setup>, value = "0.01") {
  await user.type(screen.getByLabelText("Native USDC amount"), value);
  await user.click(screen.getByRole("button", { name: "Get quote" }));
  await screen.findByText("You receive");
}

async function requestSellQuote(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Sell $COOKET" }));
  await user.type(screen.getByLabelText("COOKET amount"), "1");
  await user.click(screen.getByRole("button", { name: "Get quote" }));
  await screen.findByText(/Minimum USDC output/);
}

function storePending(overrides: Partial<Parameters<typeof persistPendingTrade>[0]> = {}) {
  persistPendingTrade({ version: 1, walletAddress: wallet, tokenAddress: token, side: "buy", hash, status: "confirmation_unknown", submittedAt: Date.now(), ...overrides });
}

function assetCell(label: "Pay" | "Receive") {
  return screen.getByText(label, { selector: "p" }).parentElement as HTMLElement;
}

function expectUsdcIdentity(root: HTMLElement) {
  const image = root.querySelector('[data-testid="trade-asset-usdc"] img');
  expect(root.querySelector('[data-testid="trade-asset-usdc"]')?.textContent).toContain("USDC");
  expect(image?.getAttribute("src")).toBe(USDC_TOKEN_LOGO_SRC);
  expect(image?.getAttribute("src")).not.toMatch(/^https?:/i);
}

function expectTokenIdentity(root: HTMLElement, symbol: string, imageURL?: string) {
  const identity = root.querySelector('[data-testid="trade-asset-token"]') as HTMLElement;
  expect(identity.textContent).toContain(`$${symbol}`);
  const image = identity.querySelector("img");
  if (imageURL) {
    expect(image).not.toBeNull();
    expect(image!.getAttribute("src")).toBe(apiAssetURL(imageURL));
  } else {
    expect(image).toBeNull();
    expect(identity.querySelector("[aria-hidden]")).toBeNull();
  }
}

describe("TokenTradePanel", () => {
  it("stacks quote confirmation below inputs in the compact sidebar", async () => {
    const user = userEvent.setup();
    renderPanel({ tokenPriceWei: "1000000000" });
    const inputs = screen.getByLabelText("Trade inputs and wallet");
    const confirmation = screen.getByLabelText("Quote and confirmation");
    expect(inputs.parentElement).toBe(confirmation.parentElement);
    expect(inputs.compareDocumentPosition(confirmation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(confirmation.className).toContain("border-t");
    await requestBuyQuote(user);
    expect(screen.getByText("You receive")).toBeTruthy();
    expect(screen.getByText("1 $COOKET")).toBeTruthy();
    expect(screen.queryByText("Exact token output")).toBeNull();
  });

  it("keeps ready quote decisions visible and secondary fields in a closed disclosure", async () => {
    const user = userEvent.setup();
    renderPanel({ tokenPriceWei: "1000000000" });
    await requestBuyQuote(user);

    const panel = screen.getByLabelText("Buy and sell");
    const readyQuote = screen.getByLabelText("Ready protected quote");
    const details = screen.getByText("Quote details").closest("details") as HTMLDetailsElement;
    expect(panel.contains(readyQuote)).toBe(true);
    expect(readyQuote.className).not.toMatch(/rounded|border|bg-|p-4/);
    expect(screen.getByText("You receive")).toBeTruthy();
    expect(screen.getByText("Maximum input")).toBeTruthy();
    expect(screen.getByText("Fees")).toBeTruthy();
    expect(screen.getByText("Slippage protection")).toBeTruthy();
    expect(screen.getByText("Quote expiry")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm buy" })).toBeTruthy();
    expect(screen.queryByText("Quote summary")).toBeNull();
    expect(details.open).toBe(false);
    expect(details.contains(screen.getByText("Protocol fee"))).toBe(true);
    expect(details.contains(screen.getByText("Creator fee"))).toBe(true);
  });

  it("does not reintroduce wide-panel breakpoint styling and truncates the active address", () => {
    renderPanel();
    const address = screen.getByText(wallet);

    expect(panelSource).not.toContain("lg:grid-cols-[minmax(0,0.95fr)_minmax(18rem,1.05fr)]");
    expect(panelSource).not.toContain("lg:border-l");
    expect(panelSource).not.toContain("lg:pl-5");
    expect(address.className).toContain("truncate");
    expect(address.getAttribute("title")).toBe(wallet);
  });

  it("debounces amount changes before requesting an automatic protected quote", async () => {
    vi.useFakeTimers();
    const { quoteBuy } = renderPanel();
    fireEvent.change(screen.getByLabelText("Native USDC amount"), { target: { value: "0.0" } });
    fireEvent.change(screen.getByLabelText("Native USDC amount"), { target: { value: "0.01" } });
    expect(quoteBuy).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(quoteBuy).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(quoteBuy).toHaveBeenCalledTimes(1);
    expect(quoteBuy).toHaveBeenCalledWith(BigInt("10000000000000000"), 100);
  });

  it("automatically refreshes when side, wallet, or token identity changes", async () => {
    vi.useFakeTimers();
    const view = renderPanel();
    fireEvent.change(screen.getByLabelText("Native USDC amount"), { target: { value: "0.01" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(view.quoteBuy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Sell $COOKET" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(view.quoteSell).toHaveBeenCalledTimes(1);

    view.rerender(<TokenTradePanel walletConnected walletMode="browser" chainId={5042002} walletAddress={otherWallet} tokenAddress={token} symbol="COOKET" state={state} statePending={false} quoteBuy={view.quoteBuy} quoteSell={view.quoteSell} execute={view.execute} resume={view.resume} check={view.check} onConfirmed={view.onConfirmed} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(view.quoteBuy).toHaveBeenCalledTimes(2);

    view.rerender(<TokenTradePanel walletConnected walletMode="browser" chainId={5042002} walletAddress={otherWallet} tokenAddress={otherToken} symbol="COOKET" state={state} statePending={false} quoteBuy={view.quoteBuy} quoteSell={view.quoteSell} execute={view.execute} resume={view.resume} check={view.check} onConfirmed={view.onConfirmed} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(view.quoteBuy).toHaveBeenCalledTimes(3);
  });

  it("ignores a stale automatic quote response after the amount changes", async () => {
    vi.useFakeTimers();
    let resolveFirst: ((quote: typeof buyQuote) => void) | undefined;
    let resolveSecond: ((quote: typeof buyQuote) => void) | undefined;
    const quoteBuy = vi.fn()
      .mockImplementationOnce(() => new Promise<typeof buyQuote>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<typeof buyQuote>((resolve) => { resolveSecond = resolve; }));
    renderPanel({ quoteBuy });
    fireEvent.change(screen.getByLabelText("Native USDC amount"), { target: { value: "0.01" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByText(/Reading a protected quote/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Native USDC amount"), { target: { value: "0.02" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const latest = { ...buyQuote, tokenAmount: BigInt("2000000000000000000") };
    await act(async () => { resolveSecond?.(latest); });
    expect(screen.getByText("2 $COOKET")).toBeTruthy();
    await act(async () => { resolveFirst?.(buyQuote); });
    expect(screen.queryByText("1 $COOKET")).toBeNull();
  });

  it("shows an automatic quote error without fabricating a summary", async () => {
    vi.useFakeTimers();
    renderPanel({ quoteBuy: vi.fn().mockRejectedValue(new Error("Curve quote RPC unavailable")) });
    fireEvent.change(screen.getByLabelText("Native USDC amount"), { target: { value: "0.01" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByText("Trade failed.")).toBeTruthy();
    expect(screen.getByText("Curve quote RPC unavailable")).toBeTruthy();
    expect(screen.queryByText("Quote summary")).toBeNull();
  });

  it("hides confirmation and clearly marks a quote when its TTL expires", async () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.change(screen.getByLabelText("Native USDC amount"), { target: { value: "0.01" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Get quote" })); });
    expect(screen.getByRole("button", { name: "Confirm buy" })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText("This quote expired. Refresh it before submitting.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm buy" })).toBeNull();
  });

  it("prevents duplicate clicks throughout preparation and wallet confirmation", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report) => {
      report("awaiting_wallet");
      return new Promise(() => undefined);
    });
    renderPanel({ execute });
    await requestBuyQuote(user);
    await user.dblClick(screen.getByRole("button", { name: "Confirm buy" }));
    await user.dblClick(screen.getByRole("button", { name: "Submit buy" }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Confirm the transaction in your active wallet/)).toBeTruthy();
    expect(localStorage.getItem(pendingTradeKey(token, wallet))).toContain('"status":"confirmation_unknown"');
  });

  it("rechecks durable recovery before submission to block another tab", async () => {
    const user = userEvent.setup();
    const { execute } = renderPanel();
    await requestBuyQuote(user);
    storePending();
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText(/Another tab or prior session/)).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });

  it("moves a submitted timeout to confirmation_unknown and persists the hash", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report) => {
      report("submitted", hash);
      report("confirming", hash);
      throw new Error("receipt timeout");
    });
    renderPanel({ execute });
    await requestBuyQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText(/confirmation is unknown/i)).toBeTruthy();
    expect(localStorage.getItem(pendingTradeKey(token, wallet))).toContain(hash);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("does not lose captured replacement provenance when confirmation becomes unknown", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report) => {
      report("submitted", hash);
      report("confirming", hash, recovery);
      throw new Error("receipt timeout");
    });
    renderPanel({ execute });
    await requestBuyQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText(/confirmation is unknown/i)).toBeTruthy();
    expect(readPendingTrade(token, wallet)?.recovery).toEqual(recovery);
  });

  it("locks a hashless wallet timeout until explicit abandonment", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report) => {
      report("awaiting_wallet");
      throw new Error("provider timeout");
    });
    renderPanel({ execute });
    await requestBuyQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText(/no transaction hash was returned/i)).toBeTruthy();
    expect(localStorage.getItem(pendingTradeKey(token, wallet))).toContain('"status":"confirmation_unknown"');
    expect(screen.queryByRole("button", { name: "Check Again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Abandon Pending Trade" })).toBeTruthy();
  });

  it("blocks a new submission while confirmation is unknown", async () => {
    storePending();
    const { execute } = renderPanel();
    expect(await screen.findByText(/New trades are blocked/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Buy $COOKET" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Sell $COOKET" }) as HTMLButtonElement).disabled).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("Check Again resolves confirmed and refreshes the page data", async () => {
    storePending();
    const user = userEvent.setup();
    const check = vi.fn().mockResolvedValue({ status: "confirmed", hash });
    const { onConfirmed } = renderPanel({ check });
    await user.click(await screen.findByRole("button", { name: "Check Again" }));
    expect(await screen.findByText("Trade confirmed.")).toBeTruthy();
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it("Check Again resolves a reverted transaction without reporting success", async () => {
    storePending();
    const user = userEvent.setup();
    const { onConfirmed } = renderPanel({ check: vi.fn().mockResolvedValue({ status: "reverted", hash }) });
    await user.click(await screen.findByRole("button", { name: "Check Again" }));
    expect(await screen.findByText("Transaction reverted.")).toBeTruthy();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("handles a replaced transaction as a terminal recovery result", async () => {
    storePending();
    const user = userEvent.setup();
    renderPanel({ check: vi.fn().mockResolvedValue({ status: "replaced", hash: replacementHash, replacementReason: "cancelled" }) });
    await user.click(await screen.findByRole("button", { name: "Check Again" }));
    expect(await screen.findByText("Transaction replaced.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Explorer" }).getAttribute("href")).toContain(replacementHash);
    expect(localStorage.length).toBe(0);
  });

  it("recovers after refresh without automatically claiming success", async () => {
    storePending();
    const { resume, check } = renderPanel();
    expect(await screen.findByText(/confirmation is unknown/i)).toBeTruthy();
    expect(resume).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Resume Confirmation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Explorer" })).toBeTruthy();
  });

  it("isolates recovery records by wallet and token route", async () => {
    storePending();
    const first = renderPanel({ walletAddress: otherWallet });
    await waitFor(() => expect(screen.queryByText(/confirmation is unknown/i)).toBeNull());
    first.unmount();
    renderPanel({ tokenAddress: otherToken });
    await waitFor(() => expect(screen.queryByText(/confirmation is unknown/i)).toBeNull());
    expect(localStorage.getItem(pendingTradeKey(token, wallet))).not.toBeNull();
  });

  it("resets visible recovery when wallet or token changes", async () => {
    storePending();
    const view = renderPanel();
    expect(await screen.findByText(/confirmation is unknown/i)).toBeTruthy();
    view.rerender(<TokenTradePanel key={`${otherWallet}:${token}`} walletConnected walletMode="browser" chainId={5042002} walletAddress={otherWallet} tokenAddress={token} symbol="COOKET" state={state} statePending={false} quoteBuy={view.quoteBuy} quoteSell={view.quoteSell} execute={view.execute} resume={view.resume} check={view.check} onConfirmed={view.onConfirmed} />);
    await waitFor(() => expect(screen.queryByText(/confirmation is unknown/i)).toBeNull());
    view.rerender(<TokenTradePanel key={`${otherWallet}:${otherToken}`} walletConnected walletMode="browser" chainId={5042002} walletAddress={otherWallet} tokenAddress={otherToken} symbol="COOKET" state={state} statePending={false} quoteBuy={view.quoteBuy} quoteSell={view.quoteSell} execute={view.execute} resume={view.resume} check={view.check} onConfirmed={view.onConfirmed} />);
    expect(screen.getByRole("button", { name: "Get quote" })).toBeTruthy();
  });

  it("rejects an expired quote before submission", async () => {
    const user = userEvent.setup();
    const { execute } = renderPanel();
    await requestBuyQuote(user);
    vi.setSystemTime(Date.now() + 60_001);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText("This quote expired. Request a fresh quote before submitting.")).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks submission if the network changes during preparation", async () => {
    const user = userEvent.setup();
    let continuePreparation: (() => void) | undefined;
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report, assertReady) => {
      report("preparing");
      await new Promise<void>((resolve) => { continuePreparation = resolve; });
      assertReady();
      return { status: "confirmed", hash };
    });
    const view = renderPanel({ execute });
    await requestBuyQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    view.rerender(<TokenTradePanel walletConnected walletMode="browser" chainId={1} walletAddress={wallet} tokenAddress={token} symbol="COOKET" state={state} statePending={false} quoteBuy={view.quoteBuy} quoteSell={view.quoteSell} execute={execute} resume={view.resume} check={view.check} onConfirmed={view.onConfirmed} />);
    continuePreparation?.();
    expect(await screen.findByText(/network.*changed before submission/i)).toBeTruthy();
    expect(localStorage.length).toBe(0);
  });

  it("reports approval batch failure before a hash as failed and permits a fresh quote", async () => {
    const user = userEvent.setup();
    const execute = vi.fn<TradeExecution>().mockRejectedValue(new Error("approval batch rejected"));
    renderPanel({ execute });
    await requestSellQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm sell" }));
    await user.click(screen.getByRole("button", { name: /Start approval \+ sell|Submit sell/ }));
    expect(await screen.findByText("Wallet request rejected.")).toBeTruthy();
    expect(localStorage.length).toBe(0);
    expect((screen.getByRole("button", { name: "Get quote" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("completes successful buy and sell flows with protected quote values", async () => {
    const user = userEvent.setup();
    const first = renderPanel();
    await requestBuyQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText("Trade confirmed.")).toBeTruthy();
    expect(first.execute.mock.calls[0][0]).toMatchObject({ side: "buy", maxReserveIn: buyQuote.maxReserveIn });
    first.unmount();
    const second = renderPanel();
    await requestSellQuote(userEvent.setup());
    await userEvent.click(screen.getByRole("button", { name: "Confirm sell" }));
    await userEvent.click(screen.getByRole("button", { name: /Start approval \+ sell|Submit sell/ }));
    expect(await screen.findByText("Trade confirmed.")).toBeTruthy();
    expect(second.execute.mock.calls[0][0]).toMatchObject({ side: "sell", minReserveOut: sellQuote.minReserveOut });
  });

  it("allows sells but blocks buys in GraduationPending", async () => {
    const user = userEvent.setup();
    const pendingState = { ...state, lifecycle: 1, soldSupply: state.graduationThreshold };
    const { quoteBuy, quoteSell } = renderPanel({ state: pendingState });
    expect(screen.getByText(/New buys are paused, but holders may still sell/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Get quote" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Sell $COOKET" }));
    await user.type(screen.getByLabelText("COOKET amount"), "1");
    await user.click(screen.getByRole("button", { name: "Get quote" }));
    expect(await screen.findByText(/Minimum USDC output/)).toBeTruthy();
    expect(quoteBuy).not.toHaveBeenCalled();
    expect(quoteSell).toHaveBeenCalledTimes(1);
  });

  it("handles a rejected wallet request without persisting or exposing Retry", async () => {
    const user = userEvent.setup();
    renderPanel({ execute: vi.fn<TradeExecution>().mockRejectedValue(new Error("User rejected request")) });
    await requestBuyQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText(/wallet request was rejected/i)).toBeTruthy();
    expect(localStorage.length).toBe(0);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("does not report a rejected external-wallet transaction as successful", async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    renderPanel({ walletMode: "browser", execute: vi.fn<TradeExecution>().mockRejectedValue(Object.assign(new Error("User rejected the request"), { code: 4001 })), onConfirmed });
    await requestBuyQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm buy" }));
    await user.click(screen.getByRole("button", { name: "Submit buy" }));
    expect(await screen.findByText("Wallet request rejected.")).toBeTruthy();
    expect(screen.getByText(/wallet request was rejected/i)).toBeTruthy();
    expect(screen.queryByText("Trade confirmed.")).toBeNull();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("locks external trading when an approval receipt becomes uncertain", async () => {
    const user = userEvent.setup();
    const approvalHash = `0x${"41".repeat(32)}` as const;
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report) => {
      report("awaiting_approval");
      report("approval_confirming", approvalHash);
      throw new Error("receipt timeout");
    });
    renderPanel({ walletMode: "browser", execute });
    await requestSellQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm sell" }));
    await user.click(screen.getByRole("button", { name: /Start approval \+ sell|Submit sell/ }));
    expect(await screen.findByText(/approval receipt is uncertain/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Explorer" }).getAttribute("href")).toContain(approvalHash);
    expect(localStorage.getItem(pendingTradeKey(token, wallet))).toContain('"status":"confirmation_unknown"');
  });

  it("requires a fresh quote when it expires after external approval", async () => {
    const user = userEvent.setup();
    const approvalHash = `0x${"41".repeat(32)}` as const;
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report, assertReady) => {
      report("awaiting_approval");
      report("approval_confirming", approvalHash);
      report("preparing");
      const expiredNow = Date.now() + 60_001;
      vi.spyOn(Date, "now").mockReturnValue(expiredNow);
      assertReady();
      throw new Error("sell must not be submitted");
    });
    renderPanel({ walletMode: "browser", execute });
    await requestSellQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm sell" }));
    await user.click(screen.getByRole("button", { name: /Start approval \+ sell|Submit sell/ }));
    expect(await screen.findByText(/quote expired during wallet approval/i)).toBeTruthy();
    expect(screen.queryByText("Trade confirmed.")).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("continues after the expected allowance and approval-gas balance refresh", async () => {
    const user = userEvent.setup();
    let continueAfterRefresh: (() => void) | undefined;
    const approvalHash = `0x${"41".repeat(32)}` as const;
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report, assertReady) => {
      report("awaiting_approval");
      report("approval_confirming", approvalHash);
      await new Promise<void>((resolve) => { continueAfterRefresh = resolve; });
      report("preparing");
      assertReady();
      report("awaiting_wallet");
      report("submitted", hash);
      report("confirming", hash);
      return { status: "confirmed", hash };
    });
    const view = renderPanel({ walletMode: "browser", execute });
    await requestSellQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm sell" }));
    await user.click(screen.getByRole("button", { name: /Start approval \+ sell|Submit sell/ }));
    expect(await screen.findByText(/Waiting for the approval receipt/)).toBeTruthy();
    view.rerender(<TokenTradePanel
      walletConnected walletMode="browser" chainId={5042002} walletAddress={wallet} tokenAddress={token} symbol="COOKET"
      state={{ ...state, allowance: sellQuote.tokenAmount, nativeBalance: state.nativeBalance - BigInt(1) }} statePending={false}
      quoteBuy={view.quoteBuy} quoteSell={view.quoteSell} execute={execute} resume={view.resume} check={view.check} onConfirmed={view.onConfirmed}
    />);
    continueAfterRefresh?.();
    expect(await screen.findByText("Trade confirmed.")).toBeTruthy();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("shows the actual sell simulation revert reason", async () => {
    const user = userEvent.setup();
    renderPanel({
      walletMode: "browser",
      execute: vi.fn<TradeExecution>().mockRejectedValue(new Error("ContractFunctionExecutionError: sell reverted with SlippageExceeded")),
    });
    await requestSellQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm sell" }));
    await user.click(screen.getByRole("button", { name: /Start approval \+ sell|Submit sell/ }));
    expect(await screen.findByText(/sell reverted with SlippageExceeded/)).toBeTruthy();
    expect(screen.queryByText(/preparation reverted before submission/i)).toBeNull();
    expect(screen.queryByText("Trade confirmed.")).toBeNull();
  });

  it("reports external sell success only after its sell receipt is confirmed", async () => {
    const user = userEvent.setup();
    let confirmReceipt: ((resolution: { status: "confirmed"; hash: typeof hash }) => void) | undefined;
    const execute = vi.fn<TradeExecution>().mockImplementation(async (_quote, report) => {
      report("awaiting_wallet");
      report("submitted", hash);
      report("confirming", hash);
      return new Promise((resolve) => { confirmReceipt = resolve; });
    });
    const { onConfirmed } = renderPanel({ walletMode: "browser", execute });
    await requestSellQuote(user);
    await user.click(screen.getByRole("button", { name: "Confirm sell" }));
    await user.click(screen.getByRole("button", { name: /Start approval \+ sell|Submit sell/ }));
    expect(await screen.findByText(/Waiting for Arc Testnet confirmation/)).toBeTruthy();
    expect(screen.queryByText("Trade confirmed.")).toBeNull();
    expect(onConfirmed).not.toHaveBeenCalled();
    confirmReceipt?.({ status: "confirmed", hash });
    expect(await screen.findByText("Trade confirmed.")).toBeTruthy();
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("requires a strong warning before explicitly abandoning recovery", async () => {
    storePending();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderPanel();
    const button = await screen.findByRole("button", { name: "Abandon Pending Trade" });
    await user.click(button);
    expect(localStorage.length).toBe(1);
    await user.click(button);
    expect(confirm.mock.calls[0][0]).toMatch(/duplicate trade or additional loss/i);
    expect(localStorage.length).toBe(0);
  });

  it("applies 10% and 50% buy presets from the native balance", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Use 10% of native USDC balance" }));
    expect((screen.getByLabelText("Native USDC amount") as HTMLInputElement).value).toBe("0.1");
    await user.click(screen.getByRole("button", { name: "Use 50% of native USDC balance" }));
    expect((screen.getByLabelText("Native USDC amount") as HTMLInputElement).value).toBe("0.5");
  });

  it("uses the exact token balance for sell MAX", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Sell $COOKET" }));
    await user.click(screen.getByRole("button", { name: "Use exact token balance" }));
    expect((screen.getByLabelText("COOKET amount") as HTMLInputElement).value).toBe("5");
  });

  it("reserves ETH for gas on buy MAX", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Use maximum native USDC after gas reserve" }));
    expect((screen.getByLabelText("Native USDC amount") as HTMLInputElement).value).toBe("0.999");
  });

  it("invalidates an existing quote when a preset changes the amount", async () => {
    const user = userEvent.setup();
    const { quoteBuy } = renderPanel();
    await requestBuyQuote(user);
    expect(screen.getByRole("button", { name: "Confirm buy" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use 50% of native USDC balance" }));
    expect(screen.queryByRole("button", { name: "Confirm buy" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Get quote" }));
    expect(await screen.findByRole("button", { name: "Confirm buy" })).toBeTruthy();
    expect(quoteBuy).toHaveBeenLastCalledWith(BigInt("500000000000000000"), 100);
  });

  it("disables presets when balances are unavailable", () => {
    renderPanel({ state: undefined, statePending: true });
    expect((screen.getByRole("button", { name: "Use 10% of native USDC balance" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Use 50% of native USDC balance" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Use maximum native USDC after gas reserve" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables buy MAX when the ETH balance cannot cover the gas reserve", () => {
    renderPanel({ state: { ...state, nativeBalance: BigInt("1000000000000000") } });
    expect((screen.getByRole("button", { name: "Use maximum native USDC after gas reserve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Use 10% of native USDC balance" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows official USDC on buy Pay and a creator image on Receive only when available", async () => {
    const user = userEvent.setup();
    renderPanel({ tokenImageURL: "/uploads/cooket.png" });
    expectUsdcIdentity(assetCell("Pay"));
    expectTokenIdentity(assetCell("Receive"), "COOKET", "/uploads/cooket.png");
    await user.click(screen.getByRole("button", { name: "Sell $COOKET" }));
    expectTokenIdentity(assetCell("Pay"), "COOKET", "/uploads/cooket.png");
    expectUsdcIdentity(assetCell("Receive"));
  });

  it("omits a token image on buy and sell when the creator did not provide one", async () => {
    const user = userEvent.setup();
    renderPanel();
    expectUsdcIdentity(assetCell("Pay"));
    expectTokenIdentity(assetCell("Receive"), "COOKET");
    await user.click(screen.getByRole("button", { name: "Sell $COOKET" }));
    expectTokenIdentity(assetCell("Pay"), "COOKET");
    expectUsdcIdentity(assetCell("Receive"));
  });
});
