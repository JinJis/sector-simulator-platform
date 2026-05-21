import Link from "next/link";

import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-50">가입하기</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Sector Simulator는 익명으로도 둘러볼 수 있지만, 가입하면 시나리오·그래프 편집 이력이 본인 명의로 기록됩니다.
      </p>
      <SignupForm />
      <p className="mt-6 text-center text-xs text-neutral-500">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className="text-cyan-400 hover:text-cyan-300">
          로그인
        </Link>
      </p>
    </main>
  );
}
