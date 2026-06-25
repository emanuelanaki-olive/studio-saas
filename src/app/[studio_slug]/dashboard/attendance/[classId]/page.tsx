/**
 * src/app/[studio_slug]/dashboard/attendance/[classId]/page.tsx
 *
 * Roster for one class: every booked/waitlisted client, with
 * attended / no-show / cancel actions. The actual mutation buttons
 * are in AttendanceActions (client component).
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { AttendanceActions } from "./AttendanceActions";

const STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  attended: "Attended",
  no_show: "No show",
  cancelled: "Cancelled",
  late_cancelled: "Late cancelled",
  waitlist: "Waitlist",
};

const STATUS_TONE: Record<string, string> = {
  booked: "bg-teal-50 text-teal-800",
  attended: "bg-teal-50 text-teal-800",
  no_show: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
  late_cancelled: "bg-rose-50 text-rose-700",
  waitlist: "bg-amber-50 text-amber-800",
};

export default async function ClassAttendancePage({
  params,
}: {
  params: Promise<{ studio_slug: string; classId: string }>;
}) {
  const { studio_slug, classId } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const klass = await db.class.findUnique({
    where: { id: classId },
    include: {
      instructor: { select: { fullName: true } },
      bookings: {
        orderBy: { createdAt: "asc" },
        include: { client: { select: { id: true, fullName: true, email: true, phone: true } } },
      },
    },
  });

  if (!klass) {
    notFound();
  }

  const active = klass.bookings.filter((b) => b.status === "booked" || b.status === "attended");
  const waitlisted = klass.bookings.filter((b) => b.status === "waitlist");
  const other = klass.bookings.filter(
    (b) => !["booked", "attended", "waitlist"].includes(b.status)
  );

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{klass.title}</h1>
      <p className="text-sm text-slate-500">
        {klass.startTime.toLocaleString()}
        {klass.instructor && <> - {klass.instructor.fullName}</>}
        {" "}- {active.length}/{klass.capacity} booked
      </p>

      <RosterSection title="Roster" bookings={active} studioSlug={studio_slug} />
      {waitlisted.length > 0 && (
        <RosterSection title="Waitlist" bookings={waitlisted} studioSlug={studio_slug} />
      )}
      {other.length > 0 && (
        <RosterSection title="Cancelled / no-show" bookings={other} studioSlug={studio_slug} />
      )}
    </main>
  );
}

interface BookingRow {
  id: string;
  status: string;
  client: { id: string; fullName: string; email: string; phone: string | null };
}

function RosterSection({
  title,
  bookings,
  studioSlug,
}: {
  title: string;
  bookings: BookingRow[];
  studioSlug: string;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {bookings.map((b) => (
          <div key={b.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-slate-900">{b.client.fullName}</p>
              <p className="text-xs text-slate-400">{b.client.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[b.status] ?? "bg-slate-100 text-slate-500"}`}
              >
                {STATUS_LABEL[b.status] ?? b.status}
              </span>
              <AttendanceActions studioSlug={studioSlug} bookingId={b.id} status={b.status} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
