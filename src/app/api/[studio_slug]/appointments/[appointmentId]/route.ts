/**
 * src/app/api/[studio_slug]/appointments/[appointmentId]/route.ts
 *
 * PATCH -> cancel an appointment, or mark it completed / no_show
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { cancelAppointment, completeAppointment } from "@/lib/appointments";
import { withApiErrorHandling } from "@/lib/api-handler";

const PatchAppointmentSchema = z.object({
  action: z.enum(["cancel", "mark_completed", "mark_no_show"]),
});

export const PATCH = withApiErrorHandling(async (req, ctx) => {
  const session = await requireStudioAccess();
  const { appointmentId } = await ctx.params;

  const body = await req.json();
  const parsed = PatchAppointmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "cancel") {
    // Clients can cancel only their own appointment; staff/owner can
    // cancel anyone's within the studio.
    if (session.role === "client") {
      const db = getTenantDb(session.studioId);
      const existing = await db.appointment.findFirst({ where: { id: appointmentId } });
      if (!existing || existing.clientId !== session.userId) {
        return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
      }
    }
    const appointment = await cancelAppointment({ studioId: session.studioId, appointmentId });
    return NextResponse.json({ appointment });
  }

  // Marking completed/no_show is staff/owner only.
  if (session.role === "client") {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  if (parsed.data.action === "mark_completed") {
    const appointment = await completeAppointment({ studioId: session.studioId, appointmentId });
    return NextResponse.json({ appointment });
  }

  const db = getTenantDb(session.studioId);
  const appointment = await db.appointment.update({
    where: { id: appointmentId },
    data: { status: "no_show" },
  });
  return NextResponse.json({ appointment });
});
