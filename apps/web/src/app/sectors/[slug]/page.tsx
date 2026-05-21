"use client";

import Link from "next/link";

import { useSector } from "./sector-context";

/**
 * Overview hub — the landing page when you click into a sector. Lays out
 * an at-a-glance card grid that links into the four sub-tools below.
 *
 * Keeping it client-only (rather than its own RSC fetch) so it can read
 * the live driver count / scenario count out of context — the layout has
 * already fetched everything we need.
 */
export default function SectorOverviewPage() {
  const { meta, scenarios, sensitivity } = useSector();
  const base = `/sectors/${meta.slug}`;
  // Sensitivity is reported per-output; for the overview tile just surface
  // the top-3 drivers for the first output so the user gets a feel without
  // having to pick one. Manual tab lets them dig further.
  const sensitivityOutput =
    sensitivity ? Object.keys(sensitivity.by_output)[0] ?? null : null;
  const topDrivers = sensitivityOutput
    ? (sensitivity!.by_output[sensitivityOutput] ?? []).slice(0, 3)
    : [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card
        title="Live"
        href={`${base}/live`}
        caption="실시간 자동 데이터로 시뮬레이션을 돌립니다."
      >
        <p className="text-xs text-neutral-500">
          최신 가격·환율·금리 등을 데이터 파이프라인에서 가져와 자동으로 반영합니다. 화면 상단 KPI 띠가 3초마다 업데이트됩니다.
        </p>
      </Card>

      <Card
        title="Manual"
        href={`${base}/manual`}
        caption="슬라이더로 직접 드라이버를 조정합니다."
      >
        <p className="text-xs text-neutral-500">
          {meta.drivers.length}개 드라이버를 손으로 움직여 보면서 시뮬레이션의 민감도를 체감해 보세요.
        </p>
      </Card>

      <Card
        title="Graph"
        href={`${base}/graph`}
        caption="드라이버 → 산출 인과 그래프"
      >
        <p className="text-xs text-neutral-500">
          이 섹터의 인과 구조를 노드/엣지로 시각화합니다. 드라이버 노드는 현재 값을 inline으로 표시합니다.
        </p>
      </Card>

      <Card
        title="Sources"
        href={`${base}/sources`}
        caption="과거 데이터 + 출처"
      >
        <p className="text-xs text-neutral-500">
          모든 드라이버 값의 출처를 source URL · timestamp · confidence 까지 추적할 수 있습니다.
        </p>
      </Card>

      <Card
        title="Sensitivity"
        caption="가장 영향력 있는 드라이버"
        href={`${base}/manual`}
      >
        {topDrivers.length === 0 ? (
          <p className="text-xs text-neutral-500">
            sensitivity 데이터 준비 중 — 잠시 뒤 다시 확인해 주세요.
          </p>
        ) : (
          <ul className="space-y-1 text-xs text-neutral-300">
            <li className="text-[10px] uppercase tracking-wider text-neutral-600">
              {sensitivityOutput}
            </li>
            {topDrivers.map((d) => (
              <li key={d.driver}>
                <span className="text-neutral-500">{d.driver}</span> ·{" "}
                <span className="tabular-nums">
                  swing {d.swing.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Scenarios"
        caption={`${scenarios.length} saved`}
        href={`${base}/manual`}
      >
        {scenarios.length === 0 ? (
          <p className="text-xs text-neutral-500">
            아직 저장된 시나리오가 없습니다. Manual 탭에서 드라이버를 조정하고 위 바에서 "Save as…" 로 저장해 보세요.
          </p>
        ) : (
          <ul className="space-y-1 text-xs text-neutral-300">
            {scenarios.slice(0, 4).map((s) => (
              <li key={s.id} className="truncate">
                <span className="text-neutral-200">{s.name}</span>{" "}
                <span className="text-neutral-600">
                  · {Object.keys(s.driver_overrides).length} override
                  {Object.keys(s.driver_overrides).length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({
  title,
  caption,
  href,
  children,
}: {
  title: string;
  caption: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition hover:border-neutral-700 hover:bg-neutral-900"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-100 group-hover:text-cyan-300">
          {title}
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-neutral-600">
          {caption}
        </span>
      </div>
      {children}
    </Link>
  );
}
