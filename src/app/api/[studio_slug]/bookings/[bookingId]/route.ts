/**
 * src/app/api/[studio_slug]/bookings/[bookingId]/route.ts
 *
 * PATCH -> cancel a booking, or mark attendance (attended / no_show)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { cancelBooking } from "@/lib/bookings";
import { withApiErrorHandling } from "@/lib/api-handler";

const PatchBookingSchema = z.object({
  action: z.enum(["cancel", "mark_attended", "mark_no_show"]),
});

export const PATCH = withApiErrorHandling(async (req, ctx) => {
  const session = await requireStudioAccess();
  const { bookingId } = await ctx.params;
  const body = await req.json();
  const parsed = PatchBookingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "cancel") {
    // Clients can cancel only their own booking; staff/owner can
    // cancel anyone's within the studio.
    if (session.role === "client") {
      const db = getTenantDb(session.studioId);
      const existing = await db.booking.findFirst({ where: { id: bookingId } });
      if (!existing || existing.clientId !== session.userId) {
        return NextResponse.json({ error: "Booking not found." }, { status: 404 });
      }
    }
    const booking = await cancelBooking({ studioId: session.studioId, bookingId });
    return NextResponse.json({ booking });
  }

  // Attendance marking is staff/owner only.
  if (session.role === "client") {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const db = getTenantDb(session.studioId);
  const status = parsed.data.action === "mark_attended" ? "attended" : "no_show";
  const booking = await db.booking.update({
    where: { id: bookingId },
    data: { status },
  });

  return NextResponse.json({ booking });
});
