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

    // Both clients get a monthly subscription so membership checks
    // don't interfere with the capacity tests below.
    await Promise.all(
      [clientAId, clientBId].map((clientId) =>
        prisma.membership.create({
          data: { studioId, clientId, type: "monthly_subscription", status: "active" },
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
