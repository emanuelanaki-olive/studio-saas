/**
 * src/lib/memberships.ts
 *
 * Membership lifecycle operations that aren't part of the booking
 * transaction itself (see src/lib/bookings.ts for credit
 * consumption/refund, which stays focused on the booking flow).
 *
 * FREEZE SEMANTICS:
 * Freezing a membership is meant to be fair to the client — if they
 * pause for 10 days, their expiry date should move 10 days later,
 * not stay fixed while they lose access time. We implement this by:
 *   1. On freeze: record `frozenAt = now()`, set status = 'frozen'.
 *   2. On unfreeze: compute how long they were frozen
 *      (now - frozenAt), add that exact duration to `expiresAt`,
 *      clear `frozenAt`, set status back to 'active'.
 *
 * A frozen membership is rejected by assertMembershipUsable() in
 * bookings.ts, so no booking can be made against it while frozen —
 * that check doesn't need to be duplicated here.
 */

import { unscopedDb } from "./db";

export class MembershipNotFoundError extends Error {}
export class MembershipStateError extends Error {}

/**
 * Freezes a membership. Only valid from `active` status — freezing
 * an already-frozen or cancelled/expired membership is rejected so
 * callers can't accidentally double-freeze and lose track of the
 * original frozenAt timestamp.
 */
export async function freezeMembership({
  studioId,
  membershipId,
}: {
  studioId: string;
  membershipId: string;
}) {
  return unscopedDb.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, studioId },
    });
    if (!membership) {
      throw new MembershipNotFoundError("Membership not found for this studio.");
    }
    if (membership.status !== "active") {
      throw new MembershipStateError(
        `Cannot freeze a membership with status "${membership.status}".`
      );
    }

    return tx.membership.update({
      where: { id: membership.id },
      data: { status: "frozen", frozenAt: new Date() },
    });
  });
}

/**
 * Unfreezes a membership, pushing expiresAt forward by exactly the
 * duration it was frozen. Memberships with no expiresAt (shouldn't
 * normally happen for monthly types, but punch_card legitimately has
 * none) simply unfreeze without adjusting any date.
 */
export async function unfreezeMembership({
  studioId,
  membershipId,
}: {
  studioId: string;
  membershipId: string;
}) {
  return unscopedDb.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, studioId },
    });
    if (!membership) {
      throw new MembershipNotFoundError("Membership not found for this studio.");
    }
    if (membership.status !== "frozen" || !membership.frozenAt) {
      throw new MembershipStateError("This membership is not currently frozen.");
    }

    const frozenDurationMs = Date.now() - membership.frozenAt.getTime();
    const newExpiresAt = membership.expiresAt
      ? new Date(membership.expiresAt.getTime() + frozenDurationMs)
      : null;

    return tx.membership.update({
      where: { id: membership.id },
      data: {
        status: "active",
        frozenAt: null,
        expiresAt: newExpiresAt ?? undefined,
      },
    });
  });
}

/**
 * Cancels a membership outright (no auto-refund of remaining
 * punches/period credit — that's a business decision for the studio
 * to make manually, e.g. partial refund off-platform).
 */
export async function cancelMembership({
  studioId,
  membershipId,
}: {
  studioId: string;
  membershipId: string;
}) {
  return unscopedDb.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, studioId },
    });
    if (!membership) {
      throw new MembershipNotFoundError("Membership not found for this studio.");
    }
    return tx.membership.update({
      where: { id: membership.id },
      data: { status: "cancelled" },
    });
  });
}

/**
 * Resets classesUsedThisPeriod to 0 and advances currentPeriodStart
 * for every monthly_limited membership whose period has elapsed
 * (more than ~30 days since currentPeriodStart). Intended to run on
 * a schedule (e.g. a daily cron job / Vercel Cron hitting a route
 * that calls this) — NOT invoked from the booking transaction, to
 * keep that transaction's scope minimal and fast.
 *
 * Uses a fixed 30-day period for simplicity. A studio wanting
 * calendar-month resets (e.g. always the 1st) would need a small
 * change here — noted as a possible future refinement, not built now.
 */
export async function resetElapsedMembershipPeriods() {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  return unscopedDb.membership.updateMany({
    where: {
      type: "monthly_limited",
      status: "active",
      currentPeriodStart: { lte: cutoff },
    },
    data: {
      classesUsedThisPeriod: 0,
      currentPeriodStart: new Date(),
    },
  });
}
