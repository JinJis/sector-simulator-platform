"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { signUp } from "@/lib/sim-client";

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    setSubmitting(true);
    try {
      await signUp({
        email,
        password,
        name: name.trim() || undefined,
      });
      router.push("/?onboard=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "가입 실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field
        label="이름 (선택)"
        type="text"
        autoComplete="name"
        value={name}
        onChange={setName}
        placeholder="홍길동"
      />
      <Field
        label="이메일"
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        required
      />
      <Field
        label="비밀번호"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        required
        minLength={8}
        hint="8자 이상"
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
        {submitting ? "가입 중…" : "가입하기"}
      </button>
      <p className="mt-1 text-[11px] text-neutral-600">
        가입하면 이용 약관과 개인정보 처리방침에 동의하는 것으로 간주됩니다. (현재 약관은 작성 중)
      </p>
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
  placeholder,
  hint,
}: {
  label: string;
  type: string;
  autoComplete?: string;
  value: string;
  onChange: (v: string) => void;
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
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-700 focus:outline-none"
      />
    </label>
  );
}
