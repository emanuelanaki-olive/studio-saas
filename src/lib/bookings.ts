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
 *   2. Re-reads the membership's remaining credit inside the same
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
 *
 * MEMBERSHIP TYPES (v2):
 *   - monthly_unlimited: no credit check at all, just expiresAt + frozen.
 *   - monthly_limited:   classesUsedThisPeriod vs classesPerPeriod,
 *                        reset by resetMembershipPeriod() (see
 *                        src/lib/memberships.ts) at the start of each
 *                        period — NOT inside this file, to keep the
 *                        booking transaction focused on one job.
 *   - punch_card:        remainingPunches, fixed pool, no reset.
 *
 * Every credit-consuming booking records EXACTLY which membership it
 * drew from (Booking.membershipId), so cancellation refunds are exact
 * even if the client has switched memberships since booking — no more
 * "assume their current active membership is the one that paid."
 */

import { Prisma, BookingStatus, Membership } from "@prisma/client";
import { unscopedDb } from "./db";
import { OverbookingError, InsufficientPunchesError } from "./api-handler";
import { consumeMembershipCreditForTx, refundMembershipCreditForTx } from "./membership-credit";

const SERIALIZATION_FAILURE_CODE = "40001";
const MAX_RETRIES = 2;
const DEFAULT_CANCELLATION_WINDOW_HOURS = 12;

interface CreateBookingParams {
  studioId: string;
  classId: string;
  clientId: string;
}

/**
 * Books a client into a class, enforcing (within one transaction):
 *   - The class belongs to the requesting studio (defense in depth —
 *     the caller should already have verified this, but we re-check).
 *   - Capacity has not been exceeded -> else waitlist instead of reject.
 *   - The client has a usable membership: active (not frozen/expired),
 *     and if credit-based, has remaining credit — which is then
 *     decremented atomically.
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

          // 3. Resolve which membership pays for this booking. We pick
          //    the most-recently-created active, usable membership; a
          //    studio with a client holding multiple simultaneous
          //    memberships would need an explicit "which one" choice
          //    in the API — out of scope for now, noted as a known
          //    simplification.
          const membership = await tx.membership.findFirst({
            where: { studioId, clientId, status: "active" },
            orderBy: { createdAt: "desc" },
          });

          if (isFull) {
            // Studio is full -> waitlist instead of hard-rejecting.
            // No credit is consumed for a waitlisted booking — it's
            // only consumed when the booking is later promoted to
            // `booked` by cancelBooking()'s promotion step below.
            const booking = await tx.booking.create({
              data: {
                studioId,
                classId,
                clientId,
                membershipId: membership?.id,
                status: BookingStatus.waitlist,
              },
            });
            return booking;
          }

          // 4. Validate + consume the membership credit BEFORE
          //    creating the booking, so a failure here leaves nothing
          //    behind. consumeMembershipCredit() validates internally
          //    (via the shared assertMembershipUsable) before
          //    decrementing, so a single call covers both steps.
          await consumeMembershipCredit(tx, membership);

          // 5. Finally, create the booking itself.
          const booking = await tx.booking.create({
            data: {
              studioId,
              classId,
              clientId,
              membershipId: membership!.id,
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
 * Decrements the appropriate counter for `membership`'s type, inside
 * the caller's transaction. Thin wrapper around the shared
 * consumeMembershipCreditForTx() so call sites in this file don't
 * need to pass an ErrorClass each time — always InsufficientPunchesError
 * here. Accepts a possibly-null membership since the shared function
 * does the "is this even usable" validation internally.
 */
async function consumeMembershipCredit(
  tx: Prisma.TransactionClient,
  membership: Membership | null
): Promise<void> {
  await consumeMembershipCreditForTx(tx, membership, InsufficientPunchesError);
}

/**
 * Refunds exactly what consumeMembershipCredit() took. Thin wrapper
 * around the shared refundMembershipCreditForTx().
 */
async function refundMembershipCredit(
  tx: Prisma.TransactionClient,
  membershipId: string | null
): Promise<void> {
  await refundMembershipCreditForTx(tx, membershipId);
}

/**
 * Determines whether a cancellation happening right now, for a class
 * starting at `classStartTime`, falls inside or outside the studio's
 * cancellation window — and therefore whether credit should be
 * refunded.
 */
async function resolveCancellationStatus(
  tx: Prisma.TransactionClient,
  studioId: string,
  classStartTime: Date
): Promise<typeof BookingStatus.cancelled | typeof BookingStatus.late_cancelled> {
  const settings = await tx.studioSettings.findUnique({ where: { studioId } });
  const windowHours = settings?.cancellationWindowHours ?? DEFAULT_CANCELLATION_WINDOW_HOURS;
  const windowStart = new Date(classStartTime.getTime() - windowHours * 60 * 60 * 1000);
  const isLate = new Date() >= windowStart;
  return isLate ? BookingStatus.late_cancelled : BookingStatus.cancelled;
}

/**
 * Cancels a booking, applying the studio's cancellation-window policy
 * (refund credit if cancelled early enough, otherwise mark
 * late_cancelled and keep the credit spent). Also promotes the
 * longest-waiting waitlisted booking (if any) to `booked`, since a
 * spot just opened up — consuming THAT client's own membership credit
 * at promotion time, not before.
 */
export async function cancelBooking({
  studioId,
  bookingId,
}: {
  studioId: string;
  bookingId: string;
}) {
  return unscopedDb.$transaction(
    async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, studioId },
        include: { class: true },
      });
      if (!booking) {
        throw new Error("Booking not found for this studio.");
      }
      if (booking.status === BookingStatus.cancelled || booking.status === BookingStatus.late_cancelled) {
        return booking; // idempotent
      }

      const wasWaitlisted = booking.status === BookingStatus.waitlist;

      // Waitlisted bookings never consumed credit, so they always
      // resolve to a plain `cancelled` with no refund step needed.
      const newStatus = wasWaitlisted
        ? BookingStatus.cancelled
        : await resolveCancellationStatus(tx, studioId, booking.class.startTime);

      const cancelled = await tx.booking.update({
        where: { id: booking.id },
        data: { status: newStatus },
      });

      // Refund credit only on an early (non-late) cancellation of a
      // booking that had actually consumed credit.
      if (!wasWaitlisted && newStatus === BookingStatus.cancelled) {
        await refundMembershipCredit(tx, booking.membershipId);
      }

      // Promote the oldest waitlisted booking for this class, if any
      // — but only if a real spot just opened up (i.e. this wasn't
      // itself a waitlist cancellation, which frees no seat).
      if (!wasWaitlisted) {
        const nextInLine = await tx.booking.findFirst({
          where: { studioId, classId: booking.classId, status: BookingStatus.waitlist },
          orderBy: { createdAt: "asc" },
        });
        if (nextInLine) {
          // The waitlisted booking may have been created against a
          // membership that's since expired/changed — re-validate
          // and consume credit NOW, at promotion time, rather than
          // trusting whatever was true when they joined the waitlist.
          //
          // IMPORTANT: if this client's membership is no longer
          // usable, we must NOT let that failure roll back the
          // cancellation/refund we just did for the original client
          // above — so we swallow it here and simply leave them on
          // the waitlist for the next opening instead.
          try {
            const membership = await tx.membership.findFirst({
              where: { studioId, clientId: nextInLine.clientId, status: "active" },
              orderBy: { createdAt: "desc" },
            });
            // consumeMembershipCredit() validates internally before
            // decrementing, so this single call covers both steps —
            // throws InsufficientPunchesError if membership is null,
            // frozen, expired, or out of credit.
            await consumeMembershipCredit(tx, membership);
            await tx.booking.update({
              where: { id: nextInLine.id },
              data: { status: BookingStatus.booked, membershipId: membership!.id },
            });
          } catch (promotionError) {
            if (promotionError instanceof InsufficientPunchesError) {
              // Leave nextInLine on the waitlist; their turn will
              // come again on the next cancellation. Not re-thrown.
            } else {
              throw promotionError;
            }
          }
        }
      }

      return cancelled;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
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
