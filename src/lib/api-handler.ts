/**
 * src/lib/api-handler.ts
 *
 * Thin wrapper so every Route Handler gets consistent error
 * responses without repeating try/catch boilerplate, and so
 * unexpected errors never leak internal details to the client.
 */

import { NextResponse } from "next/server";
import { UnauthorizedError, ForbiddenError, NotFoundError } from "./auth";
import { Prisma } from "@prisma/client";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export function withApiErrorHandling(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      if (err instanceof NotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        // P2002 = unique constraint violation (e.g. double-booking,
        // duplicate email within a studio)
        if (err.code === "P2002") {
          return NextResponse.json(
            { error: "This action conflicts with an existing record." },
            { status: 409 }
          );
        }
      }
      if (err instanceof OverbookingError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      if (err instanceof InsufficientPunchesError) {
        return NextResponse.json({ error: err.message }, { status: 402 });
      }

      // Unexpected — log full detail server-side, return a generic
      // message to the client.
      console.error("Unhandled API error:", err);
      return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
  };
}

// Re-exported here to avoid a circular import between api-handler.ts
// and bookings.ts; both files are small enough that this is fine.
export class OverbookingError extends Error {}
export class InsufficientPunchesError extends Error {}
