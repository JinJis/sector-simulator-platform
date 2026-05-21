import { Breadcrumbs } from "@platform/ui";

import {
  fetchAuditFacets,
  listAudit,
  SECTOR_SERVICE_URL,
  type AuditFacets,
  type AuditList,
  type AuditLog,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

interface SearchParams {
  before?: string;
  sector?: string;
  action?: string;
  author?: string;
}

const TONE_BY_PREFIX: Array<[string, string]> = [
  ["graph.", "border-cyan-900/60 bg-cyan-950/40 text-cyan-300"],
  ["scenario.", "border-amber-900/60 bg-amber-950/40 text-amber-300"],
  ["lifecycle.", "border-rose-900/60 bg-rose-950/40 text-rose-300"],
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  let result: AuditList;
  let facets: AuditFacets;
  try {
    [result, facets] = await Promise.all([
      listAudit({
        limit: 50,
        before: params.before,
        sector_slug: params.sector,
        action_prefix: params.action,
        author_label: params.author,
      }),
      fetchAuditFacets(),
    ]);
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold text-neutral-50">Audit log</h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  const actionPrefixes = collectActionPrefixes(facets.actions);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Audit" }]} />
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-neutral-50">Audit log</h1>
        <p className="mt-1 text-xs text-neutral-500">
          그래프 / 시나리오 / lifecycle mutation 전체 — 최신순. 50개씩 페이지네이션.
        </p>
      </header>

      <form
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3"
        method="get"
      >
        <Field name="action" label="Action prefix" value={params.action ?? ""}>
          <option value="">(any)</option>
          {actionPrefixes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Field>
        <Field name="sector" label="Sector" value={params.sector ?? ""}>
          <option value="">(any)</option>
          {facets.sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Field>
        <Field name="author" label="Author" value={params.author ?? ""}>
          <option value="">(any)</option>
          {facets.authors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Field>
        <button
          type="submit"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-200 hover:border-cyan-700 hover:text-cyan-300"
        >
          Apply
        </button>
        <a
          href="/audit"
          className="text-xs text-neutral-500 hover:text-neutral-200"
        >
          Reset
        </a>
      </form>

      {result.rows.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-800 p-4 text-xs text-neutral-500">
          조건에 맞는 audit 기록이 없습니다.
        </p>
      ) : (
        <ol className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
          {result.rows.map((r) => (
            <AuditRow key={r.id} row={r} />
          ))}
        </ol>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
        <span>{result.rows.length} rows on this page</span>
        {result.next_before ? (
          <a
            href={buildNextUrl(params, result.next_before)}
            className="rounded border border-neutral-800 px-3 py-1 hover:border-cyan-700 hover:text-cyan-300"
          >
            Older →
          </a>
        ) : (
          <span>end</span>
        )}
      </div>
    </main>
  );
}

function AuditRow({ row }: { row: AuditLog }) {
  const tone = TONE_BY_PREFIX.find(([p]) => row.action.startsWith(p))?.[1] ??
    "border-neutral-800 bg-neutral-950 text-neutral-400";
  return (
    <li className="border-b border-neutral-800 px-4 py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
        >
          {row.action}
        </span>
        {row.sector_slug && (
          <span className="text-[11px] text-neutral-500">{row.sector_slug}</span>
        )}
        <span className="text-[11px] text-neutral-600">
          {new Date(row.created_at).toISOString().slice(0, 19).replace("T", " ")}
        </span>
        {row.author_label && (
          <span className="ml-auto text-[11px] text-neutral-500">
            {row.author_label}
          </span>
        )}
      </div>
      <pre className="mt-1 max-w-full overflow-x-auto rounded bg-neutral-950/60 px-2 py-1 text-[10px] leading-snug text-neutral-400">
        {JSON.stringify(row.payload, null, 0)}
      </pre>
    </li>
  );
}

function Field({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
      {label}
      <select
        name={name}
        defaultValue={value}
        className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
      >
        {children}
      </select>
    </label>
  );
}

function collectActionPrefixes(actions: string[]): string[] {
  // Build a list of unique prefixes (graph., scenario., lifecycle., audit.*)
  // plus the raw action set so users can drill in.
  const out = new Set<string>();
  for (const a of actions) {
    const dot = a.indexOf(".");
    if (dot >= 0) out.add(a.slice(0, dot + 1));
    out.add(a);
  }
  return Array.from(out).sort();
}

function buildNextUrl(params: SearchParams, before: string): string {
  const qs = new URLSearchParams();
  qs.set("before", before);
  if (params.sector) qs.set("sector", params.sector);
  if (params.action) qs.set("action", params.action);
  if (params.author) qs.set("author", params.author);
  return `/audit?${qs.toString()}`;
}
