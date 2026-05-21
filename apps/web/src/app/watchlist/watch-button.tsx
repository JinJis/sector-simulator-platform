"use client";

import { useEffect, useState } from "react";

import {
  addToWatchlist,
  checkIsWatched,
  fetchMe,
  removeFromWatchlist,
  type CurrentUser,
} from "@/lib/sim-client";

interface Props {
  equityId: string;
  /** Compact mode hides the label, keeps just the star — for table rows. */
  compact?: boolean;
}

/**
 * Star button that toggles a stock's watchlist membership.
 *
 * Optimistic: flips state immediately on click and rolls back if the
 * mutation fails. Initial state is fetched once on mount via
 * `watchlist.isWatched`; the result also seeds the optimistic checks
 * across re-renders so we don't burn an extra query per row in tables.
 *
 * Anonymous users get a tooltip prompting sign-in rather than a
 * disabled button — keeps the call to action obvious.
 */
export function WatchButton({ equityId, compact }: Props) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [userResolved, setUserResolved] = useState(false);
  const [watched, setWatched] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve user once per WatchButton instance. checkIsWatched is
  // cheap enough that the per-row fetch is fine at the 49-equity
  // scale; if a future page renders 1000s of these we'll lift the
  // fetch to a context provider.
  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((u) => {
      if (cancelled) return;
      setUser(u);
      setUserResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!userResolved) return;
    if (!user) {
      setWatched(null);
      return;
    }
    void checkIsWatched(equityId)
      .then((r) => {
        if (!cancelled) setWatched(r.watched);
      })
      .catch(() => {
        if (!cancelled) setWatched(false);
      });
    return () => {
      cancelled = true;
    };
  }, [equityId, user, userResolved]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      // Drop the user into /login with a redirect back to where they
      // were trying to watch from.
      const redirect = encodeURIComponent(window.location.pathname);
      window.location.href = `/login?redirect=${redirect}`;
      return;
    }
    if (busy) return;
    const next = !watched;
    setWatched(next);
    setBusy(true);
    setError(null);
    try {
      if (next) {
        await addToWatchlist({ equity_id: equityId });
      } else {
        await removeFromWatchlist(equityId);
      }
    } catch (err) {
      setWatched(!next); // rollback
      setError(err instanceof Error ? err.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  // Show a slim non-functional pill while user / watched state is
  // still resolving, so the button doesn't "pop" from unset → set.
  if (!userResolved || (user && watched === null)) {
    return (
      <button
        type="button"
        disabled
        className={`inline-flex items-center gap-1 rounded border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 ${compact ? "" : "min-w-[88px] justify-center"}`}
      >
        ☆
      </button>
    );
  }

  const active = !!watched;
  const tone = active
    ? "border-amber-700/70 bg-amber-950/40 text-amber-300 hover:bg-amber-900/60"
    : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-amber-700 hover:text-amber-300";
  const label = active ? "★ 관심" : "☆ 관심 등록";
  const title = !user
    ? "관심 종목 등록은 로그인 후 가능합니다."
    : active
      ? "관심 종목에서 제거"
      : "관심 종목에 추가";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={title}
      aria-pressed={active}
      aria-label={title}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${tone} ${compact ? "" : "min-w-[88px] justify-center"}`}
    >
      {compact ? (active ? "★" : "☆") : label}
      {error && <span className="ml-1 text-rose-400">!</span>}
    </button>
  );
}
