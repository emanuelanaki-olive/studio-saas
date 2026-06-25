/**
 * src/lib/appointments.ts
 *
 * Track B booking logic: 1-on-1 appointments against a provider's
 * recurring AvailabilityBlock, as opposed to Track A's fixed-schedule
 * group Class/Booking. Mirrors src/lib/bookings.ts's transactional
 * safety approach (Serializable isolation + retry) so two clients
 * can't double-book the same provider time slot, and reuses
 * src/lib/membership-credit.ts so a client's punch card / monthly
 * limit is spent consistently across BOTH tracks rather than each
 * track keeping its own separate "spend."
 *
 * AVAILABILITY CHECK:
 * An appointment is only bookable if:
 *   1. [startTime, endTime) falls entirely within one of the
 *      provider's AvailabilityBlock windows for that day of week.
 *   2. It doesn't overlap any of that provider's EXISTING appointments
 *      (booked or completed) — two clients can't book the same slot
 *      with the same provider.
 * Overlap is checked with the standard interval-overlap condition:
 *   existing.startTime < new.endTime AND existing.endTime > new.startTime
 *
 * KNOWN LIMITATION: the availability check requires the ENTIRE
 * appointment to fit inside a single AvailabilityBlock row. A
 * provider whose hours are stored as two adjacent blocks (e.g.
 * 09:00-12:00 and 12:00-17:00) will incorrectly reject a booking that
 * spans the boundary (e.g. 11:30-12:30) even though their actual
 * working hours are continuous. Storing a provider's daily hours as
 * ONE block per day (not split) avoids this in practice; merging
 * adjacent blocks automatically is a possible future improvement, not
 * built now.
 *
 * KNOWN LIMITATION: appointments that cross midnight are rejected
 * outright (see assertSameDayInterval below) rather than handled -
 * studio session lengths are assumed to fit within one calendar day.
 */

import { Prisma, AppointmentStatus } from "@prisma/client";
import { unscopedDb } from "./db";
import { OverbookingError, InsufficientPunchesError } from "./api-handler";
import { consumeMembershipCreditForTx, refundMembershipCreditForTx } from "./membership-credit";

const SERIALIZATION_FAILURE_CODE = "40001";
const MAX_RETRIES = 2;
const DEFAULT_CANCELLATION_WINDOW_HOURS = 12;

interface CreateAppointmentParams {
  studioId: string;
  serviceId: string;
  providerId: string;
  clientId: string;
  startTime: Date;
  endTime: Date;
}

export async function createAppointment(params: CreateAppointmentParams) {
  let attempt = 0;

  while (true) {
    try {
      return await unscopedDb.$transaction(
        async (tx) => {
          const { studioId, serviceId, providerId, clientId, startTime, endTime } = params;

          assertSameDayInterval(startTime, endTime);

          const service = await tx.service.findFirst({ where: { id: serviceId, studioId } });
          if (!service) {
            throw new Error("Service not found for this studio.");
          }

          // 1. Confirm the slot falls inside one of the provider's
          //    recurring availability windows for that day of week.
          const dayOfWeek = startTime.getDay();
          const startMinute = startTime.getHours() * 60 + startTime.getMinutes();
          const endMinute = endTime.getHours() * 60 + endTime.getMinutes();

          const matchingBlock = await tx.availabilityBlock.findFirst({
            where: {
              studioId,
              providerId,
              dayOfWeek,
              startMinute: { lte: startMinute },
              endMinute: { gte: endMinute },
            },
          });
          if (!matchingBlock) {
            throw new OverbookingError(
              "This time is outside the provider's available hours."
            );
          }

          // 2. Confirm no overlapping appointment already exists for
          //    this provider. Running this check + the insert below
          //    inside one Serializable transaction is what prevents
          //    two concurrent requests from both passing this check
          //    and double-booking the same slot - exactly the same
          //    mechanism createBooking() uses for class capacity.
          const overlapping = await tx.appointment.findFirst({
            where: {
              studioId,
              providerId,
              status: { in: [AppointmentStatus.booked, AppointmentStatus.completed] },
              startTime: { lt: endTime },
              endTime: { gt: startTime },
            },
          });
          if (overlapping) {
            throw new OverbookingError("This provider is already booked at that time.");
          }

          // 3. Validate + consume membership credit, shared with
          //    Track A - a client's punch card is spent the same way
          //    whether they book a group class or a 1-on-1 session.
          const membership = await tx.membership.findFirst({
            where: { studioId, clientId, status: "active" },
            orderBy: { createdAt: "desc" },
          });
          await consumeMembershipCreditForTx(tx, membership, InsufficientPunchesError);

          return tx.appointment.create({
            data: {
              studioId,
              serviceId,
              providerId,
              clientId,
              membershipId: membership!.id,
              startTime,
              endTime,
              status: AppointmentStatus.booked,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (err) {
      if (isSerializationFailure(err) && attempt < MAX_RETRIES) {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}

/**
 * Cancels an appointment, applying the same cancellation-window
 * policy as cancelBooking() - refund credit if cancelled early
 * enough, otherwise late_cancelled with credit kept spent. There is
 * no waitlist for appointments (the slot just becomes free again for
 * anyone to book), so this is simpler than cancelBooking().
 */
export async function cancelAppointment({
  studioId,
  appointmentId,
}: {
  studioId: string;
  appointmentId: string;
}) {
  return unscopedDb.$transaction(
    async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id: appointmentId, studioId },
      });
      if (!appointment) {
        throw new Error("Appointment not found for this studio.");
      }
      if (
        appointment.status === AppointmentStatus.cancelled ||
        appointment.status === AppointmentStatus.late_cancelled
      ) {
        return appointment; // idempotent
      }

      const settings = await tx.studioSettings.findUnique({ where: { studioId } });
      const windowHours = settings?.cancellationWindowHours ?? DEFAULT_CANCELLATION_WINDOW_HOURS;
      const windowStart = new Date(
        appointment.startTime.getTime() - windowHours * 60 * 60 * 1000
      );
      const isLate = new Date() >= windowStart;
      const newStatus = isLate ? AppointmentStatus.late_cancelled : AppointmentStatus.cancelled;

      const cancelled = await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: newStatus },
      });

      if (newStatus === AppointmentStatus.cancelled) {
        await refundMembershipCreditForTx(tx, appointment.membershipId);
      }

      return cancelled;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

/**
 * Marks a past, booked appointment as completed. Distinct from
 * AppointmentStatus.attended-style tracking in Track A since 1-on-1
 * sessions don't have a separate attendance step - the provider
 * either ran the session (completed) or the client didn't show
 * (no_show), set via a separate explicit action, not by this
 * function.
 */
export async function completeAppointment({
  studioId,
  appointmentId,
}: {
  studioId: string;
  appointmentId: string;
}) {
  const owned = await unscopedDb.appointment.findFirst({
    where: { id: appointmentId, studioId },
  });
  if (!owned) {
    throw new Error("Appointment not found for this studio.");
  }
  return unscopedDb.appointment.update({
    where: { id: appointmentId },
    data: { status: AppointmentStatus.completed },
  });
}

/**
 * Guards against appointments that cross midnight - see the
 * "KNOWN LIMITATION" note in this file's header comment. Comparing
 * raw minute-of-day values (as the availability check does) is only
 * correct when both timestamps fall on the same calendar day.
 */
function assertSameDayInterval(startTime: Date, endTime: Date): void {
  const sameDay =
    startTime.getFullYear() === endTime.getFullYear() &&
    startTime.getMonth() === endTime.getMonth() &&
    startTime.getDate() === endTime.getDate();
  if (!sameDay || endTime <= startTime) {
    throw new OverbookingError(
      "Appointments must start and end on the same day, with endTime after startTime."
    );
  }
}

function isSerializationFailure(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (((err.meta as Record<string, unknown> | undefined)?.code as string | undefined) ===
      SERIALIZATION_FAILURE_CODE ||
      err.message.includes("could not serialize access"))
  );
}
