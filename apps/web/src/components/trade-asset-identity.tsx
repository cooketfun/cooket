"use client";

import { useEffect, useState } from "react";
import { apiAssetURL } from "@/lib/api";
import { formatTokenSymbol } from "@/lib/format";

// Official Circle USDC Token Logo, vendored unaltered from Circle's Pressroom brand kit
// (https://www.circle.com/pressroom, "Download USDC logos"):
// https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/Pressroom/brandkit/logo-downloads/usdc.zip
// Archive path: Token Logo/USDC Token.svg
export const USDC_TOKEN_LOGO_SRC = "/brand/usdc-token.svg";

export function TradeAssetIdentity({ kind, symbol, imageURL }: { kind: "usdc" | "token"; symbol?: string; imageURL?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [imageURL]);
  const label = kind === "usdc" ? "USDC" : formatTokenSymbol(symbol);
  const tokenImage = kind === "token" && imageURL && !imageFailed ? apiAssetURL(imageURL) : undefined;
  return <span className="inline-flex min-w-0 items-center gap-2" data-testid={`trade-asset-${kind}`}>
    {kind === "usdc" ? <img className="h-6 w-6 flex-none rounded-full" src={USDC_TOKEN_LOGO_SRC} alt="" /> : tokenImage ? <img className="h-6 w-6 flex-none rounded-full border border-white/10 object-cover" src={tokenImage} alt="" onError={() => setImageFailed(true)} /> : null}
    <span className="truncate font-medium text-zinc-200">{label}</span>
  </span>;
}
