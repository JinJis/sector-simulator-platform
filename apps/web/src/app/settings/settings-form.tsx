"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  changePassword,
  updateMe,
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
            hint="이메일 변경은 별도 절차 — Phase 4에서 지원 예정"
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

      <section className="rounded-lg border border-amber-900/40 bg-gradient-to-r from-amber-950/30 via-neutral-950 to-neutral-950 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="mb-1 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wider text-amber-300">
              <span>현재 플랜</span>
              {user.tier === "premium" ? (
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
              {user.tier === "premium"
                ? "Premium 사용 중 — 에이전트 시뮬레이터 생성, 우선 응답, 추후 추가 기능을 모두 이용할 수 있습니다."
                : "Free 플랜은 기본 섹터(메모리·우주·SOFC)를 모두 탐색할 수 있습니다. 에이전트로 직접 시뮬레이터를 만들 수 있는 기능은 베타 기간 모두에게 무료로 열려 있으며, 정식 출시 후 Premium 전용으로 전환됩니다."}
            </p>
          </div>
          {user.tier !== "premium" && (
            <button
              type="button"
              onClick={() =>
                alert(
                  "Premium 정식 출시 시 결제 페이지가 열립니다. 베타 기간에는 모든 기능이 이미 무료로 풀려 있습니다.",
                )
              }
              className="shrink-0 rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-800/60"
            >
              ★ Premium 업그레이드
            </button>
          )}
        </div>
      </section>

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
          계정 삭제는 현재 수동 절차입니다 — 관리자에게 문의해 주세요. 자가 삭제는 Phase 4에서 활성화됩니다.
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
