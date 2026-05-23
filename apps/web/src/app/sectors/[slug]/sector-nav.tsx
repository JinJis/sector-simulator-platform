"use client";

/**
 * M23 sector navigation: 3 primary tabs + a collapsible "고급 도구"
 * expander. The primary row is the only thing a beginner sees on
 * first paint; the advanced tools (full slider editor, causal graph,
 * sources, live feed, A/B compare) sit one click away so power users
 * can still reach everything.
 */

import { SubNav } from "@platform/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Props {
  slug: string;
}

interface NavItem {
  label: string;
  href: string;
  caption?: string;
}

export function SectorNav({ slug }: Props) {
  const base = `/sectors/${slug}`;
  // M37d (pivot): "종목" (equities) tab removed — investment surface
  // archived behind ENABLE_LEGACY_INVESTMENT_FEATURES at M43. The
  // /sectors/[slug]/equities and /sectors/[slug]/compare-stocks routes
  // remain reachable by direct URL until M43; they're just no longer
  // surfaced from the sub-nav. The legacy /sectors/* family itself
  // stays alive through M43 alongside /visions/*.
  const primary: NavItem[] = [
    { label: "개요", href: base, caption: "왜 성장하나요?" },
    { label: "시뮬레이션", href: `${base}/simulate`, caption: "내 가정으로 테스트" },
  ];
  const advanced: NavItem[] = [
    { label: "실시간 데이터", href: `${base}/live`, caption: "3초마다 자동 갱신" },
    { label: "전체 슬라이더", href: `${base}/manual`, caption: "14개 드라이버 모두" },
    { label: "인과 그래프", href: `${base}/graph`, caption: "드라이버 → 종목 흐름" },
    { label: "데이터 출처", href: `${base}/sources`, caption: "모든 숫자의 근거" },
  ];

  const pathname = usePathname() ?? "";
  const onAdvanced = advanced.some(
    (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
  );

  return (
    <div className="mb-5 flex flex-col gap-2">
      <SubNav items={primary} />
      <AdvancedExpander items={advanced} startOpen={onAdvanced} />
    </div>
  );
}

function AdvancedExpander({
  items,
  startOpen,
}: {
  items: NavItem[];
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname() ?? "";

  // If a user navigates into an advanced page directly, keep the
  // expander open so they're not confused by the active tab being
  // hidden.
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);

  // Close on Escape / click-outside, but only when the user-driven
  // open state diverges from the "we're on an advanced page" state.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (startOpen) return;
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (!startOpen && e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [startOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/30 px-3 py-1.5 text-[11px] text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-200"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-neutral-500">고급 도구</span>
          <span className="text-[10px] text-neutral-600">
            슬라이더 · 그래프 · 출처 · 실시간 · 비교
          </span>
        </span>
        <span className={open ? "rotate-180" : ""}>▾</span>
      </button>
      {open && (
        <ul className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-md border border-neutral-800 bg-neutral-950/60 p-2 md:grid-cols-4">
          {items.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`block rounded px-2.5 py-2 transition ${
                    isActive
                      ? "bg-neutral-800 ring-1 ring-cyan-500/30"
                      : "hover:bg-neutral-900"
                  }`}
                >
                  <div
                    className={`text-[12px] font-medium ${
                      isActive ? "text-cyan-300" : "text-neutral-200"
                    }`}
                  >
                    {item.label}
                  </div>
                  {item.caption && (
                    <div className="text-[10px] text-neutral-500">
                      {item.caption}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
