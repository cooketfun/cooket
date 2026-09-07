import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { fallbackLogoPath, tokenSocialImageURL } from "@/lib/token-sharing";

/**
 * A crawler-safe fallback used only when indexed token metadata has no usable
 * HTTPS image. Token images themselves are linked directly in page metadata.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  try {
    const token = await api.token(address);
    if (tokenSocialImageURL(token.image_url)) return new NextResponse(null, { status: 404 });
  } catch { /* Unavailable token metadata also requires the branded fallback. */ }
  const image = await readFile(resolve(process.cwd(), "public", fallbackLogoPath.slice(1)));
  return new NextResponse(new Uint8Array(image), {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Type": "image/png",
    },
  });
}
