import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, ...apiMocks } };
});

import { TokenCTO } from "./token-cto";

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

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TokenCTO", () => {
  it("presents an inactive CTO as a non-error empty state", async () => {
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });
    expect(await screen.findByText("No community takeover is active for this token.")).toBeTruthy();
    expect(screen.getByText("Not active")).toBeTruthy();
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
    render(<TokenCTO tokenAddress={token} />, { wrapper: Providers });

    expect(await screen.findByText("Active")).toBeTruthy();
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

  it("does not initiate transaction or signature logic", () => {
    expect(source).toContain("api.ctoStatus");
    expect(source).toContain("api.ctoProposals");
    expect(source).toContain("api.ctoCheckpoints");
    expect(source).toContain("api.ctoProposal");
    expect(source).toContain("api.ctoTreasury");
    expect(source).toContain("api.ctoTreasuryTransfers");
    expect(source).toContain("api.ctoTreasuryFeePulls");
    expect(source).not.toMatch(/eth_sendRawTransaction|signMessage|writeContract|sendTransaction|walletClient/);
    expect(source).not.toContain("useActiveWallet");
    expect(source).not.toContain("assertArcProtocolEconomicsReady");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
