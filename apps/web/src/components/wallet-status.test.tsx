import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const active = vi.hoisted(() => ({
  value: {
    connected: false,
    ready: true,
    canTransact: false,
    status: "disconnected",
    wallets: [],
    connectWallet: vi.fn().mockResolvedValue(undefined),
    switchToSelectedChain: vi.fn().mockResolvedValue(undefined),
    disconnectWallet: vi.fn().mockResolvedValue(undefined),
  } as Record<string, unknown>,
}));

vi.mock("@/providers/active-wallet-provider", () => ({ useActiveWallet: () => active.value }));

import { WalletStatus } from "./wallet-status";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  active.value = {
    connected: false, ready: true, canTransact: false, status: "disconnected", wallets: [],
    connectWallet: vi.fn().mockResolvedValue(undefined), switchToSelectedChain: vi.fn().mockResolvedValue(undefined), disconnectWallet: vi.fn().mockResolvedValue(undefined),
  };
});

describe("WalletStatus", () => {
  it("opens AppKit from the disconnected state", async () => {
    const user = userEvent.setup();
    render(<WalletStatus />);
    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(active.value.connectWallet).toHaveBeenCalledOnce();
  });

  it("shows the active external address and Arc", () => {
    active.value = readyWallet();
    render(<WalletStatus />);
    expect(screen.getByRole("button", { name: /0x1111…1111/i }).textContent).toContain("Arc");
    expect(document.body.textContent).not.toMatch(/@|email/i);
  });

  it("does not render the disconnected control while wallet restoration is unresolved", () => {
    active.value = { ...readyWallet(), connected: false, ready: false, canTransact: false, status: "sdk_not_ready", activeAddress: undefined, activeChainId: undefined, walletClient: undefined };
    render(<WalletStatus />);
    expect(screen.getByRole("status").textContent).toContain("Restoring wallet");
    expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
  });

  it("renders and invokes the Arc Testnet switch action for a wrong-chain wallet", async () => {
    const user = userEvent.setup();
    active.value = { ...readyWallet(), canTransact: false, status: "wrong_network", activeChainId: 1 };
    render(<WalletStatus />);
    await user.click(screen.getByRole("button", { name: /0x1111…1111/i }));
    await user.click(screen.getByRole("menuitem", { name: "Switch to Arc Testnet" }));
    expect(active.value.switchToSelectedChain).toHaveBeenCalledOnce();
  });

  it("disconnects the external wallet", async () => {
    const user = userEvent.setup();
    active.value = readyWallet();
    render(<WalletStatus />);
    await user.click(screen.getByRole("button", { name: /0x1111…1111/i }));
    await user.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    expect(active.value.disconnectWallet).toHaveBeenCalledOnce();
  });

  it("keeps the compact mobile control width constrained", () => {
    active.value = readyWallet();
    render(<WalletStatus compact />);
    expect(screen.getByRole("button", { name: /0x1111…1111/i }).className).toContain("wallet-control-compact");
  });
});

function readyWallet() {
  return {
    connected: true, ready: true, canTransact: true, status: "wallet_ready",
    activeAddress: "0x1111111111111111111111111111111111111111", activeChainId: 5042002, walletClient: {}, wallets: [{ id: "one", address: "0x1111111111111111111111111111111111111111", label: "MetaMask", kind: "external", chainId: 5042002 }],
    connectWallet: vi.fn().mockResolvedValue(undefined), switchToSelectedChain: vi.fn().mockResolvedValue(undefined), disconnectWallet: vi.fn().mockResolvedValue(undefined),
  };
}
