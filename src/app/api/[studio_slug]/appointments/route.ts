/**
 * src/app/api/[studio_slug]/appointments/route.ts
 *
 * GET  -> list appointments (filtered by providerId or clientId, or
 *         the caller's own if they're a client)
 * POST -> book a 1-on-1 appointment
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { createAppointment } from "@/lib/appointments";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateAppointmentSchema = z.object({
  serviceId: z.string().uuid(),
  providerId: z.string().uuid(),
  // clientId is optional, same pattern as bookings: defaults to the
  // caller for self-service, staff/owner can specify it explicitly.
  clientId: z.string().uuid().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess();
  const body = await req.json();
  const parsed = CreateAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const targetClientId = parsed.data.clientId ?? session.userId;
  if (targetClientId !== session.userId && session.role === "client") {
    return NextResponse.json(
      { error: "Clients can only book appointments for themselves." },
      { status: 403 }
    );
  }

  const appointment = await createAppointment({
    studioId: session.studioId,
    serviceId: parsed.data.serviceId,
    providerId: parsed.data.providerId,
    clientId: targetClientId,
    startTime: new Date(parsed.data.startTime),
    endTime: new Date(parsed.data.endTime),
  });

  return NextResponse.json({ appointment }, { status: 201 });
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess();
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const providerId = url.searchParams.get("providerId") ?? undefined;
  const clientId = url.searchParams.get("clientId") ?? undefined;

  const appointments = await db.appointment.findMany({
    where: {
      providerId,
      // Clients can only ever see their own; staff/owner can filter
      // by clientId or see everyone's.
      clientId: session.role === "client" ? session.userId : clientId,
    },
    include: {
      service: { select: { id: true, name: true, durationMin: true } },
      provider: { select: { id: true, fullName: true } },
      client: { select: { id: true, fullName: true, email: true, phone: true } },
    },
    orderBy: { startTime: "asc" },
  });

  return NextResponse.json({ appointments });
});
