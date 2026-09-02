import type { Token } from "@cooket/types";
import { formatNative, formatTokenAmount, graduationProgress } from "@/lib/format";
import { explorerAddressURL, explorerTransactionURL } from "@/lib/chain";

export function isGraduatedToken(token: Token) {
  return token.graduation?.phase.toLowerCase() === "graduated";
}

export function hasIndexedSettlement(token: Token) {
  const graduation = token.graduation;
  return Boolean(
    graduation?.lp_custodian_address
    && graduation.position_token_id
    && graduation.liquidity
    && graduation.settled_at,
  );
}

export function TokenGraduation({ token }: { token: Token }) {
  if (!isGraduatedToken(token)) return <ActiveGraduation token={token} />;

  const graduation = token.graduation!;
  const canonicalPool = graduation.canonical_pool_address || token.curve?.canonical_pool_address;
  const hasSettlement = hasIndexedSettlement(token);

  return <section className="terminal-panel overflow-hidden" aria-label="Graduated token external liquidity">
    <div className="border-b border-violet-300/15 bg-gradient-to-br from-violet-400/10 via-cyan-300/[0.04] to-transparent p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow text-violet-300">Bonding curve complete</p><h2 className="mt-1 text-lg font-semibold text-white">Graduated</h2></div>
        <span className={hasSettlement ? "badge-success" : "badge-warning"}>{hasSettlement ? "External liquidity active" : "Settlement indexing pending"}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">Indexed 18-decimal native USDC graduation. External swap execution remains deferred.</p>
    </div>

    <div className="p-4">
      {(graduation.token_amount || graduation.native_usdc_amount) && <dl className="grid grid-cols-2 gap-2">
        <GraduationStat label="Token liquidity" value={formatTokenAmount(graduation.token_amount, 18, token.symbol)} />
        <GraduationStat label="Native USDC" value={formatNative(graduation.native_usdc_amount)} title={graduation.native_usdc_amount} />
      </dl>}

      {hasSettlement ? <>
        <dl className="mt-4 grid gap-3 border-t border-white/8 pt-4 text-sm">
          <GraduationDetail label="LP custody" value="Permanent" />
          {canonicalPool && <GraduationDetail label="Canonical V3 pool" value={canonicalPool} href={explorerAddressURL(canonicalPool)} />}
          <GraduationDetail label="LP custodian" value={graduation.lp_custodian_address!} href={explorerAddressURL(graduation.lp_custodian_address!)} />
          <GraduationDetail label="Position NFT" value={`#${graduation.position_token_id}`} />
          <GraduationDetail label="V3 liquidity" value={formatExactInteger(graduation.liquidity!)} />
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {graduation.curve_terminal_at && <ExplorerLink href={explorerTransactionURL(graduation.curve_terminal_at.transaction_hash)} label="Graduation transaction" />}
          {graduation.settled_at && <ExplorerLink href={explorerTransactionURL(graduation.settled_at.transaction_hash)} label="Settlement transaction" />}
        </div>
      </> : <div className="status-box status-warning mt-4 text-sm leading-6">External settlement details are not indexed yet.</div>}

      {!hasSettlement && graduation.curve_terminal_at && <div className="mt-3"><ExplorerLink href={explorerTransactionURL(graduation.curve_terminal_at.transaction_hash)} label="Graduation transaction" /></div>}
      {!hasSettlement && canonicalPool && <div className="mt-3 text-sm"><GraduationDetail label="Canonical V3 pool" value={canonicalPool} href={explorerAddressURL(canonicalPool)} /></div>}
    </div>
  </section>;
}

function ActiveGraduation({ token }: { token: Token }) {
  const progress = graduationProgress(token.curve?.sold_supply, token.curve?.graduation_threshold);
  return <section className="terminal-panel p-4" aria-label="Active bonding curve graduation progress">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-white">Graduation progress</h2><span className={progress === 100 ? "badge-violet" : "badge-neutral"}>{progress === null ? "Unavailable" : `${progress.toFixed(2)}%`}</span></div>
    {progress === null ? <p className="mt-4 text-sm leading-6 text-zinc-500">The current API has not indexed a graduation threshold for this token.</p> : <>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/6"><div className="h-full rounded-full bg-violet-400" style={{ width: `${progress}%` }} /></div>
      <div className="mt-3 flex justify-between gap-4 text-xs text-zinc-600"><span>Sold {formatTokenAmount(token.curve?.sold_supply, 18)}</span><span>Target {formatTokenAmount(token.curve?.graduation_threshold, 18)}</span></div>
    </>}
  </section>;
}

function GraduationStat({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div className="rounded-xl border border-white/8 bg-black/20 p-3"><dt className="text-[0.68rem] text-zinc-600">{label}</dt><dd className="mt-1 text-sm font-semibold text-zinc-100" title={title ?? value}>{value}</dd></div>;
}

function GraduationDetail({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="grid min-w-0 gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]"><dt className="text-zinc-600">{label}</dt><dd className="address min-w-0 break-all text-zinc-200">{href ? <a className="text-cyan-300 hover:text-cyan-200" href={href} target="_blank" rel="noreferrer">{value} ↗</a> : value}</dd></div>;
}

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return <a className="button-secondary min-h-9 px-3 text-xs" href={href} target="_blank" rel="noreferrer">{label} ↗</a>;
}

function formatExactInteger(value: string) {
  try { return BigInt(value).toLocaleString("en-US"); }
  catch { return "Unavailable"; }
}
