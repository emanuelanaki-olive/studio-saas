/**
 * src/lib/bookings.test.ts
 *
 * These tests run against a REAL test database (not mocked) because
 * the entire point of createBooking() is correct behavior under
 * Postgres transaction isolation — mocking Prisma would test nothing
 * meaningful here. Point TEST_DATABASE_URL at a disposable Postgres
 * instance before running `npm test`.
 *
 * This file is a starting point / spec of expected behavior, not a
 * fully wired CI suite — see comments inline for what's stubbed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createBooking, cancelBooking } from "./bookings";
import { InsufficientPunchesError } from "./api-handler";

const prisma = new PrismaClient();

describe("createBooking", () => {
  let studioId: string;
  let classId: string;
  let clientAId: string;
  let clientBId: string;

  beforeEach(async () => {
    // Fresh tenant + class with capacity=1 for every test, so we can
    // reliably trigger the "second booker gets waitlisted" path.
    const studio = await prisma.studio.create({
      data: { name: "Test Studio", slug: `test-${Date.now()}-${Math.random()}` },
    });
    studioId = studio.id;

    const klass = await prisma.class.create({
      data: {
        studioId,
        title: "Test Class",
        capacity: 1,
        startTime: new Date(Date.now() + 86_400_000),
        endTime: new Date(Date.now() + 90_000_000),
      },
    });
    classId = klass.id;

    const [clientA, clientB] = await Promise.all([
      prisma.user.create({
        data: { studioId, email: "a@test.com", fullName: "Client A", role: "client" },
      }),
      prisma.user.create({
        data: { studioId, email: "b@test.com", fullName: "Client B", role: "client" },
      }),
    ]);
    clientAId = clientA.id;
    clientBId = clientB.id;

    // Both clients get an unlimited monthly membership so capacity
    // tests below aren't affected by credit checks.
    await Promise.all(
      [clientAId, clientBId].map((clientId) =>
        prisma.membership.create({
          data: {
            studioId,
            clientId,
            type: "monthly_unlimited",
            status: "active",
            expiresAt: new Date(Date.now() + 30 * 86_400_000),
          },
        })
      )
    );
  });

  it("books a client when capacity is available", async () => {
    const booking = await createBooking({ studioId, classId, clientId: clientAId });
    expect(booking.status).toBe("booked");
  });

  it("waitlists the second client when capacity is full", async () => {
    await createBooking({ studioId, classId, clientId: clientAId });
    const second = await createBooking({ studioId, classId, clientId: clientBId });
    expect(second.status).toBe("waitlist");
  });

  it("never allows two concurrent bookings to both succeed past capacity", async () => {
    // The core race-condition test: fire both bookings at once and
    // assert exactly one ends up "booked" and the other "waitlist" —
    // never both "booked" against a capacity=1 class.
    const [a, b] = await Promise.all([
      createBooking({ studioId, classId, clientId: clientAId }),
      createBooking({ studioId, classId, clientId: clientBId }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["booked", "waitlist"]);
  });

  it("throws InsufficientPunchesError when a punch-card client has 0 punches", async () => {
    const punchClient = await prisma.user.create({
      data: { studioId, email: "c@test.com", fullName: "Client C", role: "client" },
    });
    await prisma.membership.create({
      data: {
        studioId,
        clientId: punchClient.id,
        type: "punch_card",
        totalPunches: 1,
        remainingPunches: 0,
        status: "active",
      },
    });

    await expect(
      createBooking({ studioId, classId: classId, clientId: punchClient.id })
    ).rejects.toThrow(InsufficientPunchesError);
  });

  it("throws InsufficientPunchesError when a monthly_limited client has used their full period", async () => {
    const limitedClient = await prisma.user.create({
      data: { studioId, email: "d@test.com", fullName: "Client D", role: "client" },
    });
    await prisma.membership.create({
      data: {
        studioId,
        clientId: limitedClient.id,
        type: "monthly_limited",
        classesPerPeriod: 4,
        classesUsedThisPeriod: 4, // already at the cap
        currentPeriodStart: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        status: "active",
      },
    });

    await expect(
      createBooking({ studioId, classId, clientId: limitedClient.id })
    ).rejects.toThrow(InsufficientPunchesError);
  });

  it("throws InsufficientPunchesError when the membership is frozen", async () => {
    const frozenClient = await prisma.user.create({
      data: { studioId, email: "e@test.com", fullName: "Client E", role: "client" },
    });
    await prisma.membership.create({
      data: {
        studioId,
        clientId: frozenClient.id,
        type: "monthly_unlimited",
        status: "frozen",
        frozenAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    await expect(
      createBooking({ studioId, classId, clientId: frozenClient.id })
    ).rejects.toThrow(InsufficientPunchesError);
  });

  it("marks a cancellation inside the studio's window as late_cancelled and does not refund credit", async () => {
    // Class starts in 1 hour; default cancellation window is 12h, so
    // cancelling now is well inside the "too late" window.
    const soonClass = await prisma.class.create({
      data: {
        studioId,
        title: "Starting Soon",
        capacity: 5,
        startTime: new Date(Date.now() + 60 * 60 * 1000),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });

    const punchClient = await prisma.user.create({
      data: { studioId, email: "f@test.com", fullName: "Client F", role: "client" },
    });
    const membership = await prisma.membership.create({
      data: {
        studioId,
        clientId: punchClient.id,
        type: "punch_card",
        totalPunches: 5,
        remainingPunches: 5,
        status: "active",
      },
    });

    const booking = await createBooking({
      studioId,
      classId: soonClass.id,
      clientId: punchClient.id,
    });

    const cancelled = await cancelBooking({ studioId, bookingId: booking.id });
    expect(cancelled.status).toBe("late_cancelled");

    const updatedMembership = await prisma.membership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    // Still 4, not refunded back to 5 — the late cancellation keeps
    // the credit spent.
    expect(updatedMembership.remainingPunches).toBe(4);
  });

  it("promotes the next waitlisted booking after a cancellation", async () => {
    const first = await createBooking({ studioId, classId, clientId: clientAId });
    const second = await createBooking({ studioId, classId, clientId: clientBId });
    expect(second.status).toBe("waitlist");

    await cancelBooking({ studioId, bookingId: first.id });

    const updatedSecond = await prisma.booking.findUniqueOrThrow({ where: { id: second.id } });
    expect(updatedSecond.status).toBe("booked");
  });
});

/**
 * NOTE: this suite intentionally does NOT include a cross-tenant
 * leakage test here because that's covered more thoroughly at the
 * getTenantDb() extension level — see a dedicated db.test.ts (not
 * included in this scaffold) that asserts findMany/findFirst/update/
 * delete all silently inject studioId and that findUnique returns
 * null for a real row belonging to a different tenant.
 */
