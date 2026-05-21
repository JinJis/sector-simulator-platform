import { Breadcrumbs } from "@platform/ui";
import Link from "next/link";

import {
  fetchLeaderboard,
  fetchMyScore,
  type LeaderboardRow,
  type MyScore,
} from "@/lib/sim-client";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  let rows: LeaderboardRow[];
  let me: MyScore;
  try {
    [rows, me] = await Promise.all([fetchLeaderboard(50), fetchMyScore()]);
  } catch (err) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-neutral-50">리더보드</h1>
        <p className="mt-4 text-sm text-red-400">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-6 pb-16 pt-8">
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: "커뮤니티", href: "/community" },
          { label: "리더보드" },
        ]}
      />
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-neutral-50">🏆 리더보드</h1>
        <p className="mt-1 text-sm text-neutral-400">
          누적 포인트 순. 적중률은 hit-rate, streak은 50점 이상 연속 횟수.
        </p>
      </header>

      {me && (
        <section className="mb-6 rounded-lg border border-cyan-900/60 bg-cyan-950/30 p-4">
          <p className="text-[10px] uppercase tracking-wider text-cyan-400">
            내 점수
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums text-cyan-100">
              {me.total_points.toFixed(0)} pt
            </span>
            <span className="text-[11px] text-cyan-300">
              적중률 {me.hit_rate_pct.toFixed(0)}% · 채점 완료{" "}
              {me.predictions_resolved}/{me.predictions_made} ·
              현재 연속 {me.current_streak} (최고 {me.best_streak})
            </span>
          </div>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
          아직 채점된 예측이 없습니다. 1일 horizon 예측이 가장 빨리 채점됩니다 — {" "}
          <Link href="/community/predict" className="text-cyan-400 hover:text-cyan-300">
            지금 등록해 보세요 →
          </Link>
        </div>
      ) : (
        <ol className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40 divide-y divide-neutral-800">
          {rows.map((r, i) => {
            const isMe = me?.user_id === r.user_id;
            return (
              <li
                key={r.user_id}
                className={`flex items-baseline gap-3 px-4 py-3 ${
                  isMe ? "bg-cyan-950/20" : ""
                }`}
              >
                <span
                  className={
                    i < 3
                      ? "w-8 text-2xl font-bold text-amber-300"
                      : "w-8 font-mono text-sm text-neutral-500"
                  }
                >
                  {["🥇", "🥈", "🥉"][i] ?? `${i + 1}`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-100">
                    {r.user_label}
                    {isMe && (
                      <span className="ml-2 rounded bg-cyan-900/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-cyan-300">
                        나
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    적중 {r.hit_rate_pct.toFixed(0)}% · {r.predictions_resolved}회
                    채점 완료
                    {r.current_streak > 1 && (
                      <span className="ml-2 text-rose-400">
                        🔥 {r.current_streak} 연속
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-mono tabular-nums text-lg font-semibold text-neutral-100">
                  {r.total_points.toFixed(0)}
                </span>
                <span className="text-[10px] text-neutral-600">pt</span>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
