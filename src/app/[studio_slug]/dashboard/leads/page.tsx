/**
 * src/app/[studio_slug]/dashboard/leads/page.tsx
 *
 * Leads table, matching the table-based layout shown in the Arbox
 * reference screenshots (status, name, phone, source, assigned
 * staff, next follow-up, created date) rather than a kanban board.
 * A row of status tabs above the table filters which leads show -
 * "All" is the default so nothing is hidden by surprise.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import Link from "next/link";
import { AddLeadButton } from "./AddLeadButton";

type LeadStatus =
  | "new"
  | "contacted"
  | "meeting_scheduled"
  | "trial_scheduled"
  | "converted"
  | "lost";

const ALL_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "meeting_scheduled",
  "trial_scheduled",
  "converted",
  "lost",
];

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  meeting_scheduled: "Meeting scheduled",
  trial_scheduled: "Trial scheduled",
  converted: "Converted",
  lost: "Lost",
};

const STATUS_TONE: Record<LeadStatus, string> = {
  new: "bg-slate-100 text-slate-600",
  contacted: "bg-blue-50 text-blue-700",
  meeting_scheduled: "bg-amber-50 text-amber-800",
  trial_scheduled: "bg-amber-50 text-amber-800",
  converted: "bg-teal-50 text-teal-800",
  lost: "bg-rose-50 text-rose-700",
};

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ studio_slug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { studio_slug } = await params;
  const { status: statusFilter } = await searchParams;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const isValidStatus = (s: string | undefined): s is LeadStatus =>
    !!s && (ALL_STATUSES as string[]).includes(s);

  const leads = await db.lead.findMany({
    where: isValidStatus(statusFilter) ? { status: statusFilter } : undefined,
    include: {
      source: { select: { name: true } },
      assignedTo: { select: { fullName: true } },
      tasks: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const counts = await db.lead.groupBy({
    by: ["status"],
    _count: true,
  });
  const countByStatus = (s: LeadStatus) =>
    counts.find((c) => c.status === s)?._count ?? 0;
  const totalCount = counts.reduce((sum, c) => sum + c._count, 0);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
        <AddLeadButton studioSlug={studio_slug} />
      </div>

      <div className="mt-4 flex gap-1 border-b border-slate-200">
        <StatusTab
          href={`/${studio_slug}/dashboard/leads`}
          label="All"
          count={totalCount}
          active={!statusFilter}
        />
        {ALL_STATUSES.map((s) => (
          <StatusTab
            key={s}
            href={`/${studio_slug}/dashboard/leads?status=${s}`}
            label={STATUS_LABEL[s]}
            count={countByStatus(s)}
            active={statusFilter === s}
          />
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Assigned to</th>
              <th className="px-4 py-3 font-medium">Next follow-up</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/${studio_slug}/dashboard/leads/${lead.id}`}
                    className="font-medium text-slate-900 hover:text-teal-700"
                  >
                    {lead.fullName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[lead.status as LeadStatus]}`}
                  >
                    {STATUS_LABEL[lead.status as LeadStatus]}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.phone ?? "-"}</td>
                <td className="px-4 py-3 text-slate-600">{lead.source?.name ?? "-"}</td>
                <td className="px-4 py-3 text-slate-600">{lead.assignedTo?.fullName ?? "-"}</td>
                <td className="px-4 py-3">
                  {lead.tasks[0] ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {new Date(lead.tasks[0].dueAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">None</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {new Date(lead.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No leads in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatusTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 text-sm font-medium ${
        active
          ? "border-b-2 border-teal-700 text-teal-800"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {label} <span className="text-slate-400">({count})</span>
    </Link>
  );
}
