/**
 * src/app/[studio_slug]/dashboard/page.tsx
 *
 * Owner/staff dashboard shell. Demonstrates the pattern every
 * tenant-scoped Server Component should follow:
 *   1. requireStudioAccessForPage() to resolve + verify the session
 *      (redirects to /login automatically if not signed in)
 *   2. getTenantDb(studioId) for any reads
 *
 * The three dashboard sub-features from the spec (CRM, scheduler,
 * attendance) are split into their own components so each can be
 * fleshed out independently; this page just lays out the shell.
 */

import { requireStudioAccessForPage } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { LogoutButton } from "@/components/LogoutButton";
import Link from "next/link";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccessForPage({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const [clientCount, upcomingClassCount, activeMembershipCount] = await Promise.all([
    db.user.count({ where: { role: "client" } }),
    db.class.count({ where: { startTime: { gte: new Date() } } }),
    db.membership.count({ where: { status: "active" } }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          {studio_slug} — Dashboard
        </h1>
        <LogoutButton />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Active clients" value={clientCount} />
        <StatCard label="Upcoming classes" value={upcomingClassCount} />
        <StatCard label="Active memberships" value={activeMembershipCount} />
      </div>

      <nav className="mt-8 flex gap-4 text-sm font-medium text-blue-700">
        <Link href={`/${studio_slug}/dashboard/clients`}>Clients (CRM)</Link>
        <Link href={`/${studio_slug}/dashboard/schedule`}>Schedule</Link>
        <Link href={`/${studio_slug}/dashboard/attendance`}>Attendance</Link>
      </nav>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
