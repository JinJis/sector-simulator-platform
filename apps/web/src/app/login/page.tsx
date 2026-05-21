import Link from "next/link";

import { LoginForm } from "./login-form";

interface SearchParams {
  redirect?: string;
}

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { redirect } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-50">로그인</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Sector Simulator 계정으로 로그인하세요.
      </p>
      <LoginForm redirect={redirect && redirect.startsWith("/") ? redirect : "/"} />
      <p className="mt-6 text-center text-xs text-neutral-500">
        아직 계정이 없으신가요?{" "}
        <Link href="/signup" className="text-cyan-400 hover:text-cyan-300">
          가입하기
        </Link>
      </p>
    </main>
  );
}
