"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLocale } from "@/lib/i18n/provider";
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
import { useTheme } from "@/lib/theme-provider";

interface Props {
  user: CurrentUser;
}

// Bumped to v2 alongside the M23 onboarding rewrite. Clearing the new
// key forces the new value-demo tour to replay; the old v1 key is left
// alone since the new modal doesn't read it.
const ONBOARD_KEY = "sss_onboard_v2";

export function SettingsForm({ user }: Props) {
  const router = useRouter();
  const { locale, setLocale: setLocaleClient, t } = useLocale();
  const { theme, setTheme: setThemeClient } = useTheme();

  // Profile
  const [name, setName] = useState(user.name ?? "");
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Apply theme / locale changes IMMEDIATELY (provider writes cookie +
  // DOM class), then sync to the DB on Save so the choice survives
  // cross-device. Live-apply makes the toggle feel responsive instead
  // of waiting for a Save round-trip.
  function pickLocale(next: "ko" | "en") {
    setLocaleClient(next);
  }
  function pickTheme(next: "dark" | "light" | "system") {
    setThemeClient(next);
  }

  async function onSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileStatus(t("settings.save"));
    setProfileError(null);
    try {
      await updateMe({
        name: name.trim() || null,
        locale,
        theme,
      });
      setProfileStatus(`✓ ${t("settings.savedOk")}`);
      router.refresh();
    } catch (err) {
      setProfileStatus(null);
      setProfileError(err instanceof Error ? err.message : "Save failed");
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
    setPwStatus(t("settings.changing"));
    if (newPw.length < 8) {
      setPwStatus(null);
      setPwError(t("settings.newPwTooShort"));
      return;
    }
    try {
      await changePassword({
        current_password: currentPw,
        new_password: newPw,
      });
      setCurrentPw("");
      setNewPw("");
      setPwStatus(t("settings.changeOk"));
    } catch (err) {
      setPwStatus(null);
      setPwError(err instanceof Error ? err.message : t("settings.changeFail"));
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
          {t("settings.profile")}
        </h2>
        <form onSubmit={onSaveProfile} className="flex flex-col gap-3">
          <Field
            label={t("settings.email")}
            value={user.email}
            disabled
            hint={t("settings.emailHint")}
          />
          <Field
            label={t("settings.name")}
            value={name}
            onChange={setName}
            placeholder={user.email.split("@")[0]}
          />
          <SelectField
            label={t("settings.locale")}
            value={locale}
            onChange={(v) => pickLocale(v as "ko" | "en")}
            options={[
              { value: "ko", label: "한국어" },
              { value: "en", label: "English" },
            ]}
            hint={t("settings.localeHint")}
          />
          <SelectField
            label={t("settings.theme")}
            value={theme}
            onChange={(v) => pickTheme(v as "dark" | "light" | "system")}
            options={[
              { value: "dark", label: t("settings.themeDark") },
              { value: "light", label: t("settings.themeLight") },
              { value: "system", label: t("settings.themeSystem") },
            ]}
            hint={t("settings.themeHint")}
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
            >
              {t("settings.save")}
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
          {t("settings.passwordSection")}
        </h2>
        <form onSubmit={onChangePassword} className="flex flex-col gap-3">
          <Field
            label={t("settings.currentPw")}
            type="password"
            value={currentPw}
            onChange={setCurrentPw}
            autoComplete="current-password"
            required
          />
          <Field
            label={t("settings.newPw")}
            type="password"
            value={newPw}
            onChange={setNewPw}
            autoComplete="new-password"
            required
            minLength={8}
            hint={t("settings.newPwHint")}
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-500"
            >
              {t("settings.changeCta")}
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
          {t("settings.appSection")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={replayOnboarding}
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:border-cyan-700 hover:text-cyan-200"
          >
            {t("settings.replayOnboarding")}
          </button>
          <p className="text-[11px] text-neutral-500">
            {t("settings.replayHint")}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-rose-400">
          {t("settings.dangerSection")}
        </h2>
        <p className="text-[11px] text-neutral-500">
          {t("settings.dangerHint")}
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
  const { t } = useLocale();
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
      setError(e instanceof Error ? e.message : t("settings.checkoutStartFail"));
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
      setError(e instanceof Error ? e.message : t("settings.portalOpenFail"));
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
            <span>{t("settings.currentPlan")}</span>
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
                {t("settings.premiumActiveRenew")}{" "}
                {sub?.current_period_end
                  ? new Date(sub.current_period_end).toISOString().slice(0, 10)
                  : "—"}
                {sub?.cancel_at_period_end ? t("settings.willCancel") : ""}.
              </>
            ) : betaFree ? (
              t("settings.freePlanBetaHint")
            ) : (
              t("settings.freePlanNonBeta")
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
              {busy === "portal" ? t("settings.opening") : t("settings.managePayment")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onCheckout}
              disabled={busy === "checkout"}
              title={
                stripeReady
                  ? t("settings.checkoutHintReady")
                  : t("settings.checkoutHintNotConfigured")
              }
              className="rounded border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-800/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "checkout"
                ? t("settings.openingCheckout")
                : stripeReady
                  ? t("settings.upgradePremium")
                  : t("settings.premiumFreeBeta")}
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
  const { t } = useLocale();
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
          {t("settings.monthlyAgentUsage")}
        </h2>
        <p className="text-[11px] text-neutral-500">{t("settings.usageLoading")}</p>
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
        <span>{t("settings.monthlyAgentUsage")}</span>
        <span className="text-[10px] text-neutral-500 normal-case">
          {budget.tier === "premium" ? t("settings.premiumQuota") : t("settings.freeQuota")}
        </span>
      </h2>
      {limit > 0 ? (
        <>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className={exhausted ? "text-rose-400" : "text-neutral-300"}>
              ${used.toFixed(2)} / ${limit.toFixed(2)} USD
            </span>
            <span className="text-[11px] text-neutral-500">
              {t("settings.remaining")} ${budget.remaining_usd.toFixed(2)}
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
          {t("settings.betaMessage")}${" "}
          {(budget.limit_usd > 0 ? budget.limit_usd : 20).toFixed(0)}
          {t("settings.afterRelease")}
        </p>
      ) : (
        <p className="text-[11px] text-neutral-500">
          {t("settings.freeNoAgent")}
        </p>
      )}
      <p className="mt-2 text-[10px] text-neutral-600">
        {t("settings.concurrentLimit")}: {budget.concurrent_limit} · {t("settings.currentlyRunning")}{" "}
        {budget.in_flight}
      </p>
      {user.tier !== "premium" && !betaFree && limit === 0 && (
        <p className="mt-2 text-[10px] text-amber-400">
          {t("settings.unlockAgentByUpgrade")}
        </p>
      )}
    </section>
  );
}
