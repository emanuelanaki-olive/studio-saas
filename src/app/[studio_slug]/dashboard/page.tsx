/**
 * src/app/[studio_slug]/dashboard/page.tsx
 *
 * Dashboard overview. Auth and the sidebar nav are handled by
 * layout.tsx now, so this page is just the stat cards and a few
 * quick links into the busiest sub-pages.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import Link from "next/link";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const [clientCount, upcomingClassCount, activeMembershipCount, upcomingAppointmentCount] =
    await Promise.all([
      db.user.count({ where: { role: "client" } }),
      db.class.count({ where: { startTime: { gte: new Date() } } }),
      db.membership.count({ where: { status: "active" } }),
      db.appointment.count({ where: { startTime: { gte: new Date() }, status: "booked" } }),
    ]);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active clients" value={clientCount} />
        <StatCard label="Upcoming classes" value={upcomingClassCount} />
        <StatCard label="Upcoming appointments" value={upcomingAppointmentCount} />
        <StatCard label="Active memberships" value={activeMembershipCount} />
      </div>

      <div className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Quick links
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <QuickLink href={`/${studio_slug}/dashboard/clients`} label="View clients" />
          <QuickLink href={`/${studio_slug}/dashboard/schedule`} label="Manage schedule" />
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800"
    >
      {label}
    </Link>
  );
}
