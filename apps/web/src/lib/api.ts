import type { ActivityPage, ApiError, ChartPage, CreatorProfile, CTOCheckpointPage, CTOFeePullPage, CTOProposal, CTOProposalPage, CTOStatus, CTOTreasury, CTOTreasuryTransferPage, Pricing, Token, TokenPage, TradePage } from "@cooket/types";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const transactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const integerStringSchema = z.string().regex(/^\d+$/);
const blockRefSchema = z.object({ block_number: z.number().int().nonnegative(), block_timestamp: z.number().int().nonnegative().optional(), transaction_hash: transactionHashSchema, log_index: z.number().int().nonnegative() });
const indexedProvenanceSchema = z.object({ block_number: z.number().int().nonnegative(), block_hash: transactionHashSchema, transaction_hash: transactionHashSchema, log_index: z.number().int().nonnegative() });
const graduationSchema = z.object({
  phase: z.string(),
  canonical_pool_address: addressSchema.optional(),
  graduation_manager_address: addressSchema.optional(),
  lp_custodian_address: addressSchema.optional(),
  position_token_id: integerStringSchema.optional(),
  liquidity: integerStringSchema.optional(),
  token_amount: integerStringSchema.optional(),
  native_usdc_amount: integerStringSchema.optional(),
  sold_supply: integerStringSchema.optional(),
  curve_terminal_at: blockRefSchema.optional(),
  settled_at: blockRefSchema.optional(),
}).passthrough();
const ctoStatusSchema = z.object({
  chain_id: z.number().int(),
  token: addressSchema,
  active: z.boolean(),
  registry: addressSchema.optional(),
  treasury: addressSchema.optional(),
  controller: addressSchema.optional(),
  previous_recipient: addressSchema.optional(),
  active_proposal_id: transactionHashSchema.optional(),
  activation: indexedProvenanceSchema.optional(),
});
const ctoProposalSchema = z.object({
  proposal_id: transactionHashSchema,
  token: addressSchema,
  registry: addressSchema,
  treasury: addressSchema,
  creator: addressSchema,
  controller: addressSchema,
  previous_recipient: addressSchema,
  nonce: integerStringSchema,
  metadata_hash: transactionHashSchema,
  metadata_uri: z.string(),
  state: z.string(),
  created_timestamp: z.number().int(),
  created: indexedProvenanceSchema,
  acceptance_deadline: z.number().int(),
  accepted_at: z.number().int().optional(),
  accepted: indexedProvenanceSchema.optional(),
  execute_after: z.number().int().optional(),
  execute_deadline: z.number().int().optional(),
  ready: indexedProvenanceSchema.optional(),
  cancelled_at: z.number().int().optional(),
  cancelled: indexedProvenanceSchema.optional(),
  expired_at: z.number().int().optional(),
  expired: indexedProvenanceSchema.optional(),
  activated_at: z.number().int().optional(),
  activated: indexedProvenanceSchema.optional(),
});
const ctoProposalPageSchema = z.object({ items: z.array(ctoProposalSchema), next_cursor: z.string().optional() });
const ctoSupportedAssetSchema = z.object({ asset: addressSchema, controller: addressSchema, registered: indexedProvenanceSchema });
const ctoTreasuryTransferSchema = z.object({ asset: addressSchema, recipient: addressSchema, amount: integerStringSchema, controller: addressSchema, provenance: indexedProvenanceSchema });
const ctoFeePullSchema = z.object({ token: addressSchema, asset: addressSchema, amount: integerStringSchema, triggered_by: addressSchema, provenance: indexedProvenanceSchema });
const ctoTreasurySchema = z.object({
  treasury: addressSchema,
  registry: addressSchema,
  token: addressSchema,
  controller: addressSchema,
  canonical_usdc: addressSchema.optional(),
  nonce: integerStringSchema,
  deployment: indexedProvenanceSchema,
  supported_assets: z.array(ctoSupportedAssetSchema),
  recent_transfers: z.array(ctoTreasuryTransferSchema),
  transfers_next_cursor: z.string().optional(),
  recent_fee_pulls: z.array(ctoFeePullSchema),
  fee_pulls_next_cursor: z.string().optional(),
});
const ctoTreasuryTransferPageSchema = z.object({ items: z.array(ctoTreasuryTransferSchema), next_cursor: z.string().optional() });
const ctoFeePullPageSchema = z.object({ items: z.array(ctoFeePullSchema), next_cursor: z.string().optional() });
const ctoCheckpointPageSchema = z.object({
  token: addressSchema,
  aggregates: z.array(z.object({ token: addressSchema, recipient: addressSchema, checkpointed: integerStringSchema, claimed: integerStringSchema, outstanding: integerStringSchema })),
  items: z.array(z.object({ recipient: addressSchema, action: z.string(), amount: integerStringSchema, triggered_by: addressSchema.optional(), provenance: indexedProvenanceSchema })),
  next_cursor: z.string().optional(),
});
const tokenSchema = z.object({ indexed_through_block: z.number().int().nonnegative().optional(), address: z.string(), creator: z.string(), name: z.string(), symbol: z.string(), initial_supply: z.string(), description: z.string().optional(), image_url: z.string().optional(), metadata_url: z.string().optional(), website_url: z.url().optional(), x_url: z.url().optional(), telegram_url: z.url().optional(), discord_url: z.url().optional(), created_at: blockRefSchema, metrics: z.object({ trade_count: z.number(), buy_count: z.number(), sell_count: z.number(), volume: z.string(), fees: z.string(), unique_trader_count: z.number(), latest_trade_timestamp: z.number().nullable(), current_price: z.string().nullable(), fully_diluted_value: z.string().nullable(), holder_count: z.number().nullable() }), curve: z.object({ address: z.string(), canonical_pool_address: addressSchema.optional(), sold_supply: z.string(), reserve_balance: z.string() }).passthrough().optional(), graduation: graduationSchema.optional() });
const tokenPageSchema = z.object({ items: z.array(tokenSchema), next_cursor: z.string().optional() });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const serviceSchema = z.object({ status: z.string(), service: z.string(), request_id: z.string().optional() });

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export function resolvePublicApiURL(value: string | undefined, production = process.env.VERCEL_ENV === "production"): string {
  const configured = value?.trim() || (production ? "" : "http://localhost:4200");
  if (!configured) throw new Error("NEXT_PUBLIC_API_URL is required for a production Cooket frontend build.");
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw new Error("NEXT_PUBLIC_API_URL must be an absolute http(s) URL."); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("NEXT_PUBLIC_API_URL must use http or https.");
  if (production && parsed.origin !== "https://api.cooket.fun") throw new Error("Production Cooket frontend builds require NEXT_PUBLIC_API_URL=https://api.cooket.fun.");
  return parsed.origin;
}
const publicApiUrl = resolvePublicApiURL(process.env.NEXT_PUBLIC_API_URL);
const internalApiUrl = process.env.INTERNAL_API_URL?.replace(/\/$/, "");
const baseUrl = (typeof window === "undefined" && internalApiUrl ? internalApiUrl : publicApiUrl);

async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try { response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" }, next: { revalidate: 10 } }); }
  catch { throw new ApiClientError(0, "network_error", "The API could not be reached."); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new ApiClientError(response.status, parsed.success ? parsed.data.error.code : "http_error", parsed.success ? parsed.data.error.message : "The API request failed.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiClientError(500, "invalid_response", "The API returned an invalid response.");
  return parsed.data;
}
async function mutation<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try { response = await fetch(`${publicApiUrl}${path}`, init); } catch { throw new ApiClientError(0,"network_error","The API could not be reached."); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) { const parsed=errorSchema.safeParse(body); throw new ApiClientError(response.status,parsed.success?parsed.data.error.code:"http_error",parsed.success?parsed.data.error.message:"The API request failed."); }
  const parsed=schema.safeParse(body); if(!parsed.success) throw new ApiClientError(500,"invalid_response","The API returned an invalid response."); return parsed.data;
}
const draftSchema=z.object({draft_id:z.string(),name:z.string(),symbol:z.string(),initial_supply:z.string(),description:z.string(),image_url:z.string(),metadata_url:z.string(),website_url:z.url().optional(),x_url:z.url().optional(),telegram_url:z.url().optional(),discord_url:z.url().optional()});
export const apiAssetURL=(path:string|undefined)=>path?.startsWith("/")?`${publicApiUrl}${path}`:path;

export const api = {
  health: () => request<{ status: string; service: string; request_id?: string }>("/health", serviceSchema),
  ready: () => request<{ status: string; service: string; request_id?: string }>("/readyz", serviceSchema),
  listTokens: (query = "") => request<TokenPage>(`/api/v1/tokens${query}`, tokenPageSchema),
  trending: (query = "") => request<TokenPage>(`/api/v1/trending${query}`, tokenPageSchema),
  token: (address: string) => request<Token>(`/api/v1/tokens/${encodeURIComponent(address)}`, tokenSchema),
  creator: (address: string, query = "") => request<CreatorProfile>(`/api/v1/creators/${encodeURIComponent(address)}${query}`, z.object({ address: z.string(), token_count: z.number(), volume: z.string(), tokens: z.array(tokenSchema), next_cursor: z.string().optional() })),
  trades: (address: string, query = "") => request<TradePage>(`/api/v1/tokens/${encodeURIComponent(address)}/trades${query}`, z.object({ indexed_through_block: z.number().int().nonnegative().optional(), items: z.array(z.object({ block_timestamp: z.number().int().nonnegative().optional(), token_address: z.string(), trader: z.string(), side: z.string(), token_amount: z.string(), reserve_amount: z.string(), curve_value: z.string(), protocol_fee: z.string(), creator_fee: z.string(), source: z.enum(["curve", "uniswap_v3"]), block_number: z.number(), transaction_index: z.number(), transaction_hash: z.string(), log_index: z.number() })), next_cursor: z.string().optional() })),
  activity: (address: string, query = "") => request<ActivityPage>(`/api/v1/tokens/${encodeURIComponent(address)}/activity${query}`, z.object({ items: z.array(z.object({ event_name: z.string(), decoded: z.record(z.string(), z.unknown()), block_number: z.number(), transaction_index: z.number(), transaction_hash: z.string(), log_index: z.number() })), next_cursor: z.string().optional() })),
  pricing: (address: string) => request<Pricing>(`/api/v1/tokens/${encodeURIComponent(address)}/pricing`, z.object({ token_address: z.string(), current_price: z.string().nullable(), fully_diluted_value: z.string().nullable(), source: z.enum(["indexed_v3_curve", "indexed_v3_market"]) })),
  chart: (address: string, query = "") => request<ChartPage>(`/api/v1/tokens/${encodeURIComponent(address)}/chart${query}`, z.object({ indexed_through_block: z.number().int().nonnegative().optional(), interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]), supported_intervals: z.array(z.enum(["1m", "5m", "15m", "1h", "4h", "1d", "1w"])), candles: z.array(z.object({ bucket_start: z.number(), trade_count: z.number(), buy_count: z.number(), sell_count: z.number(), volume: z.string(), unique_trader_count: z.number(), open_price: z.string().nullable(), high_price: z.string().nullable(), low_price: z.string().nullable(), close_price: z.string().nullable() })) })),
  uploadMetadata: (form: FormData) => mutation("/api/v1/token-metadata",{method:"POST",body:form},draftSchema),
  finalizeMetadata: (draft:string,tokenAddress:string,transactionHash:string) => mutation(`/api/v1/token-metadata/${encodeURIComponent(draft)}/finalize`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token_address:tokenAddress,transaction_hash:transactionHash})},tokenSchema),
  ctoStatus: (address: string) => request<CTOStatus>(`/api/v1/tokens/${encodeURIComponent(address)}/cto`, ctoStatusSchema),
  ctoProposals: (address: string, query = "") => request<CTOProposalPage>(`/api/v1/tokens/${encodeURIComponent(address)}/cto/proposals${query}`, ctoProposalPageSchema),
  ctoCheckpoints: (address: string, query = "") => request<CTOCheckpointPage>(`/api/v1/tokens/${encodeURIComponent(address)}/cto/checkpoints${query}`, ctoCheckpointPageSchema),
  ctoProposal: (proposalId: string) => request<CTOProposal>(`/api/v1/cto/proposals/${encodeURIComponent(proposalId)}`, ctoProposalSchema),
  ctoTreasury: (treasury: string) => request<CTOTreasury>(`/api/v1/cto/treasuries/${encodeURIComponent(treasury)}`, ctoTreasurySchema),
  ctoTreasuryTransfers: (treasury: string, query = "") => request<CTOTreasuryTransferPage>(`/api/v1/cto/treasuries/${encodeURIComponent(treasury)}/transfers${query}`, ctoTreasuryTransferPageSchema),
  ctoTreasuryFeePulls: (treasury: string, query = "") => request<CTOFeePullPage>(`/api/v1/cto/treasuries/${encodeURIComponent(treasury)}/fee-pulls${query}`, ctoFeePullPageSchema),
};

export type { ActivityPage, ApiError, ChartPage, CreatorProfile, CTOCheckpointPage, CTOFeePullPage, CTOProposal, CTOProposalPage, CTOStatus, CTOTreasury, CTOTreasuryTransferPage, Pricing, Token, TokenPage, TradePage };
