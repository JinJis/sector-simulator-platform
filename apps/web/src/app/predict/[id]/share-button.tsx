"use client";

/**
 * Permalink share button. Copies the current full URL to the clipboard
 * and flashes "복사됨" for 1.5s. Keeps the page server-rendered;
 * isolated to its own client island so we don't ship the whole
 * permalink page's prose through hydration.
 */

import { useState } from "react";

export function SharePermalinkButton({ predictionId }: { predictionId: string }) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    // Resolve URL at click time so SSR / hydration boundaries don't
    // need to know about window.location.
    const url =
      typeof window !== "undefined"
        ? window.location.href
        : `/predict/${predictionId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failed (older browsers, http context, etc.) —
      // fall back to a textbox prompt so users can copy manually.
      window.prompt("이 링크를 복사해서 공유하세요:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={onShare}
      className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500 hover:text-neutral-50"
      aria-live="polite"
    >
      {copied ? "✓ 링크 복사됨" : "🔗 공유 링크 복사"}
    </button>
  );
}
