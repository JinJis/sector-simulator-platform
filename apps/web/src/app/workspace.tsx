"use client";

import { useState } from "react";

import type {
  LiveResponse,
  SensitivityResponse,
  SimMetadata,
} from "@/lib/sim-client";

import { LiveDashboard } from "./live-dashboard";
import { ManualPanel } from "./manual-panel";
import { SourcesView } from "./sources-view";

type TabId = "live" | "manual" | "sources";

interface TabSpec {
  id: TabId;
  label: string;
  caption: string;
}

const TABS: TabSpec[] = [
  { id: "live", label: "Live", caption: "실시간 자동 데이터" },
  { id: "manual", label: "Manual", caption: "슬라이더로 직접 조정" },
  { id: "sources", label: "Sources", caption: "과거 → 현재 + 출처" },
];

interface Props {
  meta: SimMetadata;
  sensitivity: SensitivityResponse | null;
  initialLive: LiveResponse | null;
}

export function Workspace({ meta, sensitivity, initialLive }: Props) {
  const [tab, setTab] = useState<TabId>("live");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-stretch gap-1 rounded-lg border border-neutral-800 bg-neutral-900/40 p-1">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[140px] rounded-md px-4 py-2 text-left transition ${
                active
                  ? "bg-neutral-800 shadow-inner ring-1 ring-cyan-500/30"
                  : "hover:bg-neutral-800/50"
              }`}
            >
              <div
                className={`text-sm font-semibold ${
                  active ? "text-cyan-300" : "text-neutral-200"
                }`}
              >
                {t.label}
              </div>
              <div className="text-[11px] text-neutral-500">{t.caption}</div>
            </button>
          );
        })}
      </div>

      {tab === "live" && (
        <LiveDashboard meta={meta} sensitivity={sensitivity} initial={initialLive} />
      )}
      {tab === "manual" && <ManualPanel meta={meta} sensitivity={sensitivity} />}
      {tab === "sources" && <SourcesView meta={meta} />}
    </div>
  );
}
