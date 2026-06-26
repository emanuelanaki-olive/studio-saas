/**
 * src/app/api/[studio_slug]/lead-sources/route.ts
 *
 * GET  -> list this studio's lead sources (Website, Facebook, etc)
 * POST -> add a new one (owner/staff)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateLeadSourceSchema = z.object({
  name: z.string().min(1).max(100),
});

export const GET = withApiErrorHandling(async () => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);
  const sources = await db.leadSource.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ sources });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateLeadSourceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const source = await db.leadSource.create({
    data: { studioId: session.studioId, name: parsed.data.name },
  });

  return NextResponse.json({ source }, { status: 201 });
});
