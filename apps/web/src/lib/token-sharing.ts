import type { Metadata } from "next";
import { api } from "@/lib/api";

export const COOKET_ORIGIN = "https://cooket.fun";
const PUBLIC_API_ORIGIN = "https://api.cooket.fun";
const LOGO_FALLBACK = "/brand/cooket.png";

export function canonicalTokenURL(address: string) {
  return `${COOKET_ORIGIN}/token/${encodeURIComponent(address)}`;
}

/** Returns an absolute, HTTPS URL that a social crawler can fetch. */
export function tokenSocialImageURL(imageURL: string | undefined): string | undefined {
  if (!imageURL?.trim()) return undefined;
  try {
    const image = new URL(imageURL, PUBLIC_API_ORIGIN);
    return image.protocol === "https:" ? image.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function fallbackTokenImageURL(address: string) {
  return new URL(`/api/tokens/${encodeURIComponent(address)}/og-image`, COOKET_ORIGIN).toString();
}

export function tokenMetadata(token: { address: string; name: string; symbol: string; description?: string; image_url?: string }): Metadata {
  const url = canonicalTokenURL(token.address);
  const title = `${token.name} (${token.symbol}) | Cooket`;
  const description = token.description?.trim() || `${token.name} (${token.symbol}) is a token on Cooket.`;
  const image = tokenSocialImageURL(token.image_url) || fallbackTokenImageURL(token.address);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: [{ url: image, alt: `${token.name} (${token.symbol})` }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export async function fetchTokenMetadata(address: string) {
  try {
    return tokenMetadata(await api.token(address));
  } catch {
    const url = canonicalTokenURL(address);
    const image = fallbackTokenImageURL(address);
    return {
      title: "Cooket token",
      description: "View this token on Cooket.",
      alternates: { canonical: url },
      openGraph: { url, type: "website", images: [{ url: image, alt: "Cooket token" }] },
      twitter: { card: "summary_large_image", images: [image] },
    } satisfies Metadata;
  }
}

export const fallbackLogoPath = LOGO_FALLBACK;
