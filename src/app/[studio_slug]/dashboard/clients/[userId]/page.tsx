/**
 * src/app/[studio_slug]/dashboard/clients/[userId]/page.tsx
 *
 * Client detail / CRM profile page. Shows contact info, health
 * declaration, membership history, and recent bookings. Editing is
 * handled by ClientEditForm (client component) and
 * MembershipActions (freeze/unfreeze/cancel buttons).
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { MembershipPill } from "@/components/MembershipPill";
import { ClientEditForm } from "./ClientEditForm";
import { MembershipActions } from "./MembershipActions";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ studio_slug: string; userId: string }>;
}) {
  const { studio_slug, userId } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const client = await db.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { orderBy: { createdAt: "desc" } },
      bookings: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { class: { select: { title: true, startTime: true } } },
      },
    },
  });

  if (!client || client.role !== "client") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">{client.fullName}</h1>
      <p className="text-sm text-slate-500">{client.email}</p>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Profile</h2>
        <ClientEditForm studioSlug={studio_slug} client={client} />
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Memberships
        </h2>
        <div className="mt-3 space-y-3">
          {client.memberships.length === 0 && (
            <p className="text-sm text-slate-400">No memberships yet.</p>
          )}
          {client.memberships.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-md border border-slate-100 p-3"
            >
              <div>
                <MembershipPill membership={m} />
                {m.expiresAt && (
                  <p className="mt-1 text-xs text-slate-400">
                    Expires {m.expiresAt.toLocaleDateString()}
                  </p>
                )}
              </div>
              <MembershipActions studioSlug={studio_slug} membership={m} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Recent bookings
        </h2>
        <div className="mt-3 divide-y divide-slate-100">
          {client.bookings.length === 0 && (
            <p className="py-3 text-sm text-slate-400">No bookings yet.</p>
          )}
          {client.bookings.map((b) => (
            <div key={b.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <p className="font-medium text-slate-900">{b.class.title}</p>
                <p className="text-xs text-slate-400">{b.class.startTime.toLocaleString()}</p>
              </div>
              <BookingStatusBadge status={b.status} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const BOOKING_STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  cancelled: "Cancelled",
  late_cancelled: "Late cancelled",
  no_show: "No show",
  waitlist: "Waitlist",
  attended: "Attended",
};

const BOOKING_STATUS_TONE: Record<string, string> = {
  booked: "bg-teal-50 text-teal-800",
  cancelled: "bg-slate-100 text-slate-500",
  late_cancelled: "bg-rose-50 text-rose-700",
  no_show: "bg-rose-50 text-rose-700",
  waitlist: "bg-amber-50 text-amber-800",
  attended: "bg-teal-50 text-teal-800",
};

function BookingStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${BOOKING_STATUS_TONE[status] ?? "bg-slate-100 text-slate-500"}`}
    >
      {BOOKING_STATUS_LABEL[status] ?? status}
    </span>
  );
}
