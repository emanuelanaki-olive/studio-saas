/**
 * src/app/api/[studio_slug]/settings/route.ts
 *
 * GET  -> fetch this studio's settings (creates a default row on
 *         first access, so the studio never has to "initialize" them
 *         explicitly — see getOrCreateSettings() below)
 * PATCH -> update settings (owner only — this is a business-policy
 *         decision, not a day-to-day staff operation)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb, TenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const PatchSettingsSchema = z.object({
  cancellationWindowHours: z.number().int().min(0).max(168), // cap at 1 week, sanity bound
});

async function getOrCreateSettings(db: TenantDb, studioId: string) {
  const existing = await db.studioSettings.findUnique({ where: { studioId } });
  if (existing) return existing;

  // First access for this studio — create the default row now rather
  // than requiring a separate "initialize settings" step during
  // signup. Uses the same default (12h) as the Prisma schema column
  // default, kept here explicitly so this function's behavior is
  // self-contained and doesn't silently depend on staying in sync
  // with schema.prisma.
  return db.studioSettings.create({
    data: { studioId, cancellationWindowHours: 12 },
  });
}

export const GET = withApiErrorHandling(async () => {
  const session = await requireStudioAccess();
  const db = getTenantDb(session.studioId);
  const settings = await getOrCreateSettings(db, session.studioId);
  return NextResponse.json({ settings });
});

export const PATCH = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = PatchSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await getOrCreateSettings(db, session.studioId); // ensure a row exists to update
  const settings = await db.studioSettings.update({
    where: { studioId: session.studioId },
    data: { cancellationWindowHours: parsed.data.cancellationWindowHours },
  });

  return NextResponse.json({ settings });
});
