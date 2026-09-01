import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  account: {} as Record<string, unknown>,
  walletClient: { data: undefined, error: null } as Record<string, unknown>,
  open: vi.fn().mockResolvedValue(undefined),
  disconnectAsync: vi.fn().mockResolvedValue(undefined),
  disconnecting: false,
  providerRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: sdk.open }) }));
vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useAccount: () => sdk.account,
    useWalletClient: () => sdk.walletClient,
    useDisconnect: () => ({ disconnectAsync: sdk.disconnectAsync, isPending: sdk.disconnecting }),
  };
});

import { ActiveWalletProvider, useActiveWallet } from "./active-wallet-provider";

const firstAddress = "0x1111111111111111111111111111111111111111";
const secondAddress = "0x2222222222222222222222222222222222222222";

beforeEach(() => configureConnected(firstAddress, 5042002));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ActiveWalletProvider", () => {
  it("makes the connected external Wagmi signer active", () => {
    render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(screen.getByTestId("contract").textContent).toBe(`wallet_ready|${firstAddress}|5042002|true|true`);
  });

  it("opens the AppKit EVM wallet selection modal", async () => {
    const user = userEvent.setup();
    render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    await user.click(screen.getByRole("button", { name: "Connect test wallet" }));
    expect(sdk.open).toHaveBeenCalledWith({ view: "Connect", namespace: "eip155" });
  });

  it("updates the active wallet only when the account and signer change together", () => {
    const view = render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    sdk.account = connectedAccount(secondAddress, 5042002);
    view.rerender(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(screen.getByTestId("contract").textContent).toBe(`signer_mismatch|${secondAddress}|5042002|false|false`);

    sdk.walletClient = walletClient(secondAddress, 5042002);
    view.rerender(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(screen.getByTestId("contract").textContent).toBe(`wallet_ready|${secondAddress}|5042002|true|true`);
  });

  it("invalidates the stale transaction client when the chain changes", () => {
    const view = render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    sdk.account = connectedAccount(firstAddress, 1);
    view.rerender(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(screen.getByTestId("contract").textContent).toBe(`wrong_network|${firstAddress}|1|false|false`);
  });

  it.each([8453, 84532])("rejects Base chain ID %i", (chainId) => {
    configureConnected(firstAddress, chainId);
    render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(screen.getByTestId("contract").textContent).toBe(`wrong_network|${firstAddress}|${chainId}|false|false`);
  });

  it("disconnects and clears active wallet state", async () => {
    const user = userEvent.setup();
    const view = render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    await user.click(screen.getByRole("button", { name: "Disconnect test wallet" }));
    expect(sdk.disconnectAsync).toHaveBeenCalledOnce();

    sdk.account = disconnectedAccount();
    sdk.walletClient = { data: undefined, error: null };
    view.rerender(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    expect(screen.getByTestId("contract").textContent).toBe("disconnected|none|none|false|false");
  });

  it("uses the connected EIP-1193 provider to switch to Arc", async () => {
    const user = userEvent.setup();
    configureConnected(firstAddress, 8453);
    render(<ActiveWalletProvider><Probe /></ActiveWalletProvider>);
    await user.click(screen.getByRole("button", { name: "Switch test wallet" }));
    expect(sdk.providerRequest).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x4cef52" }] });
  });
});

function Probe() {
  const active = useActiveWallet();
  return <>
    <output data-testid="contract">{`${active.status}|${active.activeAddress ?? "none"}|${active.activeChainId ?? "none"}|${active.canTransact}|${Boolean(active.walletClient)}`}</output>
    <button type="button" onClick={() => void active.connectWallet()}>Connect test wallet</button>
    <button type="button" onClick={() => void active.switchToSelectedChain()}>Switch test wallet</button>
    <button type="button" onClick={() => void active.disconnectWallet()}>Disconnect test wallet</button>
  </>;
}

function configureConnected(address: string, chainId: number) {
  sdk.account = connectedAccount(address, chainId);
  sdk.walletClient = walletClient(address, chainId);
}

function connectedAccount(address: string, chainId: number) {
  return {
    address,
    chainId,
    isConnected: true,
    status: "connected",
    connector: {
      id: "injected",
      uid: "injected:test",
      name: "MetaMask",
      getProvider: vi.fn().mockResolvedValue({ request: sdk.providerRequest }),
    },
  };
}

function disconnectedAccount() {
  return { address: undefined, chainId: undefined, isConnected: false, status: "disconnected", connector: undefined };
}

function walletClient(address: string, chainId: number) {
  return { data: { account: { address }, chain: { id: chainId }, getChainId: vi.fn(), getAddresses: vi.fn() }, error: null };
}
