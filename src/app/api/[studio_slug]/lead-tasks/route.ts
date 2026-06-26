/**
 * src/app/api/[studio_slug]/lead-tasks/route.ts
 *
 * GET  -> list tasks, optionally filtered by ?leadId= or ?assignedToId=
 *         or ?dueBefore= (used to render "today's tasks" views like
 *         the Arbox screenshots showed)
 * POST -> create a follow-up task for a lead
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateLeadTaskSchema = z.object({
  leadId: z.string().uuid(),
  assignedToId: z.string().uuid().optional(),
  type: z.enum(["follow_up", "call", "meeting", "other"]).default("follow_up"),
  description: z.string().optional(),
  dueAt: z.string().datetime(),
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId") ?? undefined;
  const assignedToId = url.searchParams.get("assignedToId") ?? undefined;
  const dueBefore = url.searchParams.get("dueBefore");

  const tasks = await db.leadTask.findMany({
    where: {
      leadId,
      assignedToId,
      dueAt: dueBefore ? { lte: new Date(dueBefore) } : undefined,
      completedAt: null,
    },
    include: {
      lead: { select: { id: true, fullName: true, phone: true } },
      assignedTo: { select: { id: true, fullName: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  return NextResponse.json({ tasks });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateLeadTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const task = await db.leadTask.create({
    data: {
      studioId: session.studioId,
      leadId: parsed.data.leadId,
      assignedToId: parsed.data.assignedToId,
      type: parsed.data.type,
      description: parsed.data.description,
      dueAt: new Date(parsed.data.dueAt),
    },
  });

  return NextResponse.json({ task }, { status: 201 });
});
