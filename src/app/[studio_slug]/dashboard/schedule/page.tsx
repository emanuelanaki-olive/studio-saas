/**
 * src/app/[studio_slug]/dashboard/schedule/page.tsx
 *
 * Schedule management: list of upcoming classes with capacity/booked
 * counts, plus a form to create new ones. Appointments (Track B)
 * have their own simpler list further down, since they are
 * inherently per-provider and don't need the same capacity view.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { CreateClassButton } from "./CreateClassButton";
import { ClassRow } from "./ClassRow";

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const [classes, instructors] = await Promise.all([
    db.class.findMany({
      where: { startTime: { gte: new Date() } },
      include: {
        instructor: { select: { id: true, fullName: true } },
        bookings: {
          where: { status: { in: ["booked", "attended"] } },
          select: { id: true },
        },
      },
      orderBy: { startTime: "asc" },
      take: 30,
    }),
    db.user.findMany({
      where: { role: { in: ["staff", "owner"] } },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Schedule</h1>
        <CreateClassButton studioSlug={studio_slug} instructors={instructors} />
      </div>

      <div className="mt-6 space-y-2">
        {classes.map((klass) => (
          <ClassRow
            key={klass.id}
            studioSlug={studio_slug}
            classData={{
              id: klass.id,
              title: klass.title,
              startTime: klass.startTime,
              endTime: klass.endTime,
              capacity: klass.capacity,
              bookedCount: klass.bookings.length,
              instructorName: klass.instructor?.fullName ?? null,
            }}
          />
        ))}
        {classes.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
            No upcoming classes. Create your first one to get started.
          </p>
        )}
      </div>
    </main>
  );
}
