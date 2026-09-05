import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CTOCheckpointPage, CTOProposal, CTOStatus, CTOTreasury, CTOTreasuryTransferPage } from "@cooket/types";

const apiMocks = vi.hoisted(() => ({
  ctoStatus: vi.fn(),
  ctoProposals: vi.fn(),
  ctoCheckpoints: vi.fn(),
  ctoProposal: vi.fn(),
  ctoTreasury: vi.fn(),
  ctoTreasuryTransfers: vi.fn(),
  ctoTreasuryFeePulls: vi.fn(),
}));
const ctoMocks = vi.hoisted(() => ({
  readCTOChainState: vi.fn(), proposeCTO: vi.fn(), acceptCTOFromController: vi.fn(), cancelCTO: vi.fn(), expireCTO: vi.fn(), executeCTO: vi.fn(),
}));
const active = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, ...apiMocks } };
});
vi.mock("@/lib/cto-transactions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/cto-transactions")>();
  return { ...original, ...ctoMocks };
});
vi.mock("@/providers/active-wallet-provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/providers/active-wallet-provider")>();
  return { ...original, useActiveWallet: () => active.value };
});

import { CTO_CHAIN_REFRESH_MS, TokenCTO } from "./token-cto";

const token = "0x00000000000000000000000000000000000000aa";
const registry = "0x00000000000000000000000000000000000000bb";
const treasury = "0x00000000000000000000000000000000000000cc";
const controller = "0x00000000000000000000000000000000000000dd";
const previous = "0x00000000000000000000000000000000000000ee";
const creator = "0x00000000000000000000000000000000000000ff";
const proposalId = `0x${"ab".repeat(32)}`;
const metadataHash = `0x${"33".repeat(32)}`;
const provenance = { block_number: 9, block_hash: `0x${"11".repeat(32)}`, transaction_hash: `0x${"22".repeat(32)}`, log_index: 3 };
const source = readFileSync(resolve(process.cwd(), "src/components/token-cto.tsx"), "utf8");
const fetchSpy = vi.fn();

function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderWithClient(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return { client, ...render(<TokenCTO tokenAddress={token} />, { wrapper: ({ children }) => <Providers client={client}>{children}</Providers> }) };
}

function inactiveStatus(): CTOStatus {
  return { chain_id: 5042002, token, active: false };
}

function activeStatus(): CTOStatus {
  return { chain_id: 5042002, token, active: true, registry, treasury, controller, previous_recipient: previous, active_proposal_id: proposalId, activation: provenance };
}

function proposal(metadataURI: string): CTOProposal {
  return { proposal_id: proposalId, token, registry, treasury, creator, controller, previous_recipient: previous, nonce: "18446744073709551615", metadata_hash: metadataHash, metadata_uri: metadataURI, state: "active", created_timestamp: 1, created: provenance, acceptance_deadline: 2 };
}

function proposed(): CTOProposal { return { ...proposal(""), state: "proposed", created_timestamp: 1_000, acceptance_deadline: 605_800 }; }
function accepted(): CTOProposal { return { ...proposed(), state: "accepted", accepted_at: 2_000, execute_after: 261_200, execute_deadline: 866_000 }; }
function chainProposal(state: number) {
  return { token, creator, controller, treasury, previousRecipient: previous, metadataHash, nonce: BigInt(1), createdAt: BigInt(1_000), acceptedAt: state === 2 ? BigInt(2_000) : BigInt(0), state };
}
function onchain(state: number, blockTimestamp: number) {
  return { registry, creator, currentProposalId: proposalId, proposal: chainProposal(state), currentPayout: previous, blockTimestamp, acceptanceWindow: 604_800, executionDelay: 259_200, executionGracePeriod: 604_800 };
}

function treasuryPayload(): CTOTreasury {
  return { treasury, registry, token, controller, canonical_usdc: "0x0000000000000000000000000000000000000036", nonce: "1", deployment: provenance, supported_assets: [], recent_transfers: [], recent_fee_pulls: [] };
}

function transfers(): CTOTreasuryTransferPage {
  return { items: [{ asset: "0x0000000000000000000000000000000000000036", recipient: previous, amount: "1000000000000000000", controller, provenance }] };
}

function checkpoints(): CTOCheckpointPage {
  return { token, aggregates: [{ token, recipient: previous, checkpointed: "10", claimed: "1", outstanding: "9" }], items: [{ recipient: previous, action: "checkpoint", amount: "10", provenance }] };
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  apiMocks.ctoStatus.mockResolvedValue(inactiveStatus());
  apiMocks.ctoProposals.mockResolvedValue({ items: [] });
  apiMocks.ctoCheckpoints.mockResolvedValue({ token, aggregates: [], items: [] });
  apiMocks.ctoProposal.mockResolvedValue(proposal("ipfs://untrusted"));
  apiMocks.ctoTreasury.mockResolvedValue(treasuryPayload());
  apiMocks.ctoTreasuryTransfers.mockResolvedValue({ items: [] });
  apiMocks.ctoTreasuryFeePulls.mockResolvedValue({ items: [] });
  active.value = { connected: false, canTransact: false, status: "disconnected", connectWallet: vi.fn(), switchToSelectedChain: vi.fn() };
  ctoMocks.readCTOChainState.mockResolvedValue({ registry, creator, currentProposalId: `0x${"00".repeat(32)}`, currentPayout: creator, blockTimestamp: 1_000 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TokenCTO", () => {
  it("presents an inactive CTO as a non-error empty state", async () => {
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText("No live community takeover proposal exists. Only the canonical token creator can start one.")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.queryByText("CTO status could not be loaded.")).toBeNull();
    expect(document.querySelector(".status-error")).toBeNull();
    expect(apiMocks.ctoStatus).toHaveBeenCalledWith(token);
    expect(apiMocks.ctoProposal).not.toHaveBeenCalled();
    expect(apiMocks.ctoTreasury).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("presents an active CTO from indexed GET endpoints", async () => {
    apiMocks.ctoStatus.mockResolvedValue(activeStatus());
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposal("ipfs://untrusted")] });
    apiMocks.ctoProposal.mockResolvedValue(proposal("ipfs://untrusted"));
    apiMocks.ctoTreasury.mockResolvedValue(treasuryPayload());
    apiMocks.ctoTreasuryTransfers.mockResolvedValue(transfers());
    apiMocks.ctoTreasuryFeePulls.mockResolvedValue({ items: [] });
    apiMocks.ctoCheckpoints.mockResolvedValue(checkpoints());
    ctoMocks.readCTOChainState.mockResolvedValue({ registry, creator, currentProposalId: proposalId, proposal: chainProposal(5), currentPayout: treasury, blockTimestamp: 1_000 });
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });

    expect(await screen.findByText("Active")).toBeTruthy();
    expect(screen.getByText("Community takeover active")).toBeTruthy();
    expect(screen.getByText(/handover is terminal/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: `${controller} ↗` })).toBeTruthy();
    expect(screen.getByRole("link", { name: `${treasury} ↗` })).toBeTruthy();
    expect(screen.getAllByText(proposalId).length).toBeGreaterThan(0);
    expect(await screen.findByText("18446744073709551615")).toBeTruthy();
    expect(await screen.findByText("1,000,000,000,000,000,000")).toBeTruthy();
    await waitFor(() => expect(apiMocks.ctoProposal).toHaveBeenCalledWith(proposalId));
    expect(apiMocks.ctoTreasury).toHaveBeenCalledWith(treasury);
    expect(apiMocks.ctoTreasuryTransfers).toHaveBeenCalledWith(treasury, "?limit=20");
    expect(apiMocks.ctoTreasuryFeePulls).toHaveBeenCalledWith(treasury, "?limit=20");
    expect(apiMocks.ctoCheckpoints).toHaveBeenCalledWith(token, "?limit=20");
    expect(apiMocks.ctoProposals).toHaveBeenCalledWith(token, "?limit=20");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the proposal form only to the canonical creator", async () => {
    ctoMocks.proposeCTO.mockResolvedValue(`0x${"66".repeat(32)}`);
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: creator, walletClient: {} };
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    const controllerInput = await screen.findByLabelText("Controller contract address");
    await userEvent.type(controllerInput, controller);
    await userEvent.type(screen.getByLabelText("Metadata URI"), "ipfs://cooket/cto");
    await userEvent.click(screen.getByRole("button", { name: "Start community takeover" }));
    await waitFor(() => expect(ctoMocks.proposeCTO).toHaveBeenCalledWith({}, creator, "0x00000000000000000000000000000000000000AA", controller, "ipfs://cooket/cto"));
    expect(screen.getByText(/voluntary and one-way/i)).toBeTruthy();
  });

  it("shows the exact treasury acceptance payload and never offers EOA impersonation", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockResolvedValue({ registry, creator, currentProposalId: proposalId, proposal: chainProposal(1), currentPayout: previous, blockTimestamp: 2_000 });
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: creator, walletClient: {} };
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText("Controller acceptance required")).toBeTruthy();
    expect(screen.getByText("acceptCTO(bytes32)")).toBeTruthy();
    expect(screen.getByText(/ordinary EOA cannot impersonate/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept through controller" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel proposal" })).toBeTruthy();
  });

  it("allows the exposed controller smart account to invoke the guarded acceptance helper", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockResolvedValue({ registry, creator, currentProposalId: proposalId, proposal: chainProposal(1), currentPayout: previous, blockTimestamp: 2_000 });
    ctoMocks.acceptCTOFromController.mockResolvedValue(`0x${"44".repeat(32)}`);
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: controller, walletClient: {} };
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    await userEvent.click(await screen.findByRole("button", { name: "Accept through controller" }));
    await waitFor(() => expect(ctoMocks.acceptCTOFromController).toHaveBeenCalledWith({}, controller, "0x00000000000000000000000000000000000000AA", proposalId));
    await waitFor(() => expect(apiMocks.ctoStatus.mock.calls.length).toBeGreaterThan(1));
  });

  it("refreshes the on-chain timestamp and enables permissionless execution only in the execution window", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [accepted()] });
    ctoMocks.readCTOChainState.mockResolvedValueOnce(onchain(2, 10_000)).mockResolvedValueOnce(onchain(2, 300_000));
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: previous, walletClient: {} };
    const { client } = renderWithClient();
    expect(await screen.findByText("Accepted — protocol timelock")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Execute community takeover" })).toBeNull();
    await client.invalidateQueries({ queryKey: ["cto-onchain", token] });
    expect(await screen.findByRole("button", { name: "Execute community takeover" })).toBeTruthy();
  });

  it("does not restore the creator proposal form while a confirmed proposal is indexing", async () => {
    ctoMocks.readCTOChainState.mockResolvedValue(onchain(1, 2_000));
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: creator, walletClient: {} };
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText(/Proposal confirmed on Arc Testnet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start community takeover" })).toBeNull();
    expect(screen.getByText("proposed")).toBeTruthy();
    expect(screen.getByText("Indexing in progress")).toBeTruthy();
  });

  it("uses accepted on-chain state over a stale indexed proposed proposal", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockResolvedValue(onchain(2, 10_000));
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText("Accepted — protocol timelock")).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.queryByText("Controller acceptance required")).toBeNull();
  });

  it("removes execute controls when on-chain activation precedes indexing", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [accepted()] });
    ctoMocks.readCTOChainState.mockResolvedValue(onchain(5, 400_000));
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText("Community takeover active on Arc Testnet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Execute community takeover" })).toBeNull();
  });

  it.each([[3, "cancelled"], [4, "expired"]] as const)("removes stale proposal controls when on-chain state is %s", async (state, label) => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockResolvedValue(onchain(state, 700_000));
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel proposal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept through controller" })).toBeNull();
  });

  it("refreshes a proposed proposal into an expirable state without a page reload", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockResolvedValueOnce(onchain(1, 2_000)).mockResolvedValueOnce(onchain(1, 700_000));
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: previous, walletClient: {} };
    const { client } = renderWithClient();
    expect(await screen.findByText("Controller acceptance required")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark expired" })).toBeNull();
    await client.invalidateQueries({ queryKey: ["cto-onchain", token] });
    expect(await screen.findByRole("button", { name: "Mark expired" })).toBeTruthy();
  });

  it("fails closed for writes when the fresh on-chain state cannot be read", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockRejectedValue(new Error("RPC unavailable"));
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: creator, walletClient: {} };
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText(/Fresh on-chain CTO state could not be verified/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start community takeover" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel proposal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execute community takeover" })).toBeNull();
  });

  it("offers permissionless expiry only after the on-chain deadline", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockResolvedValue({ registry, creator, currentProposalId: proposalId, proposal: chainProposal(1), currentPayout: previous, blockTimestamp: 700_000 });
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: previous, walletClient: {} };
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByRole("button", { name: "Mark expired" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel proposal" })).toBeNull();
  });

  it("surfaces wallet rejection without reporting confirmation", async () => {
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposed()] });
    ctoMocks.readCTOChainState.mockResolvedValue({ registry, creator, currentProposalId: proposalId, proposal: chainProposal(1), currentPayout: previous, blockTimestamp: 2_000 });
    ctoMocks.cancelCTO.mockRejectedValue(new Error("User rejected the request"));
    active.value = { ...active.value, connected: true, canTransact: true, status: "wallet_ready", activeAddress: creator, walletClient: {} };
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    await userEvent.click(await screen.findByRole("button", { name: "Cancel proposal" }));
    expect(await screen.findByText("The wallet request was rejected.")).toBeTruthy();
    expect(screen.queryByText(/Transaction confirmed/)).toBeNull();
  });

  it("displays untrusted metadata URIs as inert text and never fetches or renders them as HTML", async () => {
    const malicious = '<img src="https://evil.example/cto.json" onerror="alert(1)">javascript:alert(1)';
    apiMocks.ctoStatus.mockResolvedValue(activeStatus());
    apiMocks.ctoProposals.mockResolvedValue({ items: [proposal(malicious)] });
    apiMocks.ctoProposal.mockResolvedValue(proposal(malicious));
    apiMocks.ctoTreasury.mockResolvedValue(treasuryPayload());
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });

    const nodes = await screen.findAllByTestId("cto-metadata-uri");
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.textContent).toBe(malicious);
      expect(node.querySelector("img")).toBeNull();
      expect(node.querySelector("a")).toBeNull();
    }
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link", { name: malicious })).toBeNull();
    expect(document.querySelector('a[href="javascript:alert(1)"]')).toBeNull();
    expect(document.querySelector('img[src="https://evil.example/cto.json"]')).toBeNull();
    expect(document.documentElement.innerHTML).not.toContain('<img src="https://evil.example/cto.json"');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes("evil.example"))).toBe(false);
  });

  it("uses guarded transaction helpers and never exposes an arbitrary call surface", () => {
    expect(CTO_CHAIN_REFRESH_MS).toBe(20_000);
    expect(source).toContain("api.ctoStatus");
    expect(source).toContain("api.ctoProposals");
    expect(source).toContain("api.ctoCheckpoints");
    expect(source).toContain("api.ctoProposal");
    expect(source).toContain("api.ctoTreasury");
    expect(source).toContain("api.ctoTreasuryTransfers");
    expect(source).toContain("api.ctoTreasuryFeePulls");
    expect(source).toContain("useActiveWallet");
    expect(source).toContain("proposeCTO");
    expect(source).toContain("acceptCTOFromController");
    expect(source).toContain("refetchInterval");
    expect(source).not.toMatch(/eth_sendRawTransaction|signMessage|dangerouslySetInnerHTML/);
  });
});
