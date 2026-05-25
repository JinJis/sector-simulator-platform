import Link from "next/link";

import { getT } from "@/lib/i18n/server";

import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-50">
        {t("auth.signup.title")}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        {t("auth.signup.subtitle")}
      </p>
      <SignupForm />
      <p className="mt-6 text-center text-xs text-neutral-500">
        {t("auth.signup.haveAccount")}{" "}
        <Link href="/login" className="text-cyan-400 hover:text-cyan-300">
          {t("auth.signup.loginLink")}
        </Link>
      </p>
    </main>
  );
}
