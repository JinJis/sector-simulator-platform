"use client";

import { useActionState } from "react";

import { login, type LoginState } from "@/app/login/actions";

const INITIAL: LoginState = { ok: true };

export function LoginForm({
  next,
  disabled,
}: {
  next: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(login, INITIAL);
  const errorText = state.ok ? null : state.error;

  return (
    <form action={formAction} className="mt-5 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-xs text-neutral-300">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          autoFocus
          disabled={disabled || pending}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-300">
        Password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          disabled={disabled || pending}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
      {errorText ? (
        <p className="rounded border border-rose-800/60 bg-rose-950/30 px-2 py-1.5 text-[11px] text-rose-300">
          {errorText}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={disabled || pending}
        className="mt-1 rounded bg-rose-700 px-3 py-2 text-sm font-medium text-rose-50 hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
