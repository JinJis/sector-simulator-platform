"use client";

import { useEffect, useMemo, useState } from "react";

import { generateReport, type ReportResponse } from "@/lib/sim-client";

import { sourceKindMeta } from "./shared";

interface Props {
  slug: string;
  drivers: Record<string, number>;
  scenarioName: string | null;
  scenarioNotes: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-over panel with the generated markdown report. Triggered from the
 * ScenarioBar. The body renders a lightweight markdown→HTML pass (headings,
 * tables, paragraphs, lists, links) — we deliberately avoid a full markdown
 * library to keep the bundle small; the templated report uses a narrow
 * subset of markdown that this renderer covers.
 */
export function ReportPanel({
  slug,
  drivers,
  scenarioName,
  scenarioNotes,
  open,
  onClose,
}: Props) {
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  // Generate on open + whenever the inputs change while open. The Scenario
  // identity is part of the cache key, but we also re-fetch when drivers
  // change because the user may have tweaked sliders after opening.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void generateReport({
      slug,
      drivers,
      scenario_name: scenarioName,
      scenario_notes: scenarioNotes,
    })
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "report failed");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug, drivers, scenarioName, scenarioNotes]);

  const html = useMemo(
    () => (report ? renderMarkdown(report.markdown) : ""),
    [report],
  );

  async function copyMarkdown() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.markdown);
      setCopyToast("Copied to clipboard");
    } catch {
      setCopyToast("Clipboard blocked — use download instead");
    }
    setTimeout(() => setCopyToast(null), 2500);
  }

  function downloadMarkdown() {
    if (!report) return;
    const blob = new Blob([report.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filenameSlug = (scenarioName ?? "defaults")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    a.download = `${slug}-${filenameSlug}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-3xl flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Report"
      >
        <header className="flex items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-900/60 px-4 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Report
            </div>
            <div className="text-sm font-medium text-neutral-100">
              {scenarioName ?? "Defaults"}{" "}
              <span className="text-[11px] text-neutral-500">
                · {slug} · {Object.keys(drivers).length} drivers
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={copyMarkdown}
              disabled={!report || busy}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
            >
              Copy
            </button>
            <button
              onClick={downloadMarkdown}
              disabled={!report || busy}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
            >
              ↓ .md
            </button>
            <button
              onClick={onClose}
              className="rounded px-2 py-1 text-sm text-neutral-500 hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        {copyToast && (
          <p className="border-b border-cyan-900/50 bg-cyan-950/30 px-4 py-1.5 text-[11px] text-cyan-300">
            {copyToast}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {busy && (
            <p className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              generating report…
            </p>
          )}
          {error && (
            <p className="rounded border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-300">
              {error}
            </p>
          )}
          {report && (
            <article
              className="report-prose"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {report && report.sources.length > 0 && (
            <div className="mt-6 border-t border-neutral-800 pt-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Citations by kind
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {summarizeKinds(report.sources).map((row) => (
                  <span
                    key={row.kind}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${sourceKindMeta(row.kind).pillClass}`}
                  >
                    {sourceKindMeta(row.kind).label} × {row.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="border-t border-neutral-800 bg-neutral-900/40 px-4 py-2 text-[10px] text-neutral-600">
          Phase 2 stub — deterministic template. LLM-authored prose lands in
          a later slice.
        </footer>
      </aside>

      {/* Inline scoped styles for the markdown body — keeps the rest of the
          app unaffected while giving the report a clean reading layout. */}
      <style jsx global>{`
        .report-prose {
          color: #e5e5e5;
          font-size: 13px;
          line-height: 1.6;
        }
        .report-prose h1 {
          font-size: 20px;
          font-weight: 700;
          color: #fafafa;
          margin: 0 0 12px;
        }
        .report-prose h2 {
          font-size: 15px;
          font-weight: 600;
          color: #fafafa;
          margin: 20px 0 8px;
          border-bottom: 1px solid #262626;
          padding-bottom: 4px;
        }
        .report-prose h3 {
          font-size: 13px;
          font-weight: 600;
          color: #d4d4d4;
          margin: 14px 0 4px;
        }
        .report-prose p {
          margin: 6px 0;
        }
        .report-prose ol,
        .report-prose ul {
          margin: 6px 0 10px 18px;
        }
        .report-prose li {
          margin: 2px 0;
        }
        .report-prose code {
          background: #171717;
          padding: 1px 4px;
          border-radius: 3px;
        }
        .report-prose blockquote {
          border-left: 2px solid #525252;
          margin: 10px 0;
          padding: 4px 10px;
          color: #d4d4d4;
          background: #141414;
        }
        .report-prose table {
          width: 100%;
          border-collapse: collapse;
          margin: 8px 0 14px;
          font-size: 12px;
        }
        .report-prose th,
        .report-prose td {
          border-bottom: 1px solid #262626;
          padding: 4px 8px;
          text-align: left;
        }
        .report-prose th {
          color: #a3a3a3;
          font-weight: 600;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .report-prose td:nth-child(n + 2) {
          font-variant-numeric: tabular-nums;
        }
        .report-prose a {
          color: #67e8f9;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .report-prose hr {
          border: 0;
          border-top: 1px solid #262626;
          margin: 14px 0;
        }
      `}</style>
    </div>
  );
}

function summarizeKinds(
  sources: ReportResponse["sources"],
): { kind: string; count: number }[] {
  const m = new Map<string, number>();
  for (const s of sources) m.set(s.kind || "unclassified", (m.get(s.kind || "unclassified") ?? 0) + 1);
  return [...m.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

// --- Minimal markdown renderer ---
//
// Handles the narrow subset the templated report uses: ATX headings (`# `,
// `## `, `### `), pipe tables with alignment, blockquotes (`> `), ordered
// and unordered lists, bold (`**…**`), italics (`_…_`), inline code, and
// `[label](url)` links. Anything else passes through as a paragraph.

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line → paragraph break.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading.
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }

    // Pipe table — header row, separator row, then rows until blank.
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$/.test(lines[i + 1]!)) {
      const header = splitRow(line);
      const sepCells = splitRow(lines[i + 1]!);
      const aligns = sepCells.map(alignFromSep);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      out.push(renderTable(header, rows, aligns));
      continue;
    }

    // Blockquote.
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        buf.push(lines[i]!.slice(2));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        items.push(`<li>${inline(lines[i]!.replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(`<li>${inline(lines[i]!.replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Default — paragraph (collect contiguous non-special lines).
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^#{1,3}\s+/.test(lines[i]!) &&
      !lines[i]!.startsWith("> ") &&
      !/^\d+\.\s+/.test(lines[i]!) &&
      !/^[-*]\s+/.test(lines[i]!) &&
      !lines[i]!.includes("|")
    ) {
      para.push(lines[i]!);
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

function splitRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((c) => c.trim());
}

function alignFromSep(cell: string): "left" | "center" | "right" {
  const t = cell.trim();
  if (t.startsWith(":") && t.endsWith(":")) return "center";
  if (t.endsWith(":")) return "right";
  return "left";
}

function renderTable(
  header: string[],
  rows: string[][],
  aligns: ("left" | "center" | "right")[],
): string {
  const thead =
    "<thead><tr>" +
    header
      .map((h, i) => `<th style="text-align:${aligns[i] ?? "left"}">${inline(h)}</th>`)
      .join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    rows
      .map(
        (row) =>
          "<tr>" +
          row
            .map(
              (c, i) =>
                `<td style="text-align:${aligns[i] ?? "left"}">${inline(c)}</td>`,
            )
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody>";
  return `<table>${thead}${tbody}</table>`;
}

function inline(text: string): string {
  let s = escapeHtml(text);
  // Code spans first so their content isn't re-formatted.
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // Links: [label](url).
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label, url) =>
      `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`,
  );
  // Bold + italic.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
