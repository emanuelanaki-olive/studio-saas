/**
 * src/app/api/[studio_slug]/lead-lost-reasons/route.ts
 *
 * GET  -> list this studio's lead-lost reasons
 * POST -> add a new one (owner/staff)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateLeadLostReasonSchema = z.object({
  name: z.string().min(1).max(100),
});

export const GET = withApiErrorHandling(async () => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);
  const reasons = await db.leadLostReason.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ reasons });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateLeadLostReasonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const reason = await db.leadLostReason.create({
    data: { studioId: session.studioId, name: parsed.data.name },
  });

  return NextResponse.json({ reason }, { status: 201 });
});
