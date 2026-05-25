/**
 * /visions/[slug]/signals — full chronological signal feed.
 *
 * M37 stub used fixture's recent_signals; M39f wires DB-backed list
 * via `signal.list` tRPC with cursor pagination + capability + source
 * filters. Fixture fallback retained for sector-service-unreachable
 * preview.
 */

import { SignalRow, type SignalKind } from "@platform/ui";
import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n/server";
import { fetchSignals, type SignalListResult } from "@/lib/vision-client";
import { trpc } from "@/lib/sim-client";

import { getVisionFixture } from "../../_fixtures";

type SearchParams = {
  cap?: string;
  kind?: string;
  highlight?: string;
  cursor?: string;
};

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}

const KIND_KEYS: { value: string; key: string }[] = [
  { value: "", key: "signals.filter.allSources" },
  { value: "paper", key: "signals.filter.papers" },
  { value: "patent", key: "signals.filter.patents" },
  { value: "news", key: "signals.filter.news" },
  { value: "filing", key: "signals.filter.filings" },
  { value: "gov_report", key: "signals.filter.govReports" },
  { value: "vendor_doc", key: "signals.filter.vendorDocs" },
];

function pickDeltaComposite(
  s: SignalListResult["items"][number],
): number | null {
  const xs = [s.delta_technical, s.delta_economic, s.delta_regulatory, s.delta_supply].filter(
    (v): v is number => v != null,
  );
  let best: number | null = null;
  for (const v of xs) {
    if (best === null || Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
}

export default async function SignalsIndexPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const q = await searchParams;
  const cap = q.cap || undefined;
  const kind = q.kind || undefined;
  const highlightOnly = q.highlight === "1";
  const cursor = q.cursor || undefined;
  const t = await getT();

  // Load capabilities for the filter dropdown + DB signal list.
  let capabilityKeys: string[] = [];
  let listResult: SignalListResult;
  let source: "db" | "fixture" = "db";
  try {
    const [caps, list] = await Promise.all([
      trpc.capability.list.query({ sector_slug: slug }),
      fetchSignals({
        sector_slug: slug,
        capability_key: cap,
        source_kind: kind,
        highlight_only: highlightOnly,
        cursor,
        limit: 30,
      }),
    ]);
    capabilityKeys = caps.map((c) => c.key);
    listResult = list;
  } catch {
    const fixture = getVisionFixture(slug);
    if (!fixture) notFound();
    source = "fixture";
    capabilityKeys = fixture.overview.capabilities.map((c) => c.key);
    // Adapt fixture recent_signals to SignalListResult shape so the
    // rest of the page renders identically.
    listResult = {
      items: fixture.overview.recent_signals.map((s) => ({
        id: s.id,
        sector_slug: slug,
        capability_id: s.capability_id,
        capability_key: s.capability_key,
        source_kind: s.source_kind,
        source_url: s.source_url,
        source_id_ext: null,
        title: s.title,
        summary: s.summary,
        published_at: s.published_at,
        delta_technical: s.delta_technical,
        delta_economic: s.delta_economic,
        delta_regulatory: s.delta_regulatory,
        delta_supply: s.delta_supply,
        is_highlight: s.is_highlight,
        ingested_at: s.published_at,
      })),
      next_cursor: null,
    };
  }

  const baseHref = `/visions/${slug}/signals`;
  const filterHref = (
    overrides: Partial<{ cap: string; kind: string; highlight: string; cursor: string }>,
  ): string => {
    const params = new URLSearchParams();
    if (cap && overrides.cap !== "") params.set("cap", overrides.cap ?? cap);
    else if (overrides.cap) params.set("cap", overrides.cap);
    if (kind && overrides.kind !== "") params.set("kind", overrides.kind ?? kind);
    else if (overrides.kind) params.set("kind", overrides.kind);
    if (highlightOnly && overrides.highlight !== "") params.set("highlight", "1");
    else if (overrides.highlight === "1") params.set("highlight", "1");
    if (overrides.cursor) params.set("cursor", overrides.cursor);
    const qs = params.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">
          {t("signals.feed.title")}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {t("signals.feed.subtitle")}
          {source === "fixture" && t("signals.fixtureNote")}
        </p>
      </div>

      {/* Filter bar */}
      <form
        action={baseHref}
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs"
      >
        <label className="flex items-center gap-1.5 text-neutral-500">
          {t("signals.filter.capability")}:
          <select
            name="cap"
            defaultValue={cap ?? ""}
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-200"
          >
            <option value="">{t("signals.filter.allCapabilities")}</option>
            {capabilityKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-neutral-500">
          {t("signals.filter.source")}:
          <select
            name="kind"
            defaultValue={kind ?? ""}
            className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-200"
          >
            {KIND_KEYS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-neutral-300">
          <input
            type="checkbox"
            name="highlight"
            value="1"
            defaultChecked={highlightOnly}
            className="accent-cyan-500"
          />
          {t("signals.filter.highlightsOnly")}
        </label>
        <button
          type="submit"
          className="ml-auto rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
        >
          {t("signals.filter.apply")}
        </button>
        {(cap || kind || highlightOnly) && (
          <a
            href={baseHref}
            className="text-[11px] text-neutral-500 hover:text-cyan-400"
          >
            {t("signals.filter.clear")}
          </a>
        )}
      </form>

      {listResult.items.length === 0 ? (
        <section className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-8 text-center">
          <p className="text-sm text-neutral-400">{t("signals.empty")}</p>
        </section>
      ) : (
        <>
          <div
            className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2"
            role="list"
          >
            {listResult.items.map((s) => (
              <SignalRow
                key={s.id}
                kind={s.source_kind as SignalKind}
                title={s.title}
                summary={s.summary}
                capability={
                  s.capability_key
                    ? { key: s.capability_key, label: s.capability_key }
                    : null
                }
                deltaComposite={pickDeltaComposite(s)}
                sourceUrl={s.source_url}
                publishedAt={s.published_at}
                highlighted={s.is_highlight}
                showSummary
              />
            ))}
          </div>

          {/* Cursor pagination */}
          {(listResult.next_cursor || cursor) && (
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              {cursor ? (
                <a
                  href={filterHref({})}
                  className="hover:text-cyan-400"
                >
                  {t("signals.start")}
                </a>
              ) : (
                <span />
              )}
              {listResult.next_cursor && (
                <a
                  href={filterHref({ cursor: listResult.next_cursor })}
                  className="hover:text-cyan-400"
                >
                  {t("signals.older")}
                </a>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-right text-[10px] text-neutral-600">
        {t("signals.showingPrefix")} {listResult.items.length}
        {t("signals.showingSuffix")}
        {source === "db" && t("signals.liveDb")}
      </p>
    </div>
  );
}
