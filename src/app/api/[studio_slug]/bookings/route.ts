/**
 * src/app/api/[studio_slug]/bookings/route.ts
 *
 * POST   -> create a booking (client books a class)
 * GET    -> list bookings (admin dashboard / "who's coming to this class")
 *
 * Note the folder is namespaced under [studio_slug] so the
 * middleware-attached `x-studio-slug` header and the URL segment
 * stay in sync, and so this route reads naturally as
 * "bookings for THIS studio" rather than a global bookings endpoint.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { createBooking } from "@/lib/bookings";
import { withApiErrorHandling } from "@/lib/api-handler";

const CreateBookingSchema = z.object({
  classId: z.string().uuid(),
  // clientId is optional: if omitted, the booking is made for the
  // currently-authenticated user (self-service from the client
  // portal). Staff/owners can pass clientId explicitly to book on
  // behalf of a client from the admin dashboard.
  clientId: z.string().uuid().optional(),
});

export const POST = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess();
  const body = await req.json();
  const parsed = CreateBookingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const targetClientId = parsed.data.clientId ?? session.userId;

  // Only staff/owner can book on behalf of someone else.
  if (targetClientId !== session.userId && session.role === "client") {
    return NextResponse.json(
      { error: "Clients can only book classes for themselves." },
      { status: 403 }
    );
  }

  const booking = await createBooking({
    studioId: session.studioId,
    classId: parsed.data.classId,
    clientId: targetClientId,
  });

  return NextResponse.json({ booking }, { status: 201 });
});

export const GET = withApiErrorHandling(async (req) => {
  const session = await requireStudioAccess();
  const db = getTenantDb(session.studioId);

  const url = new URL(req.url);
  const classId = url.searchParams.get("classId") ?? undefined;

  // Clients can only ever see their own bookings; staff/owner can see
  // everyone's (optionally filtered to one class for the attendance view).
  const bookings = await db.booking.findMany({
    where: {
      classId,
      ...(session.role === "client" ? { clientId: session.userId } : {}),
    },
    include: {
      client: { select: { id: true, fullName: true, email: true, phone: true } },
      class: { select: { id: true, title: true, startTime: true, endTime: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ bookings });
});
