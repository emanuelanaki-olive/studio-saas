/**
 * src/app/[studio_slug]/dashboard/leads/page.tsx
 *
 * Leads pipeline: a simple column-per-status board (new, contacted,
 * meeting_scheduled, trial_scheduled - converted/lost are shown as
 * counts only, since an active pipeline view doesn't need to dwell
 * on closed-out leads). Each card shows the next open task's due
 * date if there is one, mirroring the "follow up" indicator seen in
 * the Arbox screenshots.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import Link from "next/link";
import { AddLeadButton } from "./AddLeadButton";

const ACTIVE_STATUSES = ["new", "contacted", "meeting_scheduled", "trial_scheduled"] as const;

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  meeting_scheduled: "Meeting scheduled",
  trial_scheduled: "Trial scheduled",
};

export default async function LeadsPage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const [leads, convertedCount, lostCount] = await Promise.all([
    db.lead.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      include: {
        source: { select: { name: true } },
        tasks: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.lead.count({ where: { status: "converted" } }),
    db.lead.count({ where: { status: "lost" } }),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
        <AddLeadButton studioSlug={studio_slug} />
      </div>

      <div className="mt-2 flex gap-4 text-sm text-slate-500">
        <span>{convertedCount} converted</span>
        <span>{lostCount} lost</span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ACTIVE_STATUSES.map((status) => {
          const columnLeads = leads.filter((l) => l.status === status);
          return (
            <div key={status} className="rounded-lg bg-slate-100 p-3">
              <h2 className="mb-3 px-1 text-sm font-medium text-slate-600">
                {STATUS_LABEL[status]}{" "}
                <span className="text-slate-400">({columnLeads.length})</span>
              </h2>
              <div className="space-y-2">
                {columnLeads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/${studio_slug}/dashboard/leads/${lead.id}`}
                    className="block rounded-md border border-slate-200 bg-white p-3 hover:border-teal-200"
                  >
                    <p className="font-medium text-slate-900">{lead.fullName}</p>
                    {lead.source && (
                      <p className="text-xs text-slate-400">{lead.source.name}</p>
                    )}
                    {lead.tasks[0] && (
                      <p className="mt-1.5 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Follow up {lead.tasks[0].dueAt.toLocaleDateString()}
                      </p>
                    )}
                  </Link>
                ))}
                {columnLeads.length === 0 && (
                  <p className="px-1 text-xs text-slate-400">No leads here.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
