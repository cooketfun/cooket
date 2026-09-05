"use client";

import { useState } from "react";
import { apiAssetURL } from "@/lib/api";
import { formatTokenSymbol } from "@/lib/format";

// Official Circle USDC Token Logo, vendored unaltered from Circle's Pressroom brand kit
// (https://www.circle.com/pressroom, "Download USDC logos"):
// https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/Pressroom/brandkit/logo-downloads/usdc.zip
// Archive path: Token Logo/USDC Token.svg
export const USDC_TOKEN_LOGO_SRC = "/brand/usdc-token.svg";

export function TradeAssetIdentity({ kind, symbol, imageURL }: { kind: "usdc" | "token"; symbol?: string; imageURL?: string }) {
  const label = kind === "usdc" ? "USDC" : formatTokenSymbol(symbol);
  const tokenImage = kind === "token" && imageURL ? apiAssetURL(imageURL) : undefined;
  return <span className="inline-flex min-w-0 items-center gap-2" data-testid={`trade-asset-${kind}`}>
    {kind === "usdc" ? <AssetImage className="h-6 w-6 flex-none rounded-full" src={USDC_TOKEN_LOGO_SRC} /> : tokenImage ? <TokenImage key={tokenImage} src={tokenImage} /> : null}
    <span className="truncate font-medium text-zinc-200">{label}</span>
  </span>;
}

// Next Image requires a build-time remote host allowlist. Token image URLs are
// validated runtime API assets and can be external, so this narrow native-image
// boundary preserves safe fallback behavior without expanding image domains.
/* eslint-disable @next/next/no-img-element */
function AssetImage({ src, className, onError }: { src: string; className: string; onError?: () => void }) {
  return <img className={className} src={src} alt="" onError={onError} />;
}

function TokenImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <AssetImage className="h-6 w-6 flex-none rounded-full border border-white/10 object-cover" src={src} onError={() => setFailed(true)} />;
}
/* eslint-enable @next/next/no-img-element */
