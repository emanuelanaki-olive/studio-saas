/**
 * src/app/api/[studio_slug]/services/route.ts
 *
 * GET  -> list this studio's services (for the booking dropdown and
 *         the dashboard's services management page)
 * POST -> create a new service (owner/staff only)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateServiceSchema = z.object({
  name: z.string().min(1).max(200),
  durationMin: z.number().int().positive(),
  description: z.string().optional(),
});

export const GET = withApiErrorHandling(async () => {
  const session = await requireStudioAccess();
  const db = getTenantDb(session.studioId);

  const services = await db.service.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ services });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const service = await db.service.create({
    data: {
      // studioId is also auto-injected by getTenantDb()'s extension at
      // runtime, but Prisma's generated types require it statically.
      studioId: session.studioId,
      name: parsed.data.name,
      durationMin: parsed.data.durationMin,
      description: parsed.data.description,
    },
  });

  return NextResponse.json({ service }, { status: 201 });
});
