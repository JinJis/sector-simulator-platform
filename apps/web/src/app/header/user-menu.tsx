"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOut, type CurrentUser } from "@/lib/sim-client";

interface Props {
  user: CurrentUser | null;
}

export function UserMenu({ user }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="text-xs text-neutral-300 hover:text-neutral-100"
        >
          로그인
        </Link>
        <Link
          href="/signup"
          className="rounded border border-cyan-700 bg-cyan-950/40 px-2.5 py-1 text-xs font-medium text-cyan-200 hover:bg-cyan-900/60"
        >
          가입하기
        </Link>
      </div>
    );
  }

  const initials = initialsFor(user.name || user.email);
  const display = user.name || user.email;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-1 py-1 pr-2.5 transition hover:border-neutral-700"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-700 text-[10px] font-semibold text-cyan-50">
          {initials}
        </span>
        <span className="hidden text-xs text-neutral-200 sm:inline">{display}</span>
        <span aria-hidden className="text-[10px] text-neutral-500">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-lg"
        >
          <div className="border-b border-neutral-800 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="truncate text-sm font-medium text-neutral-100">
                {display}
              </div>
              {user.tier === "premium" ? (
                <span className="rounded border border-amber-700/60 bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                  ★ Premium
                </span>
              ) : (
                <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-neutral-500">
                  Free
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-neutral-500">{user.email}</div>
          </div>
          <MenuLink href="/my-sectors" onClick={() => setOpen(false)}>
            🛠 내가 만든 시뮬레이터
          </MenuLink>
          <MenuLink href="/propose" onClick={() => setOpen(false)}>
            🤖 새 시뮬레이터 만들기
          </MenuLink>
          <MenuLink href="/watchlist" onClick={() => setOpen(false)}>
            ★ 관심 종목
          </MenuLink>
          <MenuLink
            href="/community/my-predictions"
            onClick={() => setOpen(false)}
          >
            🎯 내 예측 기록
          </MenuLink>
          <MenuLink href="/settings" onClick={() => setOpen(false)}>
            ⚙ 설정
          </MenuLink>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="block w-full px-3 py-2 text-left text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-rose-300 disabled:opacity-50"
          >
            {signingOut ? "로그아웃 중…" : "↪ 로그아웃"}
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block border-b border-neutral-900 px-3 py-2 text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-cyan-300"
    >
      {children}
    </Link>
  );
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+|[._@]/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
