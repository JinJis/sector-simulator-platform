"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  changePassword,
  fetchAgentBudget,
  fetchBillingStatus,
  fetchMySubscription,
  openBillingPortal,
  startCheckout,
  updateMe,
  type AgentBudget,
  type BillingStatus,
  type BillingSubscription,
  type CurrentUser,
} from "@/lib/sim-client";

interface Props {
  user: CurrentUser;
}

// Bumped to v2 alongside the M23 onboarding rewrite. Clearing the new
// key forces the new value-demo tour to replay; the old v1 key is left
// alone since the new modal doesn't read it.
const ONBOARD_KEY = "sss_onboard_v2";

export function SettingsForm({ user }: Props) {
  const router = useRouter();

  // Profile
  const [name, setName] = useState(user.name ?? "");
  const [locale, setLocale] = useState<"ko" | "en">(
    (user.locale as "ko" | "en") ?? "ko",
  );
  const [theme, setTheme] = useState<"dark" | "light" | "system">(
    (user.theme as "dark" | "light" | "system") ?? "dark",
  );
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  async function onSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileStatus("저장 중…");
    setProfileError(null);
    try {
      await updateMe({
        name: name.trim() || null,
        locale,
        theme,
      });
      setProfileStatus("✓ 저장됨");
      router.refresh();
    } catch (err) {
      setProfileStatus(null);
      setProfileError(err instanceof Error ? err.message : "저장 실패");
    }
  }

  // Password
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  async function onChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwError(null);
    setPwStatus("변경 중…");
    if (newPw.length < 8) {
      setPwStatus(null);
      setPwError("새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    try {
      await changePassword({
        current_password: currentPw,
        new_password: newPw,
      });
      setCurrentPw("");
      setNewPw("");
      setPwStatus("✓ 변경됨 — 다른 디바이스의 세션은 모두 만료되었습니다.");
    } catch (err) {
      setPwStatus(null);
      setPwError(err instanceof Error ? err.message : "변경 실패");
    }
  }

  function replayOnboarding() {
    try {
      window.localStorage.removeItem(ONBOARD_KEY);
    } catch {
      // ignore
    }
    router.push("/?onboard=1");
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          프로필
        </h2>
        <form onSubmit={onSaveProfile} className="flex flex-col gap-3">
          <Field
            label="이메일"
            value={user.email}
            disabled
            hint="이메일 변경은 별도 절차 — 추후 지원 예정"
          />
          <Field
            label="이름"
            value={name}
            onChange={setName}
            placeholder={user.email.split("@")[0]}
          />
          <SelectField
            label="언어 / Locale"
            value={locale}
            onChange={(v) => setLocale(v as "ko" | "en")}
            options={[
              { value: "ko", label: "한국어" },
              { value: "en", label: "English" },
            ]}
            hint="UI 다국어는 후속 슬라이스에서 적용됩니다."
          />
          <SelectField
            label="테마"
            value={theme}
            onChange={(v) => setTheme(v as "dark" | "light" | "system")}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ]}
            hint="현재는 Dark만 렌더링됩니다 — 선호도만 저장."
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
            >
              저장
            </button>
            {profileStatus && (
              <span className="text-[11px] text-emerald-400">{profileStatus}</span>
            )}
            {profileError && (
              <span className="text-[11px] text-rose-400">{profileError}</span>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          비밀번호 변경
        </h2>
        <form onSubmit={onChangePassword} className="flex flex-col gap-3">
          <Field
            label="현재 비밀번호"
            type="password"
            value={currentPw}
            onChange={setCurrentPw}
            autoComplete="current-password"
            required
          />
          <Field
            label="새 비밀번호"
            type="password"
            value={newPw}
            onChange={setNewPw}
            autoComplete="new-password"
            required
            minLength={8}
            hint="8자 이상"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
            >
              변경
            </button>
            {pwStatus && (
              <span className="text-[11px] text-emerald-400">{pwStatus}</span>
            )}
            {pwError && <span className="text-[11px] text-rose-400">{pwError}</span>}
          </div>
        </form>
      </section>

      <PremiumSection user={user} />
      <BudgetMeterSection user={user} />

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          앱
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={replayOnboarding}
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:border-cyan-700 hover:text-cyan-200"
          >
            ↻ 온보딩 다시 보기
          </button>
          <p className="text-[11px] text-neutral-500">
            플랫폼의 핵심 4-5개 페이지를 다시 안내합니다.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-rose-400">
          위험 구역
        </h2>
        <p className="text-[11px] text-neutral-500">
          계정 삭제는 현재 수동 절차입니다 — 관리자에게 문의해 주세요. 자가 삭제는 추후 활성화됩니다.
        </p>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  autoComplete,
  required,
  minLength,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2 text-[11px] uppercase tracking-wider text-neutral-500">
        {label}
        {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
      </span>
      <input
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2 text-[11px] uppercase tracking-wider text-neutral-500">
        {label}
        {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PremiumSection({ user }: { user: CurrentUser }) {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [sub, setSub] = useState<BillingSubscription>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBillingStatus(), fetchMySubscription()])
      .then(([b, s]) => {
        if (cancelled) return;
        setBilling(b);
        setSub(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCheckout() {
    setBusy("checkout");
    setError(null);
    try {
      const { url } = await startCheckout();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제 시작 실패");
      setBusy(null);
    }
  }

  async function onPortal() {
    setBusy("portal");
    setError(null);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Portal 열기 실패");
      setBusy(null);
    }
  }

  const premium = user.tier === "premium";
  const stripeReady = billing?.configured ?? false;
  const betaFree = billing?.beta_free ?? true;

  return (
    <section className="rounded-lg border border-amber-900/40 bg-gradient-to-r from-amber-950/30 via-neutral-950 to-neutral-950 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="mb-1 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wider text-amber-300">
            <span>현재 플랜</span>
            {premium ? (
              <span className="rounded border border-amber-700/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                ★ Premium
              </span>
            ) : (
              <span className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-400">
                Free
              </span>
            )}
          </h2>
          <p className="text-[11px] leading-relaxed text-neutral-400">
            {premium ? (
              <>
                Premium 사용 중. 다음 갱신일{" "}
                {sub?.current_period_end
                  ? new Date(sub.current_period_end).toISOString().slice(0, 10)
                  : "—"}
                {sub?.cancel_at_period_end ? " (다음 갱신일에 해지 예정)" : ""}.
              </>
            ) : betaFree ? (
              "Free 플랜은 기본 섹터(메모리·우주·SOFC)를 모두 탐색할 수 있습니다. 에이전트로 직접 시뮬레이터를 만들 수 있는 기능은 베타 기간 모두에게 무료로 열려 있으며, 정식 출시 후 Premium 전용으로 전환됩니다."
            ) : (
              "에이전트로 시뮬레이터를 직접 만들고, 우선 응답과 더 많은 월별 사용량을 받으려면 Premium으로 업그레이드해 주세요."
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {premium ? (
            <button
              type="button"
              onClick={onPortal}
              disabled={busy === "portal"}
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-800/60 disabled:opacity-50"
            >
              {busy === "portal" ? "여는 중…" : "결제 관리"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCheckout}
              disabled={busy === "checkout"}
              title={
                stripeReady
                  ? "Stripe Checkout 으로 이동"
                  : "결제 시스템이 구성되지 않았습니다. 베타 동안 무료로 사용해 주세요."
              }
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-800/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "checkout"
                ? "결제 페이지 여는 중…"
                : stripeReady
                  ? "★ Premium 업그레이드"
                  : "★ Premium (베타 중 무료)"}
            </button>
          )}
          {error && (
            <span className="text-[10px] text-rose-400">{error}</span>
          )}
        </div>
      </div>
    </section>
  );
}

function BudgetMeterSection({ user }: { user: CurrentUser }) {
  const [budget, setBudget] = useState<AgentBudget | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAgentBudget()
      .then((b) => {
        if (!cancelled) setBudget(b);
      })
      .catch(() => {
        if (!cancelled) setBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!budget) {
    return (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-300">
          이번 달 에이전트 사용량
        </h2>
        <p className="text-[11px] text-neutral-500">불러오는 중…</p>
      </section>
    );
  }

  const limit = budget.limit_usd;
  const used = budget.used_usd;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const exhausted = budget.exhausted;
  const betaFree = budget.beta_free;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold uppercase tracking-wider text-neutral-300">
        <span>이번 달 에이전트 사용량</span>
        <span className="text-[10px] text-neutral-500 normal-case">
          {budget.tier === "premium" ? "★ Premium 한도" : "Free 한도"}
        </span>
      </h2>
      {limit > 0 ? (
        <>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className={exhausted ? "text-rose-400" : "text-neutral-300"}>
              ${used.toFixed(2)} / ${limit.toFixed(2)} USD
            </span>
            <span className="text-[11px] text-neutral-500">
              남은 한도 ${budget.remaining_usd.toFixed(2)}
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded bg-neutral-950">
            <div
              className={`absolute left-0 top-0 h-2 ${
                exhausted ? "bg-rose-500" : pct > 80 ? "bg-amber-500" : "bg-cyan-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      ) : betaFree ? (
        <p className="rounded border border-cyan-900/40 bg-cyan-950/20 px-3 py-2 text-[11px] text-cyan-200">
          🎁 베타 기간 — 에이전트 시뮬레이터 생성이 모두에게 무료로 열려 있습니다.
          정식 출시 후엔 Premium 사용자에게 매월 ${" "}
          {(budget.limit_usd > 0 ? budget.limit_usd : 20).toFixed(0)} 한도가 부여됩니다.
        </p>
      ) : (
        <p className="text-[11px] text-neutral-500">
          Free 플랜에서는 에이전트 시뮬레이터 생성이 제공되지 않습니다.
          Premium으로 업그레이드하면 매월 사용량 한도가 부여됩니다.
        </p>
      )}
      <p className="mt-2 text-[10px] text-neutral-600">
        동시 실행 한도: {budget.concurrent_limit}개 · 현재 실행 중{" "}
        {budget.in_flight}개
      </p>
      {user.tier !== "premium" && !betaFree && limit === 0 && (
        <p className="mt-2 text-[10px] text-amber-400">
          ★ Premium 업그레이드로 에이전트 기능을 풀어보세요.
        </p>
      )}
    </section>
  );
}
