/**
 * src/app/[studio_slug]/dashboard/leads/[leadId]/page.tsx
 *
 * Lead detail: contact info, status/notes editor, follow-up tasks,
 * and the convert-to-client action. Editing is split into small
 * client components (LeadStatusForm, LeadTasks, ConvertLeadButton)
 * so each piece's state stays simple.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { LeadStatusForm } from "./LeadStatusForm";
import { LeadTasks } from "./LeadTasks";
import { ConvertLeadButton } from "./ConvertLeadButton";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ studio_slug: string; leadId: string }>;
}) {
  const { studio_slug, leadId } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      source: true,
      lostReason: true,
      convertedUser: { select: { id: true, fullName: true } },
      tasks: { orderBy: { dueAt: "asc" } },
    },
  });

  if (!lead) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{lead.fullName}</h1>
          <p className="text-sm text-slate-500">
            {lead.email ?? "No email"} {lead.phone && `- ${lead.phone}`}
          </p>
        </div>
        {lead.status !== "converted" && (
          <ConvertLeadButton studioSlug={studio_slug} leadId={lead.id} hasEmail={!!lead.email} />
        )}
      </div>

      {lead.status === "converted" && lead.convertedUser && (
        <p className="mt-3 rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-800">
          Converted to client: {lead.convertedUser.fullName}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Status</h2>
        <LeadStatusForm
          studioSlug={studio_slug}
          lead={{
            id: lead.id,
            status: lead.status,
            notes: lead.notes,
            lostReasonId: lead.lostReasonId,
          }}
        />
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Follow-up tasks
        </h2>
        <LeadTasks studioSlug={studio_slug} leadId={lead.id} initialTasks={lead.tasks} />
      </section>
    </main>
  );
}
