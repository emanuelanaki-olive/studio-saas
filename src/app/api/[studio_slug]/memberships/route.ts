/**
 * src/app/api/[studio_slug]/memberships/route.ts
 *
 * GET  -> list a client's (or, for staff, all clients') memberships
 * POST -> create a membership (owner/staff only — e.g. selling a
 *         new punch card or starting a subscription at the front desk)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateMembershipSchema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(["monthly_subscription", "punch_card"]),
  totalPunches: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess();
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");

  const memberships = await db.membership.findMany({
    where: {
      // Clients can only see their own; staff/owner can filter by
      // clientId or see everyone.
      clientId: session.role === "client" ? session.userId : clientId ?? undefined,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ memberships });
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = CreateMembershipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.type === "punch_card" && !parsed.data.totalPunches) {
    return NextResponse.json(
      { error: "totalPunches is required for punch_card memberships." },
      { status: 400 }
    );
  }

  const membership = await db.membership.create({
    data: {
      clientId: parsed.data.clientId,
      type: parsed.data.type,
      totalPunches: parsed.data.totalPunches,
      remainingPunches: parsed.data.totalPunches,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    },
  });

  return NextResponse.json({ membership }, { status: 201 });
});
