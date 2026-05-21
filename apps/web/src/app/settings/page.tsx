import { Breadcrumbs } from "@platform/ui";
import { redirect } from "next/navigation";

import { fetchMe } from "@/lib/sim-client";

import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await fetchMe();
  if (!user) {
    redirect("/login?redirect=/settings");
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Breadcrumbs className="mb-3" items={[{ label: "Settings" }]} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-50">설정</h1>
        <p className="mt-1 text-xs text-neutral-500">
          계정 정보, 환경설정, 보안. {user.email}
        </p>
      </header>
      <SettingsForm user={user} />
    </main>
  );
}
