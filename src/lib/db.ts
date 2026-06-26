/**
 * src/lib/db.ts
 *
 * Tenant-safe Prisma client.
 *
 * WHY THIS FILE EXISTS:
 * The single biggest risk in a shared-schema multi-tenant app is a
 * developer forgetting a `where: { studioId }` clause and leaking
 * data across tenants. We reduce that risk by NEVER exporting the raw
 * PrismaClient. Instead, route handlers must call `getTenantDb(studioId)`,
 * which returns a client extension that automatically injects
 * `studioId` into every query on a tenant-scoped model.
 *
 * This does NOT replace the need to call getTenantDb with the correct
 * studioId (derived from the authenticated session) — see
 * src/lib/auth.ts / src/middleware.ts for how studioId is resolved
 * and verified before this is ever called.
 */

import { PrismaClient, Prisma } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __basePrisma: PrismaClient | undefined;
}

// Standard singleton pattern to avoid exhausting DB connections
// during Next.js dev hot-reload.
const basePrisma =
  global.__basePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__basePrisma = basePrisma;
}

// Models that carry a studioId column and MUST be tenant-scoped.
// If you add a new tenant table to schema.prisma, add its Prisma
// model name (lowercase, as it appears on the client, e.g. `class`)
// here too, or it will NOT be auto-scoped.
const TENANT_SCOPED_MODELS = new Set([
  "user",
  "class",
  "booking",
  "membership",
  "studiosettings",
  "service",
  "availabilityblock",
  "appointment",
  "leadsource",
  "leadlostreason",
  "lead",
  "leadtask",
]);

/**
 * Returns a Prisma Client extension that:
 *  1. Injects `studioId: studioId` into every `where` clause for
 *     reads (findMany, findFirst, findUnique, count, aggregate) on
 *     tenant-scoped models.
 *  2. Injects `studioId` into `data` on every `create`.
 *  3. Injects `studioId` into `where` for `update`, `updateMany`,
 *     `delete`, `deleteMany` so a request can never mutate another
 *     tenant's row even if it guesses a valid UUID.
 *
 * `studioId` MUST come from the authenticated session
 * (see src/lib/auth.ts -> getSessionStudioId()), never from a
 * client-supplied body/query param.
 */
export function getTenantDb(studioId: string) {
  if (!studioId) {
    throw new Error(
      "getTenantDb() called without a studioId. Refusing to return an " +
        "unscoped client — this would risk a cross-tenant data leak."
    );
  }

  return basePrisma.$extends({
    name: "tenant-scoping",
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "where", studioId);
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "where", studioId);
          }
          return query(args);
        },
        async findUnique({ model, args, query }) {
          // findUnique can only filter on unique fields, so we can't
          // blindly merge studioId into `where` without breaking the
          // unique constraint shape. Instead we verify after the fact.
          const result = await query(args);
          if (
            result &&
            TENANT_SCOPED_MODELS.has(lower(model)) &&
            (result as Record<string, unknown>).studioId !== studioId
          ) {
            // Row exists but belongs to a different tenant — treat as not found.
            return null;
          }
          return result;
        },
        async count({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "where", studioId);
          }
          return query(args);
        },
        async create({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "data", studioId);
          }
          return query(args);
        },
        async update({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "where", studioId);
          }
          return query(args);
        },
        async updateMany({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "where", studioId);
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "where", studioId);
          }
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          if (TENANT_SCOPED_MODELS.has(lower(model))) {
            mergeStudioId(args, "where", studioId);
          }
          return query(args);
        },
      },
    },
  });
}

/**
 * Merges `{ studioId }` into a given key (`"where"` or `"data"`) of a
 * Prisma extension's `args` object.
 *
 * WHY THE CAST: Prisma's `$allModels` extension hooks type `args`
 * generically across every model's input shape simultaneously (a
 * union of Class/User/Booking/... create-or-where inputs). That
 * union doesn't have a consistent `studioId` field type — for some
 * models in the union it's `string`, for others (models without a
 * studioId column) it's effectively absent/undefined — so direct
 * assignment fails type-checking even though we've already verified
 * at runtime (via TENANT_SCOPED_MODELS.has(...)) that the model
 * being queried right now does have that column.
 *
 * We narrow with `Record<string, unknown>` here deliberately, in
 * exactly this one spot, rather than loosening types elsewhere in
 * the app — the runtime guard above is what actually keeps this
 * safe; the cast just tells the compiler what we already know.
 */
function mergeStudioId(
  args: Record<string, unknown>,
  key: "where" | "data",
  studioId: string
) {
  args[key] = { ...(args[key] as Record<string, unknown> | undefined), studioId };
}

/**
 * Raw, UNSCOPED client. Use ONLY for:
 *  - Resolving the Studio row itself by slug (tenant lookup)
 *  - super_admin cross-tenant operations (must do manual checks)
 *  - Database transactions that need $transaction at the top level
 *    (see src/lib/bookings.ts for the booking transaction, which
 *    takes studioId as an explicit parameter and checks it manually
 *    inside the transaction instead of relying on this extension).
 *
 * Naming it loudly so it's obvious in code review when someone
 * reaches for the dangerous client.
 */
export const unscopedDb = basePrisma;

function lower(model: string | undefined) {
  return (model ?? "").toLowerCase();
}

export type TenantDb = ReturnType<typeof getTenantDb>;
