import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login/LoginForm";
import {
  ADMIN_SESSION_COOKIE,
  adminAuthConfig,
  verifySession,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

interface PageProps {
  // Next.js 15: searchParams is async.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const nextRaw = sp.next;
  const next = typeof nextRaw === "string" ? nextRaw : "/";

  // If already logged in, bounce straight through.
  const store = await cookies();
  const cookieValue = store.get(ADMIN_SESSION_COOKIE)?.value;
  const email = await verifySession(cookieValue);
  if (email) {
    redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  const cfg = adminAuthConfig();

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-6 py-8 shadow-lg">
        <h1 className="text-lg font-semibold text-neutral-50">Admin login</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Sector Simulator Platform — admin console (`apps/admin`).
        </p>

        {cfg.configured ? null : (
          <div className="mt-4 rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-200">
            Admin login is not configured. Missing env vars:{" "}
            <code className="font-mono text-[11px] text-amber-300">
              {cfg.missing.join(", ")}
            </code>
            . Set them in <code className="font-mono text-[11px]">.env</code> and
            restart the container.
          </div>
        )}

        <LoginForm next={next} disabled={!cfg.configured} />

        <p className="mt-6 text-[10px] text-neutral-600">
          Credentials are read from <code className="font-mono">ADMIN_EMAIL</code>{" "}
          / <code className="font-mono">ADMIN_PASSWORD</code> in your{" "}
          <code className="font-mono">.env</code>. Sessions are signed with{" "}
          <code className="font-mono">ADMIN_SESSION_SECRET</code>; rotate it to
          invalidate everything.
        </p>
      </div>
    </main>
  );
}
