/**
 * src/app/[studio_slug]/dashboard/clients/page.tsx
 *
 * Clients (CRM) list. Shows every client with their lifecycle status
 * and active membership at a glance, links to a detail page per
 * client. Server-rendered: the list itself doesn't need client-side
 * interactivity, only the "Add client" form (separate component)
 * does.
 */

import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import Link from "next/link";
import { MembershipPill } from "@/components/MembershipPill";
import { AddClientButton } from "./AddClientButton";

const STATUS_LABEL: Record<string, string> = {
  lead: "Lead",
  active: "Active",
  inactive: "Inactive",
  frozen: "Frozen",
};

const STATUS_TONE: Record<string, string> = {
  lead: "bg-slate-100 text-slate-600",
  active: "bg-teal-50 text-teal-800",
  inactive: "bg-slate-100 text-slate-500",
  frozen: "bg-amber-50 text-amber-800",
};

export default async function ClientsPage({
  params,
}: {
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const clients = await db.user.findMany({
    where: { role: "client" },
    include: {
      memberships: {
        where: { status: { in: ["active", "frozen"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { fullName: "asc" },
  });

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Clients</h1>
        <AddClientButton studioSlug={studio_slug} />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Membership</th>
              <th className="px-4 py-3 font-medium">Contact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map((client) => {
              const membership = client.memberships[0];
              const status = client.clientStatus ?? "lead";
              return (
                <tr key={client.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/${studio_slug}/dashboard/clients/${client.id}`}
                      className="font-medium text-slate-900 hover:text-teal-700"
                    >
                      {client.fullName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[status]}`}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {membership ? (
                      <MembershipPill membership={membership} />
                    ) : (
                      <span className="text-xs text-slate-400">No active membership</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    <div>{client.email}</div>
                    {client.phone && <div className="text-xs">{client.phone}</div>}
                  </td>
                </tr>
              );
            })}
            {clients.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  No clients yet. Add your first client to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
