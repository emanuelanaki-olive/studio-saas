/**
 * src/lib/membership-credit.ts
 *
 * Shared membership-credit logic used by BOTH booking tracks:
 *   - Track A: src/lib/bookings.ts (group classes)
 *   - Track B: src/lib/appointments.ts (1-on-1 appointments)
 *
 * Extracted into its own module so a client's punch card / monthly
 * limit is spent consistently regardless of which track they book
 * through — a client with 3 punches left should be able to spend
 * them on either a group class or a personal-training session, and
 * the deduction logic must be identical either way.
 *
 * Every function here takes the caller's own `Prisma.TransactionClient`
 * (`tx`) — none of this opens its own transaction. The booking flow
 * that calls these is always already inside one Serializable
 * transaction (see bookings.ts / appointments.ts), since the
 * credit check and the row creation must commit atomically together.
 */

import { Prisma, Membership } from "@prisma/client";

/**
 * Throws `ErrorClass` if `membership` cannot be used to pay for a new
 * booking/appointment right now. `ErrorClass` is passed in by the
 * caller (rather than imported here) so this module has no
 * dependency on src/lib/api-handler.ts's error classes — keeps the
 * dependency direction one-way (api-handler depends on nothing here).
 */
export function assertMembershipUsable(
  membership: Membership | null,
  ErrorClass: new (message: string) => Error
): void {
  if (!membership) {
    throw new ErrorClass("No active membership found for this client.");
  }
  if (membership.status === "frozen") {
    throw new ErrorClass("This membership is currently frozen.");
  }
  if (membership.expiresAt && membership.expiresAt < new Date()) {
    throw new ErrorClass("This membership has expired.");
  }
  if (membership.type === "punch_card" && (membership.remainingPunches ?? 0) <= 0) {
    throw new ErrorClass("No remaining punches on this membership.");
  }
  if (
    membership.type === "monthly_limited" &&
    membership.classesUsedThisPeriod >= (membership.classesPerPeriod ?? 0)
  ) {
    throw new ErrorClass(
      "This membership has reached its class limit for the current period."
    );
  }
}

/**
 * Validates (throwing `ErrorClass` on failure) and then consumes one
 * credit from `membership`, inside the caller's transaction `tx`.
 * Combines assertMembershipUsable() + the actual decrement into one
 * call, since every call site needs both steps back-to-back anyway.
 */
export async function consumeMembershipCreditForTx(
  tx: Prisma.TransactionClient,
  membership: Membership | null,
  ErrorClass: new (message: string) => Error
): Promise<void> {
  assertMembershipUsable(membership, ErrorClass);

  if (membership!.type === "punch_card") {
    await tx.membership.update({
      where: { id: membership!.id },
      data: { remainingPunches: { decrement: 1 } },
    });
  } else if (membership!.type === "monthly_limited") {
    await tx.membership.update({
      where: { id: membership!.id },
      data: { classesUsedThisPeriod: { increment: 1 } },
    });
  }
  // monthly_unlimited: nothing to decrement.
}

/**
 * Refunds exactly what consumeMembershipCreditForTx() took, for the
 * same membership — used on an early (non-late) cancellation.
 */
export async function refundMembershipCreditForTx(
  tx: Prisma.TransactionClient,
  membershipId: string | null
): Promise<void> {
  if (!membershipId) return;
  const membership = await tx.membership.findUnique({ where: { id: membershipId } });
  if (!membership) return;

  if (membership.type === "punch_card") {
    await tx.membership.update({
      where: { id: membership.id },
      data: { remainingPunches: { increment: 1 } },
    });
  } else if (membership.type === "monthly_limited") {
    await tx.membership.update({
      where: { id: membership.id },
      data: { classesUsedThisPeriod: { decrement: 1 } },
    });
  }
}
