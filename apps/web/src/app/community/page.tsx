import { Breadcrumbs } from "@platform/ui";
import Link from "next/link";

import {
  fetchCommunityFeed,
  fetchMe,
  SECTOR_SERVICE_URL,
  type CommunityFeed,
  type CurrentUser,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

export default async function CommunityHubPage() {
  let feed: CommunityFeed;
  let user: CurrentUser | null;
  try {
    [feed, user] = await Promise.all([fetchCommunityFeed(), fetchMe()]);
  } catch (err) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-neutral-50">커뮤니티</h1>
        <p className="mt-4 text-sm text-red-400">
          sector-service에 연결할 수 없습니다 ({SECTOR_SERVICE_URL}).
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 pb-16 pt-8">
      <Breadcrumbs className="mb-3" items={[{ label: "커뮤니티" }]} />

      {/* Hero */}
      <section className="mb-8 rounded-xl border border-violet-900/40 bg-gradient-to-br from-violet-950/40 via-neutral-950 to-cyan-950/30 p-6">
        <div className="flex items-baseline gap-2">
          <span className="rounded-full border border-violet-700/60 bg-violet-950/50 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
            👥 커뮤니티
          </span>
          <span className="text-[11px] text-violet-400">
            함께 예측하고, 함께 개선합니다
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">
          내일의 주가, 누가 맞출까?
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-300">
          매일 종목의 1일/1주/1달 뒤 가격을 예측하고, 정확도로 포인트를
          쌓아보세요. 섹터 시뮬레이터에 어떤 드라이버·종목을 추가하면 좋을지
          제안하고 투표할 수도 있습니다.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/community/predict"
            className="rounded border border-cyan-700 bg-cyan-900/40 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-800/60"
          >
            🎯 예측 등록하기 →
          </Link>
          <Link
            href="/community/leaderboard"
            className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-800/60"
          >
            🏆 리더보드
          </Link>
          <Link
            href="/community/suggestions"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-violet-700 hover:text-violet-200"
          >
            💡 섹터 개선 제안
          </Link>
          <Link
            href="/community/proposals"
            className="rounded border border-cyan-700/60 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:border-cyan-600 hover:bg-cyan-900/40"
          >
            🆕 Community proposals
          </Link>
        </div>
      </section>

      {/* Totals strip */}
      <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="누적 예측" value={feed.totals.predictions_made.toString()} />
        <Tile
          label="채점 완료"
          value={feed.totals.predictions_resolved.toString()}
          sub={
            feed.totals.predictions_made > 0
              ? `${((feed.totals.predictions_resolved / feed.totals.predictions_made) * 100).toFixed(0)}% 결제됨`
              : undefined
          }
        />
        <Tile label="개선 제안 (open)" value={feed.totals.suggestions_open.toString()} />
        <Tile label="활동 멤버" value={feed.totals.scorers.toString()} />
      </section>

      {/* 4-section grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RecentPredictionsCard feed={feed} />
        <LeaderboardCard feed={feed} />
        <PopularScenariosCard feed={feed} />
        <RecentSuggestionsCard feed={feed} />
      </div>

      {/* Personal corner — only when logged in */}
      {user && (
        <section className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/30 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
            나의 공간
          </h2>
          <p className="mb-3 text-[11px] text-neutral-500">
            개인용 도구는 헤더 우측 메뉴 또는 아래 링크에서.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link
              href="/my-sectors"
              className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              🛠 내가 만든 시뮬레이터
            </Link>
            <Link
              href="/watchlist"
              className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              ★ 관심 종목
            </Link>
            <Link
              href="/community/my-predictions"
              className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-neutral-300 hover:border-cyan-700 hover:text-cyan-300"
            >
              📋 내 예측 기록
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-neutral-100">
        {value}
      </div>
      {sub && <div className="text-[10px] text-neutral-600">{sub}</div>}
    </div>
  );
}

function RecentPredictionsCard({ feed }: { feed: CommunityFeed }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          🎯 최근 예측
        </h2>
        <Link
          href="/community/predict"
          className="text-[11px] text-cyan-400 hover:text-cyan-300"
        >
          내 예측 등록 →
        </Link>
      </div>
      {feed.recent_predictions.length === 0 ? (
        <p className="text-[12px] text-neutral-500">
          아직 예측이 없습니다. 첫 예측을 등록해 보세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {feed.recent_predictions.map((p) => {
            const positive = p.predicted_pct >= 0;
            const flag = p.iso_country === "KR" ? "🇰🇷" : "🇺🇸";
            const horizonKo =
              p.horizon === "1d" ? "1일" : p.horizon === "1w" ? "1주" : "1달";
            return (
              <li
                key={p.id}
                className="flex items-baseline gap-3 rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs"
              >
                <span aria-hidden>{flag}</span>
                <Link
                  href={`/sectors/${p.sector_slug}/equities/${encodeURIComponent(p.ticker)}`}
                  className="font-mono font-semibold text-neutral-100 hover:text-cyan-300"
                >
                  {p.ticker}
                </Link>
                <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-neutral-500">
                  {horizonKo}
                </span>
                <span
                  className={`font-mono tabular-nums ${positive ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {positive ? "+" : ""}
                  {p.predicted_pct.toFixed(1)}%
                </span>
                {p.has_scenario && (
                  <span
                    className="rounded bg-cyan-950/60 px-1 py-0.5 text-[9px] text-cyan-300"
                    title="저장된 시나리오와 연결됨"
                  >
                    🛠
                  </span>
                )}
                {p.has_analysis && (
                  <span
                    className="rounded bg-violet-950/60 px-1 py-0.5 text-[9px] text-violet-300"
                    title={`AI 분석 (확신도 ${p.confidence ?? "?"})`}
                  >
                    🤖
                  </span>
                )}
                <span className="ml-auto truncate text-[10px] text-neutral-500">
                  {p.user_label}
                </span>
                {p.resolved && p.score !== null && (
                  <span className="rounded bg-amber-950/60 px-1 py-0.5 text-[9px] font-semibold text-amber-300">
                    {p.score.toFixed(0)}점
                  </span>
                )}
                <Link
                  href={`/predict/${p.id}`}
                  className="text-[10px] text-cyan-500 hover:text-cyan-300"
                  aria-label="이 예측의 상세 페이지로 이동"
                >
                  →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LeaderboardCard({ feed }: { feed: CommunityFeed }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          🏆 리더보드
        </h2>
        <Link
          href="/community/leaderboard"
          className="text-[11px] text-cyan-400 hover:text-cyan-300"
        >
          전체 보기 →
        </Link>
      </div>
      {feed.top_users.length === 0 ? (
        <p className="text-[12px] text-neutral-500">
          아직 채점된 예측이 없습니다. 자정에 1일 horizon 예측이 채점됩니다.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {feed.top_users.map((u, i) => (
            <li
              key={u.user_id}
              className="flex items-baseline gap-3 rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs"
            >
              <span
                className={
                  i < 3
                    ? "font-bold text-amber-300"
                    : "font-mono text-neutral-500"
                }
              >
                {["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`}
              </span>
              <span className="truncate text-neutral-100">{u.user_label}</span>
              <span className="ml-auto font-mono tabular-nums text-neutral-300">
                {u.total_points.toFixed(0)} pt
              </span>
              <span className="text-[10px] text-neutral-500">
                {u.hit_rate_pct.toFixed(0)}% 적중
              </span>
              {u.current_streak > 1 && (
                <span className="rounded bg-rose-950/60 px-1 py-0.5 text-[9px] font-semibold text-rose-300">
                  🔥 {u.current_streak}연속
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PopularScenariosCard({ feed }: { feed: CommunityFeed }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          📝 최근 시나리오
        </h2>
      </div>
      {feed.popular_scenarios.length === 0 ? (
        <p className="text-[12px] text-neutral-500">
          아직 공유된 시나리오가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {feed.popular_scenarios.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sectors/${s.sector_slug}?scenario=${s.id}`}
                className="group block rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs hover:border-cyan-700"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-neutral-100 group-hover:text-cyan-300">
                    {s.name}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {s.override_count}× 가정
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between text-[10px] text-neutral-500">
                  <span>{s.sector_slug}</span>
                  <span>
                    {s.author_label ?? "anonymous"} ·{" "}
                    {new Date(s.updated_at).toISOString().slice(0, 10)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentSuggestionsCard({ feed }: { feed: CommunityFeed }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          💡 섹터 개선 제안
        </h2>
        <Link
          href="/community/suggestions"
          className="text-[11px] text-cyan-400 hover:text-cyan-300"
        >
          전체 보기 →
        </Link>
      </div>
      {feed.recent_suggestions.length === 0 ? (
        <p className="text-[12px] text-neutral-500">
          아직 제안이 없습니다. 섹터 페이지의 "개선 제안" 에서 시작해 보세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {feed.recent_suggestions.map((s) => (
            <li
              key={s.id}
              className="rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/community/suggestions?sector=${s.sector_slug}`}
                  className="truncate font-medium text-neutral-100 hover:text-cyan-300"
                >
                  {s.title}
                </Link>
                <span
                  className={`text-[10px] font-semibold tabular-nums ${
                    s.score > 0
                      ? "text-emerald-400"
                      : s.score < 0
                        ? "text-rose-400"
                        : "text-neutral-500"
                  }`}
                >
                  {s.score > 0 ? "+" : ""}
                  {s.score}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2 text-[10px] text-neutral-500">
                <span className="rounded border border-neutral-800 px-1 py-0.5 uppercase tracking-wider">
                  {humanKind(s.kind)}
                </span>
                <span>{s.sector_slug}</span>
                <span>· {s.user_label}</span>
                <span className="ml-auto rounded bg-neutral-900 px-1 py-0.5">
                  {statusLabel(s.status)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function humanKind(k: string): string {
  switch (k) {
    case "add_driver": return "드라이버 추가";
    case "remove_driver": return "드라이버 제거";
    case "add_equity": return "종목 추가";
    case "remove_equity": return "종목 제거";
    case "rename_node": return "이름 변경";
    case "rewire_edge": return "엣지 수정";
    default: return k;
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "open": return "검토 대기";
    case "under_review": return "검토 중";
    case "approved": return "승인됨";
    case "rejected": return "거절됨";
    case "withdrawn": return "철회됨";
    default: return s;
  }
}
