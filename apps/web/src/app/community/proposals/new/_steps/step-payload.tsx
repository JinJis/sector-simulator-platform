"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  draftProposalPayload,
  type ProposalTargetKind,
} from "@/lib/community-proposal-client";
import { useT } from "@/lib/i18n/provider";

// Kinds the AI drafter can fill. `edit` and `other` are intentionally
// excluded — those are free-form text proposals against existing rows;
// nothing to auto-fill.
const DRAFTABLE_KINDS = new Set<ProposalTargetKind>([
  "add_capability",
  "add_risk",
  "add_actor",
  "add_driver",
  "add_equity",
  "add_signal_source",
]);

export function StepPayload({
  targetKind,
  sectorSlug,
  title,
  body,
  payload,
  onChange,
}: {
  targetKind: ProposalTargetKind;
  sectorSlug: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const t = useT();

  if (!DRAFTABLE_KINDS.has(targetKind)) {
    return (
      <div className="space-y-4">
        <header>
          <h2 className="text-lg font-semibold text-neutral-100">
            {t("proposal.payload.heading")}
          </h2>
          <p className="mt-1 text-[12px] text-neutral-500">
            {t("proposal.payload.editOtherHint")}
          </p>
        </header>
      </div>
    );
  }

  return (
    <DraftablePayload
      targetKind={targetKind}
      sectorSlug={sectorSlug}
      title={title}
      body={body}
      payload={payload}
      onChange={onChange}
    />
  );
}

function DraftablePayload({
  targetKind,
  sectorSlug,
  title,
  body,
  payload,
  onChange,
}: {
  targetKind: ProposalTargetKind;
  sectorSlug: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  // Captures the (kind|title|body) hash we last drafted against. Used to
  // auto-fire a draft on mount and after relevant edits, but to skip the
  // call when nothing material changed (e.g., the user navigated back to
  // step 4 without touching step 3).
  const lastDraftKey = useRef<string | null>(null);

  const runDraft = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await draftProposalPayload({
        target_kind: targetKind as
          | "add_capability"
          | "add_risk"
          | "add_actor"
          | "add_driver"
          | "add_equity"
          | "add_signal_source",
        sector_slug: sectorSlug,
        title,
        body,
      });
      onChange(out.payload);
      setCostUsd(out.cost_usd);
      lastDraftKey.current = `${targetKind}|${title}|${body}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [targetKind, sectorSlug, title, body, onChange]);

  // Auto-draft on mount and whenever the kind/title/body changes. We
  // skip if the payload is already filled against the current inputs
  // (cached key match) — that way navigating back to step 4 doesn't
  // burn another LLM call.
  useEffect(() => {
    const key = `${targetKind}|${title}|${body}`;
    if (lastDraftKey.current === key) return;
    void runDraft();
    // intentionally omit runDraft from deps; runDraft's identity changes
    // every render due to onChange in scope, which would cause a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKind, title, body]);

  const hasPayload = Object.keys(payload).length > 0;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          {t("proposal.payload.heading")}
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          {t("proposal.payload.subheading")}
        </p>
      </header>

      {loading && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="flex items-center gap-2 text-[12px] text-neutral-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
            {t("proposal.payload.loading")}
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-[12px] text-rose-300">
          <p>{t("proposal.payload.draftFailed")}</p>
          <p className="mt-1 font-mono text-[10px] text-rose-400/80">{error}</p>
        </div>
      )}

      {!loading && hasPayload && (
        <PayloadCard payload={payload} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] text-neutral-600">
          {costUsd !== null && (
            <>
              {t("proposal.payload.draftCost")}{" "}
              <span className="font-mono text-neutral-400">
                ${costUsd.toFixed(4)}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runDraft()}
          disabled={loading}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-300 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("proposal.payload.regenerate")}
        </button>
      </div>

      <details className="text-[12px] text-neutral-500">
        <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">
          {t("proposal.payload.editManually")}
        </summary>
        <div className="mt-3">
          <ManualJsonEditor payload={payload} onChange={onChange} />
        </div>
      </details>
    </div>
  );
}

// Render the auto-drafted payload as a read-only card. Skips the JSON
// noise (objects/arrays beyond strings are shown as JSON; primitives
// inline with their key).
function PayloadCard({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload);
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {k}
            </span>
            <span className="mt-0.5 break-words text-[13px] text-neutral-100">
              {renderValue(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v.length === 0 ? "—" : v.map((x) => String(x)).join(", ");
  }
  return JSON.stringify(v);
}

// Escape hatch — if the user wants to tweak something specific the
// drafter got wrong, they can edit the raw JSON. Loose validation:
// invalid JSON keeps the existing payload + flashes a warning.
function ManualJsonEditor({
  payload,
  onChange,
}: {
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(payload, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  // Re-sync when the auto-draft updates the payload.
  useEffect(() => {
    setText(JSON.stringify(payload, null, 2));
  }, [payload]);

  function handleChange(next: string) {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        onChange(parsed as Record<string, unknown>);
        setParseError(null);
      } else {
        setParseError("JSON must be an object");
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <textarea
        rows={Math.min(20, Math.max(8, text.split("\n").length + 1))}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] text-neutral-200 focus:border-cyan-700 focus:outline-none"
      />
      {parseError && (
        <p className="mt-1 text-[11px] text-rose-300">
          JSON: {parseError}
        </p>
      )}
    </>
  );
}
