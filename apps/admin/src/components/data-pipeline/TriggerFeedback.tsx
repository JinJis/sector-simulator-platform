/**
 * Shared OK / error banner used below the HelloWorld + Capability
 * triggers. The raw tRPC error string format is
 *   `<callerName> failed: crawler 503: {"detail":"…long text…"}`
 * so we extract the embedded JSON detail when present and present it
 * as a readable multi-line panel instead of a one-line wall of text.
 */

export function parseTriggerError(raw: string): {
  short: string;
  detail: string | null;
} {
  // Trim the wrapping `runHelloWorldFetcher(…) failed: ` if present.
  const failedAt = raw.indexOf("failed: ");
  const body = failedAt >= 0 ? raw.slice(failedAt + "failed: ".length) : raw;

  // Look for a JSON object that has a `detail` field.
  const braceStart = body.indexOf("{");
  if (braceStart >= 0) {
    try {
      const parsed = JSON.parse(body.slice(braceStart));
      const detail = (parsed as { detail?: unknown }).detail;
      if (typeof detail === "string" && detail.length > 0) {
        return { short: body.slice(0, braceStart).trim().replace(/:$/, "").trim(), detail };
      }
    } catch {
      // fall through to raw
    }
  }
  return { short: body.trim(), detail: null };
}

export function TriggerOk({ text }: { text: string }) {
  return (
    <div className="mt-2 rounded border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-200">
      {text}
    </div>
  );
}

/**
 * Inline hint shown next to the "Running…" button while a long-
 * running LLM trigger is in flight. Grounded gemini calls land in
 * 10-40s (DEEP digest can hit 60s) — without this hint operators
 * watch a frozen button and assume failure.
 */
export function TriggerPendingHint({ kind = "fetcher" }: { kind?: "fetcher" | "digest" }) {
  const expected = kind === "digest" ? "30-60s" : "10-40s";
  return (
    <span className="text-[10px] text-neutral-500">
      typically {expected} · the run also lands in the Live jobs
      table below
    </span>
  );
}

export function TriggerError({ raw }: { raw: string }) {
  const { short, detail } = parseTriggerError(raw);
  return (
    <div className="mt-2 rounded border border-rose-800/60 bg-rose-950/30 px-3 py-2">
      <div className="text-[11px] font-medium text-rose-200">{short}</div>
      {detail ? (
        <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-rose-100/80">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
