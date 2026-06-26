/**
 * src/app/[studio_slug]/dashboard/settings/page.tsx
 *
 * Studio-level policy settings. Currently just the cancellation
 * window, the one configurable policy this build supports. Owner
 * only - see the role check delegated to /api/[studio_slug]/settings
 * for PATCH, and the layout-level minRole here for the page itself.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const settings = await db.studioSettings.findUnique({ where: { studioId: session.studioId } });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Cancellation policy
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Clients who cancel before this window closes get their credit refunded. Cancelling
          inside the window keeps the credit spent.
        </p>
        <SettingsForm
          studioSlug={studio_slug}
          isOwner={session.role === "owner"}
          initialHours={settings?.cancellationWindowHours ?? 12}
        />
      </section>
    </main>
  );
}
