"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useT } from "@/lib/i18n/provider";
import { signIn } from "@/lib/sim-client";

interface Props {
  /** Where to send the user after a successful sign-in. */
  redirect: string;
}

export function LoginForm({ redirect }: Props) {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn({ email, password });
      router.push(redirect);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.login.fail"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field
        label={t("auth.email")}
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        required
      />
      <Field
        label={t("auth.password")}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        required
      />
      {error && (
        <p className="rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? t("auth.login.submitting") : t("auth.login.cta")}
      </button>
    </form>
  );
}

function Field({
  label,
  type,
  autoComplete,
  value,
  onChange,
  required,
  minLength,
}: {
  label: string;
  type: string;
  autoComplete?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <input
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-700 focus:outline-none"
      />
    </label>
  );
}
