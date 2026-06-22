/**
 * src/lib/bookings.ts
 *
 * Core booking logic, isolated from the Route Handler so it can be
 * unit-tested directly and reused by both the client-portal "book a
 * class" action and any future admin-initiated booking flow.
 *
 * THE HARD PROBLEM THIS SOLVES:
 * Two clients clicking "Book" on the same class at the same moment,
 * with only 1 spot left, must not both succeed. Likewise, a client
 * with 1 punch remaining clicking "Book" twice in quick succession
 * must not end up with -1 punches and 2 active bookings.
 *
 * SOLUTION: a single Postgres transaction per booking that:
 *   1. Re-reads the class + current booking count WITH the studioId
 *      filter, using `SELECT ... FOR UPDATE`-equivalent locking via
 *      Prisma's serializable isolation level (see below) — this
 *      prevents two concurrent transactions from both reading
 *      "capacity not reached yet" and both inserting.
 *   2. Re-reads the membership's remaining_punches inside the same
 *      transaction, immediately before decrementing it.
 *   3. Performs the insert/update as one atomic unit — if any check
 *      fails, the whole transaction rolls back and nothing is
 *      written.
 *
 * Prisma doesn't expose `SELECT FOR UPDATE` directly, so we use
 * `Serializable` isolation, which makes Postgres itself detect the
 * write-write conflict and abort one of the two competing
 * transactions automatically. We catch that specific Postgres error
 * (40001) and retry once.
 */

import { Prisma, PrismaClient, BookingStatus } from "@prisma/client";
import { unscopedDb } from "./db";
import { OverbookingError, InsufficientPunchesError } from "./api-handler";

const SERIALIZATION_FAILURE_CODE = "40001";
const MAX_RETRIES = 2;

interface CreateBookingParams {
  studioId: string;
  classId: string;
  clientId: string;
}

/**
 * Books a client into a class, enforcing (within one transaction):
 *   - The class belongs to the requesting studio (defense in depth —
 *     the caller should already have verified this, but we re-check).
 *   - Capacity has not been exceeded -> else waitlist or reject.
 *   - If the client is paying via punch card, a punch is available
 *     and is decremented atomically.
 *   - If the client has an active monthly subscription, no punch
 *     deduction occurs at all.
 *
 * Returns the created Booking row.
 */
export async function createBooking({ studioId, classId, clientId }: CreateBookingParams) {
  let attempt = 0;

  while (true) {
    try {
      return await unscopedDb.$transaction(
        async (tx) => {
          // 1. Re-fetch the class scoped to this studio. If it
          //    doesn't exist for this studio, this throws — no
          //    cross-tenant booking possible.
          const klass = await tx.class.findFirst({
            where: { id: classId, studioId },
          });
          if (!klass) {
            throw new Error("Class not found for this studio.");
          }

          // 2. Count current active bookings for this class. Because
          //    this whole function runs at Serializable isolation,
          //    Postgres guarantees that if two concurrent transactions
          //    both read this count and both try to insert, the second
          //    one to commit will fail with a serialization error
          //    (40001) and be retried below — it will then see the
          //    updated count.
          const activeBookingCount = await tx.booking.count({
            where: {
              studioId,
              classId,
              status: { in: [BookingStatus.booked, BookingStatus.attended] },
            },
          });

          const isFull = activeBookingCount >= klass.capacity;

          // 3. Resolve how this client is paying: punch card or
          //    monthly subscription. We look for ANY active
          //    membership; in a real app you might let the client
          //    choose which membership to apply when they have both.
          const membership = await tx.membership.findFirst({
            where: {
              studioId,
              clientId,
              status: "active",
            },
            orderBy: { createdAt: "desc" },
          });

          if (isFull) {
            // Studio is full -> waitlist instead of hard-rejecting,
            // per the MVP spec ("waitlist if capacity is full").
            const booking = await tx.booking.create({
              data: {
                studioId,
                classId,
                clientId,
                status: BookingStatus.waitlist,
              },
            });
            return booking;
          }

          // 4. Enforce membership rules BEFORE creating the booking.
          if (membership?.type === "punch_card") {
            if ((membership.remainingPunches ?? 0) <= 0) {
              throw new InsufficientPunchesError(
                "No remaining punches on this membership."
              );
            }
            // Decrement atomically inside the same transaction.
            await tx.membership.update({
              where: { id: membership.id },
              data: { remainingPunches: { decrement: 1 } },
            });
          } else if (membership?.type === "monthly_subscription") {
            // No deduction needed — unlimited under the monthly plan.
          } else {
            // No active membership at all. Business rule: still
            // allow the booking attempt to fail clearly rather than
            // silently letting an unpaid client book.
            throw new InsufficientPunchesError(
              "No active membership or punch card found for this client."
            );
          }

          // 5. Finally, create the booking itself.
          const booking = await tx.booking.create({
            data: {
              studioId,
              classId,
              clientId,
              status: BookingStatus.booked,
            },
          });

          return booking;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (err) {
      if (isSerializationFailure(err) && attempt < MAX_RETRIES) {
        attempt += 1;
        continue; // retry with fresh reads
      }
      throw err;
    }
  }
}

/**
 * Cancels a booking and, if it was paid for with a punch card,
 * refunds the punch. Also promotes the longest-waiting waitlisted
 * booking (if any) to `booked`, since a spot just opened up.
 */
export async function cancelBooking({
  studioId,
  bookingId,
}: {
  studioId: string;
  bookingId: string;
}) {
  return unscopedDb.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, studioId },
    });
    if (!booking) {
      throw new Error("Booking not found for this studio.");
    }
    if (booking.status === BookingStatus.cancelled) {
      return booking; // idempotent
    }

    const cancelled = await tx.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.cancelled },
    });

    // Refund a punch if one was spent. We don't store "how this
    // booking was paid for" on the Booking row in the MVP schema, so
    // this assumes punch-card clients only ever have one active
    // membership at a time (true for MVP scope). A future iteration
    // should add a `membershipId` FK on Booking to make this exact.
    const membership = await tx.membership.findFirst({
      where: { studioId, clientId: booking.clientId, type: "punch_card", status: "active" },
    });
    if (membership) {
      await tx.membership.update({
        where: { id: membership.id },
        data: { remainingPunches: { increment: 1 } },
      });
    }

    // Promote the oldest waitlisted booking for this class, if any.
    const nextInLine = await tx.booking.findFirst({
      where: { studioId, classId: booking.classId, status: BookingStatus.waitlist },
      orderBy: { createdAt: "asc" },
    });
    if (nextInLine) {
      await tx.booking.update({
        where: { id: nextInLine.id },
        data: { status: BookingStatus.booked },
      });
    }

    return cancelled;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function isSerializationFailure(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    // Prisma surfaces the raw Postgres SQLSTATE in `meta.code` for
    // some drivers; fall back to checking the message text since this
    // varies by Prisma version.
    (((err.meta as Record<string, unknown> | undefined)?.code as string | undefined) ===
      SERIALIZATION_FAILURE_CODE ||
      err.message.includes("could not serialize access"))
  );
}

export { OverbookingError };
