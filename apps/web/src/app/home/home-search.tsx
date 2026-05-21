"use client";

/**
 * Client-side unified search for the home page. Operates over a
 * pre-flattened index passed in from the RSC layer: sectors,
 * equities, drivers all in one list, each with a route to jump to.
 *
 * Substring match on `query` against label + key. Result list caps at
 * 8 items to keep the dropdown light; users can refine by typing more.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

export interface SearchItem {
  kind: "sector" | "equity" | "driver";
  /** Display label (ticker · company name, sector name, or driver name). */
  label: string;
  /** Searchable secondary text (Korean name, sector slug, group). */
  hint: string;
  /** Route to navigate to on click. */
  href: string;
}

interface Props {
  items: SearchItem[];
}

const KIND_LABEL: Record<SearchItem["kind"], string> = {
  sector: "섹터",
  equity: "종목",
  driver: "드라이버",
};

const KIND_TONE: Record<SearchItem["kind"], string> = {
  sector: "bg-cyan-950/60 text-cyan-300 border-cyan-900/60",
  equity: "bg-amber-950/60 text-amber-300 border-amber-900/60",
  driver: "bg-violet-950/60 text-violet-300 border-violet-900/60",
};

export function HomeSearch({ items }: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchItem[] = [];
    for (const item of items) {
      if (
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q)
      ) {
        hits.push(item);
        if (hits.length >= 8) break;
      }
    }
    return hits;
  }, [items, query]);

  const showDropdown = focused && query.trim().length > 0;

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 focus-within:border-cyan-700">
        <span aria-hidden className="text-neutral-500">
          ⌕
        </span>
        <input
          type="text"
          placeholder="섹터, 종목, 드라이버 검색 (예: 삼성전자 · memory · HBM)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          // Delay so a click on a result still registers before the
          // dropdown blurs out from under the pointer.
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          className="flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-xs text-neutral-500 hover:text-neutral-300"
            aria-label="검색 지우기"
          >
            ✕
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-neutral-500">
              일치하는 결과 없음. 다른 단어로 시도해보세요.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-900">
              {results.map((item) => (
                <li key={`${item.kind}:${item.href}`}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-900"
                  >
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${KIND_TONE[item.kind]}`}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-neutral-100">
                        {item.label}
                      </div>
                      {item.hint && (
                        <div className="truncate text-xs text-neutral-500">
                          {item.hint}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
