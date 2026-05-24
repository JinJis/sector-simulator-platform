"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createProposal,
  type ProposalCreateEvidence,
  type ProposalTargetKind,
} from "@/lib/community-proposal-client";

interface Props {
  sectorChoices: { slug: string; name: string }[];
  defaultSector: string;
}

const KIND_OPTIONS: { value: ProposalTargetKind; label: string; hint: string }[] = [
  { value: "add_driver", label: "Add driver", hint: "New simulation input (slider)" },
  { value: "add_equity", label: "Add equity", hint: "New listed company on the basket" },
  { value: "add_capability", label: "Add capability", hint: "New vision capability + initial score" },
  { value: "add_risk", label: "Add risk", hint: "External/political/supply exposure" },
  { value: "add_actor", label: "Add actor", hint: "Company / lab / govt body" },
  { value: "add_signal_source", label: "Add signal source", hint: "Search keywords / URL feed" },
  { value: "edit", label: "Edit existing", hint: "Fix or refine an existing row" },
  { value: "other", label: "Other / freeform", hint: "Anything else (never auto-applies)" },
];

interface EvidenceRow {
  kind: "text" | "url";
  content: string;
}

export function NewProposalForm({ sectorChoices, defaultSector }: Props) {
  const router = useRouter();
  const [sectorSlug, setSectorSlug] = useState(defaultSector);
  const [targetKind, setTargetKind] = useState<ProposalTargetKind>("add_driver");
  const [targetRef, setTargetRef] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [payloadJson, setPayloadJson] = useState("{}");
  const [evidence, setEvidence] = useState<EvidenceRow[]>([
    { kind: "text", content: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOk = title.trim().length >= 5;
  const bodyOk = body.trim().length >= 20;
  const payloadOk = (() => {
    try {
      JSON.parse(payloadJson);
      return true;
    } catch {
      return false;
    }
  })();

  function addEvidence(kind: "text" | "url") {
    setEvidence((prev) => [...prev, { kind, content: "" }]);
  }
  function updateEvidence(i: number, patch: Partial<EvidenceRow>) {
    setEvidence((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }
  function removeEvidence(i: number) {
    setEvidence((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!titleOk || !bodyOk || !payloadOk) return;
    setSubmitting(true);
    try {
      const filteredEvidence: ProposalCreateEvidence[] = evidence
        .map((e): ProposalCreateEvidence | null => {
          const trimmed = e.content.trim();
          if (!trimmed) return null;
          if (e.kind === "url") return { kind: "url", content: trimmed };
          return { kind: "text", content: trimmed };
        })
        .filter((e): e is ProposalCreateEvidence => e !== null);
      const { id } = await createProposal({
        sector_slug: sectorSlug,
        target_kind: targetKind,
        target_ref: targetRef.trim() || null,
        title: title.trim(),
        body: body.trim(),
        proposed_payload: JSON.parse(payloadJson),
        evidence: filteredEvidence,
      });
      router.push(`/community/proposals/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 space-y-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Sector / Vision">
          <select
            value={sectorSlug}
            onChange={(e) => setSectorSlug(e.target.value)}
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
          >
            {sectorChoices.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} ({s.slug})
              </option>
            ))}
          </select>
        </Field>
        <Field label="What kind of change?">
          <select
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value as ProposalTargetKind)}
            className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-neutral-500">
            {KIND_OPTIONS.find((o) => o.value === targetKind)?.hint}
          </p>
        </Field>
      </div>

      <Field
        label="Existing element key (only for edit)"
        hint={`Driver name / equity ticker / capability key. Leave blank for "add_*" kinds.`}
      >
        <input
          value={targetRef}
          onChange={(e) => setTargetRef(e.target.value)}
          placeholder="e.g. rad_hard_compute"
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 font-mono text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </Field>

      <Field
        label="Title"
        hint={`${title.length}/160 · min 5`}
        error={!titleOk && title.length > 0 ? "Too short" : null}
      >
        <input
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add radiation-hardened chip yield driver"
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </Field>

      <Field
        label="Body — why does this matter?"
        hint={`${body.length}/8000 · min 20`}
        error={!bodyOk && body.length > 0 ? "Tell us a bit more (≥20 chars)" : null}
      >
        <textarea
          required
          rows={6}
          maxLength={8000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Explain the change and why it matters for the sector's accuracy. Plain text — markdown rendering lands later."
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </Field>

      <Field
        label="Proposed payload (JSON)"
        hint='Raw data the applier will use. Example for add_driver: {"name":"rad_hard_yield_pct","unit":"%","default":65,"min":30,"max":95}'
        error={!payloadOk ? "Invalid JSON" : null}
      >
        <textarea
          required
          rows={5}
          value={payloadJson}
          onChange={(e) => setPayloadJson(e.target.value)}
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 font-mono text-[12px] text-neutral-100 focus:border-cyan-700 focus:outline-none"
        />
      </Field>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Evidence
          </label>
          <div className="flex gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => addEvidence("text")}
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500"
            >
              + note
            </button>
            <button
              type="button"
              onClick={() => addEvidence("url")}
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500"
            >
              + URL
            </button>
          </div>
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">
          PDF + image upload land in M46d.
        </p>
        <ul className="mt-2 space-y-2">
          {evidence.map((e, i) => (
            <li
              key={i}
              className="flex gap-2 rounded border border-neutral-800 bg-neutral-950/40 p-2"
            >
              <span className="shrink-0 self-start rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
                {e.kind}
              </span>
              {e.kind === "url" ? (
                <input
                  type="url"
                  value={e.content}
                  onChange={(ev) => updateEvidence(i, { content: ev.target.value })}
                  placeholder="https://example.com/source"
                  className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[12px] text-neutral-100 focus:border-cyan-700 focus:outline-none"
                />
              ) : (
                <textarea
                  rows={2}
                  value={e.content}
                  onChange={(ev) => updateEvidence(i, { content: ev.target.value })}
                  placeholder="Freeform note backing this proposal"
                  className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[12px] text-neutral-100 focus:border-cyan-700 focus:outline-none"
                />
              )}
              <button
                type="button"
                onClick={() => removeEvidence(i)}
                className="shrink-0 self-start rounded text-[14px] text-neutral-600 hover:text-red-400"
                aria-label="Remove"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-neutral-500">
          Submitting publishes the proposal immediately for voting. Daily
          cap: 3 proposals per author.
        </p>
        <button
          type="submit"
          disabled={submitting || !titleOk || !bodyOk || !payloadOk}
          className="rounded border border-cyan-700 bg-cyan-900/40 px-5 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-800/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Publishing…" : "Publish proposal →"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          {label}
        </label>
        {hint && (
          <span className="text-[10px] text-neutral-600">{hint}</span>
        )}
      </div>
      <div className="mt-1">{children}</div>
      {error && (
        <p className="mt-1 text-[10px] text-red-400">{error}</p>
      )}
    </div>
  );
}
