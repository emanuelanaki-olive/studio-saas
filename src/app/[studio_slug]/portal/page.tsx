/**
 * src/app/[studio_slug]/portal/page.tsx
 *
 * Client-facing, mobile-first schedule view. Shows upcoming classes
 * for this studio, with a Book / Join Waitlist button per class.
 * The actual booking submission is a client component (see
 * BookClassButton) since it needs interactivity (fetch + optimistic
 * UI), while the data fetch itself stays server-side for speed and
 * to avoid exposing the tenant DB to the browser.
 */

import { requireStudioAccessForPage } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { BookClassButton } from "./BookClassButton";
import { LogoutButton } from "@/components/LogoutButton";

export default async function PortalPage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccessForPage();
  const db = getTenantDb(session.studioId);

  const upcomingClasses = await db.class.findMany({
    where: { startTime: { gte: new Date() } },
    include: {
      instructor: { select: { fullName: true } },
      bookings: {
        where: { status: { in: ["booked", "attended"] } },
        select: { id: true, clientId: true },
      },
    },
    orderBy: { startTime: "asc" },
    take: 20,
  });

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Upcoming Classes</h1>
        <LogoutButton />
      </div>
      <ul className="mt-4 space-y-3">
        {upcomingClasses.map((klass) => {
          const spotsLeft = klass.capacity - klass.bookings.length;
          const alreadyBooked = klass.bookings.some((b) => b.clientId === session.userId);

          return (
            <li
              key={klass.id}
              className="rounded-lg border border-slate-200 p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-slate-900">{klass.title}</p>
                <p className="text-sm text-slate-500">
                  {klass.startTime.toLocaleString()} · {klass.instructor?.fullName ?? "TBD"}
                </p>
                <p className="text-xs text-slate-400">
                  {spotsLeft > 0 ? `${spotsLeft} spots left` : "Full — waitlist available"}
                </p>
              </div>
              <BookClassButton
                studioSlug={studio_slug}
                classId={klass.id}
                alreadyBooked={alreadyBooked}
                isFull={spotsLeft <= 0}
              />
            </li>
          );
        })}
      </ul>
    </main>
  );
}
