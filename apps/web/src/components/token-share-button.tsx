"use client";

import { useState } from "react";

type TokenShareButtonProps = { url: string; title: string; description: string };

export function TokenShareButton({ url, title, description }: TokenShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: description, url });
      } catch { /* A dismissed native share sheet is not a clipboard request. */ }
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return <button type="button" className="button-secondary min-h-10 px-3 text-sm" onClick={() => void share()} aria-live="polite">{copied ? "Link copied" : "Share"}</button>;
}
