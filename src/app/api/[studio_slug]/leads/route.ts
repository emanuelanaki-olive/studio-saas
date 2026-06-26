/**
 * src/app/api/[studio_slug]/leads/route.ts
 *
 * GET  -> list leads, optionally filtered by ?status= or ?assignedToId=
 * POST -> create a new lead (owner/staff only - this is a staff-side
 *         tool, not something a public website form posts to
 *         directly; a public intake form would go through a
 *         separate, unauthenticated endpoint not built here)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateLeadSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  sourceId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const assignedToId = url.searchParams.get("assignedToId") ?? undefined;

  const leads = await db.lead.findMany({
    where: {
      status: status as
        | "new"
        | "contacted"
        | "meeting_scheduled"
        | "trial_scheduled"
        | "converted"
        | "lost"
        | undefined,
      assignedToId,
    },
    include: {
      source: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, fullName: true } },
      tasks: {
        where: { completedAt: null },
        orderBy: { dueAt: "asc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ leads });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const lead = await db.lead.create({
    data: {
      // studioId is also auto-injected by getTenantDb()'s extension at
      // runtime, but Prisma's generated types require it statically.
      studioId: session.studioId,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      sourceId: parsed.data.sourceId,
      assignedToId: parsed.data.assignedToId,
      notes: parsed.data.notes,
    },
  });

  return NextResponse.json({ lead }, { status: 201 });
});
