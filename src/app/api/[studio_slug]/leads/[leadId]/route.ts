/**
 * src/app/api/[studio_slug]/leads/[leadId]/route.ts
 *
 * GET   -> full lead detail including tasks
 * PATCH -> update lead fields (status, assignedTo, notes, lostReason),
 *          OR convert the lead to a client via action: "convert"
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";
import { convertLead, LeadNotFoundError, LeadAlreadyConvertedError } from "@/lib/leads";

const PatchLeadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    fullName: z.string().min(1).optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    sourceId: z.string().uuid().nullable().optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    status: z
      .enum(["new", "contacted", "meeting_scheduled", "trial_scheduled", "lost"])
      .optional(),
    lostReasonId: z.string().uuid().nullable().optional(),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal("convert"),
    temporaryPassword: z.string().min(8),
  }),
]);

export const GET = withApiErrorHandling(async (_req, ctx) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const { leadId } = await ctx.params;
  const db = getTenantDb(session.studioId);

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      source: true,
      assignedTo: { select: { id: true, fullName: true } },
      lostReason: true,
      convertedUser: { select: { id: true, fullName: true } },
      tasks: { orderBy: { dueAt: "asc" } },
    },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  return NextResponse.json({ lead });
});

export const PATCH = withApiErrorHandling(async (req, ctx) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const { leadId } = await ctx.params;

  const body = await req.json();
  const parsed = PatchLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "convert") {
    try {
      const user = await convertLead({
        studioId: session.studioId,
        leadId,
        temporaryPassword: parsed.data.temporaryPassword,
      });
      return NextResponse.json({ user });
    } catch (err) {
      if (err instanceof LeadNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (err instanceof LeadAlreadyConvertedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }
  }

  const db = getTenantDb(session.studioId);
  const { action, ...updateFields } = parsed.data;
  const lead = await db.lead.update({
    where: { id: leadId },
    data: updateFields,
  });

  return NextResponse.json({ lead });
});
