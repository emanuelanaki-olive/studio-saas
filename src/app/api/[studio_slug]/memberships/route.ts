/**
 * src/app/api/[studio_slug]/memberships/route.ts
 *
 * GET  -> list a client's (or, for staff, all clients') memberships
 * POST -> create a membership (owner/staff only — e.g. selling a
 *         new punch card or starting a subscription at the front desk)
 *
 * Membership types and their required fields:
 *   - monthly_unlimited: requires expiresAt. No credit fields at all.
 *   - monthly_limited:   requires classesPerPeriod + expiresAt.
 *                        classesUsedThisPeriod starts at 0;
 *                        currentPeriodStart defaults to now().
 *   - punch_card:        requires totalPunches. remainingPunches is
 *                        set equal to totalPunches at creation.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateMembershipSchema = z.object({
  clientId: z.string().uuid(),
  type: z.enum(["monthly_unlimited", "monthly_limited", "punch_card"]),
  totalPunches: z.number().int().positive().optional(),
  classesPerPeriod: z.number().int().positive().optional(),
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
  const { type, clientId, totalPunches, classesPerPeriod, expiresAt } = parsed.data;

  // Per-type required-field validation. Doing this here (rather than
  // a single zod .refine) keeps each error message specific to the
  // type, which is clearer for the front-end form to surface.
  if (type === "punch_card" && !totalPunches) {
    return NextResponse.json(
      { error: "totalPunches is required for punch_card memberships." },
      { status: 400 }
    );
  }
  if (type === "monthly_limited" && !classesPerPeriod) {
    return NextResponse.json(
      { error: "classesPerPeriod is required for monthly_limited memberships." },
      { status: 400 }
    );
  }
  if ((type === "monthly_unlimited" || type === "monthly_limited") && !expiresAt) {
    return NextResponse.json(
      { error: "expiresAt is required for monthly memberships." },
      { status: 400 }
    );
  }

  const membership = await db.membership.create({
    data: {
      // studioId is also auto-injected by getTenantDb()'s extension at
      // runtime, but Prisma's generated types require it statically.
      studioId: session.studioId,
      clientId,
      type,
      totalPunches: type === "punch_card" ? totalPunches : undefined,
      remainingPunches: type === "punch_card" ? totalPunches : undefined,
      classesPerPeriod: type === "monthly_limited" ? classesPerPeriod : undefined,
      currentPeriodStart: type === "monthly_limited" ? new Date() : undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    },
  });

  return NextResponse.json({ membership }, { status: 201 });
});
