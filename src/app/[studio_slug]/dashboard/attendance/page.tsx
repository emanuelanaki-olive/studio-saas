/**
 * src/app/[studio_slug]/dashboard/attendance/page.tsx
 *
 * Attendance overview: today's classes first (the ones staff
 * actually need to mark attendance for right now), then upcoming
 * ones. Each links to the per-class roster page.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import Link from "next/link";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);

  const [todayClasses, upcomingClasses] = await Promise.all([
    db.class.findMany({
      where: { startTime: { gte: startOfToday, lte: endOfToday } },
      include: { _count: { select: { bookings: true } } },
      orderBy: { startTime: "asc" },
    }),
    db.class.findMany({
      where: { startTime: { gt: endOfToday } },
      include: { _count: { select: { bookings: true } } },
      orderBy: { startTime: "asc" },
      take: 15,
    }),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Attendance</h1>

      <h2 className="mt-6 text-sm font-medium uppercase tracking-wide text-slate-400">Today</h2>
      <div className="mt-2 space-y-2">
        {todayClasses.map((c) => (
          <AttendanceRow key={c.id} studioSlug={studio_slug} klass={c} />
        ))}
        {todayClasses.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            No classes today.
          </p>
        )}
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-slate-400">
        Upcoming
      </h2>
      <div className="mt-2 space-y-2">
        {upcomingClasses.map((c) => (
          <AttendanceRow key={c.id} studioSlug={studio_slug} klass={c} />
        ))}
      </div>
    </main>
  );
}

function AttendanceRow({
  studioSlug,
  klass,
}: {
  studioSlug: string;
  klass: { id: string; title: string; startTime: Date; capacity: number; _count: { bookings: number } };
}) {
  return (
    <Link
      href={`/${studioSlug}/dashboard/attendance/${klass.id}`}
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-teal-200"
    >
      <div>
        <p className="font-medium text-slate-900">{klass.title}</p>
        <p className="text-xs text-slate-400">
          {klass.startTime.toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>
      <span className="text-sm text-slate-500">
        {klass._count.bookings}/{klass.capacity}
      </span>
    </Link>
  );
}
