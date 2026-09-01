"use client";

import { useAppKit } from "@reown/appkit/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAccount, useDisconnect, useWalletClient } from "wagmi";
import { getAddress, isAddress, type Address, type WalletClient } from "viem";
import { selectedCooketChainId, selectedCooketChainName } from "@/lib/chain";
import { switchExternalWalletToArc, type ExternalEip1193Provider } from "@/lib/wallet";

export type ActiveWalletStatus = "sdk_not_ready" | "disconnected" | "wallet_loading" | "wallet_ready" | "wrong_network" | "signer_mismatch" | "initialization_error" | "disconnecting";
export type SelectableWallet = { id: string; address: Address; label: string; kind: "external"; chainId?: number };

type ActiveWalletContextValue = {
  connected: boolean;
  activeAddress?: Address;
  activeChainId?: number;
  walletClient?: WalletClient;
  ready: boolean;
  canTransact: boolean;
  status: ActiveWalletStatus;
  wallets: SelectableWallet[];
  error?: string;
  connectWallet: () => Promise<void>;
  switchToSelectedChain: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
};

const ActiveWalletContext = createContext<ActiveWalletContextValue | null>(null);

export function ActiveWalletProvider({ children }: { children: ReactNode }) {
  const { open } = useAppKit();
  const account = useAccount();
  const { data: wagmiWalletClient, error: walletClientError } = useWalletClient();
  const { disconnectAsync, isPending: disconnecting } = useDisconnect();
  const [actionError, setActionError] = useState<string>();

  const activeAddress = account.isConnected ? normalizedAddress(account.address) : undefined;
  const activeChainId = account.isConnected ? account.chainId : undefined;
  const walletClientAddress = wagmiWalletClient?.account ? normalizedAddress(wagmiWalletClient.account.address) : undefined;
  const signerMatches = Boolean(activeAddress && walletClientAddress && addressesEqual(activeAddress, walletClientAddress));
  const clientChainMatches = Boolean(activeChainId && wagmiWalletClient?.chain?.id === activeChainId);
  const status = deriveActiveWalletStatus({
    accountStatus: account.status,
    isConnected: account.isConnected,
    hasActiveAddress: Boolean(activeAddress),
    activeChainId,
    hasWalletClient: Boolean(wagmiWalletClient),
    signerMatches,
    clientChainMatches,
    initializationError: Boolean(walletClientError),
    disconnecting,
  });
  const connected = Boolean(account.isConnected && activeAddress);
  const ready = account.status !== "connecting" && account.status !== "reconnecting";
  const canTransact = status === "wallet_ready";
  const walletClient = canTransact ? wagmiWalletClient : undefined;

  const connectWallet = useCallback(async () => {
    setActionError(undefined);
    try {
      await open({ view: "Connect", namespace: "eip155" });
    } catch (reason) {
      const message = actionErrorMessage("The external wallet selector could not be opened", reason);
      setActionError(message);
      throw new Error(message, { cause: reason });
    }
  }, [open]);

  const switchToSelectedChain = useCallback(async () => {
    if (!account.connector) throw new Error("Connect an external wallet before switching networks.");
    setActionError(undefined);
    try {
      const provider = await account.connector.getProvider();
      if (!isExternalProvider(provider)) throw new Error("The connected wallet does not expose an EIP-1193 provider.");
      await switchExternalWalletToArc(provider);
    } catch (reason) {
      const message = actionErrorMessage(`The request to switch to ${selectedCooketChainName} was rejected or failed`, reason);
      setActionError(message);
      throw new Error(message, { cause: reason });
    }
  }, [account.connector]);

  const disconnectWallet = useCallback(async () => {
    setActionError(undefined);
    try {
      await disconnectAsync();
    } catch (reason) {
      const message = actionErrorMessage("Wallet disconnection failed", reason);
      setActionError(message);
      throw new Error(message, { cause: reason });
    }
  }, [disconnectAsync]);

  const wallets = useMemo<SelectableWallet[]>(() => activeAddress ? [{
    id: account.connector?.uid || account.connector?.id || activeAddress,
    address: activeAddress,
    label: account.connector?.name || "External wallet",
    kind: "external",
    chainId: activeChainId,
  }] : [], [account.connector?.id, account.connector?.name, account.connector?.uid, activeAddress, activeChainId]);

  const value = useMemo<ActiveWalletContextValue>(() => ({
    connected,
    activeAddress,
    activeChainId,
    walletClient,
    ready,
    canTransact,
    status,
    wallets,
    error: walletClientError?.message || actionError,
    connectWallet,
    switchToSelectedChain,
    disconnectWallet,
  }), [actionError, activeAddress, activeChainId, canTransact, connectWallet, connected, disconnectWallet, ready, status, switchToSelectedChain, walletClient, walletClientError?.message, wallets]);

  return <ActiveWalletContext.Provider value={value}>{children}</ActiveWalletContext.Provider>;
}

export function useActiveWallet() {
  const value = useContext(ActiveWalletContext);
  if (!value) throw new Error("useActiveWallet must be used within ActiveWalletProvider");
  return value;
}

export function deriveActiveWalletStatus(input: {
  accountStatus: "connected" | "connecting" | "disconnected" | "reconnecting";
  isConnected: boolean;
  hasActiveAddress: boolean;
  activeChainId?: number;
  hasWalletClient: boolean;
  signerMatches: boolean;
  clientChainMatches: boolean;
  initializationError: boolean;
  disconnecting: boolean;
}): ActiveWalletStatus {
  if (input.disconnecting) return "disconnecting";
  if (input.initializationError) return "initialization_error";
  if (input.accountStatus === "connecting" || input.accountStatus === "reconnecting") return "sdk_not_ready";
  if (!input.isConnected) return "disconnected";
  if (!input.hasActiveAddress) return "signer_mismatch";
  if (input.activeChainId !== selectedCooketChainId) return "wrong_network";
  if (!input.hasWalletClient) return "wallet_loading";
  if (!input.signerMatches || !input.clientChainMatches) return "signer_mismatch";
  return "wallet_ready";
}

export function activeWalletStatusMessage(status: ActiveWalletStatus): string {
  return ({
    sdk_not_ready: "Restoring the external wallet connection…",
    disconnected: "Connect an external EVM wallet to continue.",
    wallet_loading: "Preparing the active external wallet…",
    wallet_ready: "External wallet ready.",
    wrong_network: `Switch the active wallet to ${selectedCooketChainName} (${selectedCooketChainId}).`,
    signer_mismatch: "The displayed address and transaction signer do not match. Reconnect the wallet before continuing.",
    initialization_error: "External wallet integration could not initialize.",
    disconnecting: "Disconnecting wallet…",
  } as const)[status];
}

function normalizedAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? getAddress(value) : undefined;
}

function addressesEqual(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function isExternalProvider(value: unknown): value is ExternalEip1193Provider {
  return Boolean(value && typeof value === "object" && typeof Reflect.get(value, "request") === "function");
}

function actionErrorMessage(prefix: string, reason: unknown) {
  return `${prefix}${reason instanceof Error && reason.message ? `: ${reason.message}` : "."}`;
}
