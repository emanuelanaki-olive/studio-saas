# Studio SaaS — Phase 1 (Core Architecture + Studio Management MVP)

Multi-tenant SaaS platform for studio businesses (classes, bookings,
memberships), built so a future **Service/Appointment** module
(Phase 2) can be added without touching the tenancy, auth, or
database-access foundations laid here.

## Stack

- **Next.js 14 (App Router)** + TypeScript + Tailwind CSS
- **PostgreSQL** via **Prisma** — built and tested against Supabase's
  hosted Postgres, but works with any Postgres (Neon, RDS, local).
- **Auth: Supabase Auth** (real email/password login, not a
  placeholder). See `src/lib/auth.ts`, `src/lib/supabase-server.ts`,
  `src/lib/supabase-browser.ts`, `src/lib/supabase-admin.ts`.

## Auth (Supabase)

Real email/password auth, fully wired:

- **Signup** (`/signup` → `POST /api/studios`): creates a Supabase
  auth user via the **admin** client (service role key — bypasses
  email confirmation so the owner can log in immediately), then
  creates the `Studio` + owner `User` row using that *same* id. If
  the database step fails, the just-created auth user is deleted so
  signup failures don't leave an orphaned login behind.
- **Login** (`/login`): plain `signInWithPassword`, then calls
  `GET /api/me` to find out which studio this person belongs to and
  routes them to `/dashboard` (owner/staff) or `/portal` (client) —
  no need to know or type a studio slug.
- **Adding clients/staff** (`POST /api/[studio_slug]/users`): an
  owner/staff member creates a new person with a temporary password
  they relay directly (simplest possible MVP flow). Swapping to
  Supabase's `inviteUserByEmail()` instead — which emails the new
  person a "set your password" link — is a small, isolated change
  noted in that file.
- **Logout**: `src/components/LogoutButton.tsx`, used on both the
  dashboard and the portal.
- **Session refresh**: handled in `src/middleware.ts`, which Supabase
  requires to run on every request so access tokens don't silently
  expire mid-session.

**The one non-obvious convention to remember**: our `users.id` is
always set to match Supabase's `auth.users.id` — we never let Prisma
generate its own id for a `User` row. This is what lets
`requireStudioAccess()` go straight from "which Supabase user is this"
to "which studio/role do they have" with a single lookup. Every place
that creates a `User` (studio signup, the users route, the seed
script) follows this — if you add another user-creation path later,
follow the same pattern.

## Tenancy model

**Single database, shared schema.** Every tenant-scoped table
(`users`, `classes`, `bookings`, `memberships`) has a `studio_id`
foreign key. There is no `CREATE SCHEMA per tenant` and no separate
database per tenant — this keeps migrations, connection pooling, and
cross-tenant analytics simple at MVP scale, at the cost of needing
rigorous application-layer (and optionally Postgres RLS) enforcement
that every query is scoped correctly.

**Tenant resolution**: path-based, `/[studio_slug]/...`. The slug is
extracted in `src/middleware.ts` (Edge runtime, no DB access) and
attached as an `x-studio-slug` request header. The actual
studio-membership check happens in `src/lib/auth.ts ->
requireStudioAccess()`, which runs in the Node runtime and is called
at the top of every Server Component, Route Handler, or Server
Action that touches tenant data.

A sub-domain alternative (`studio_slug.yourapp.com`) is sketched as a
comment at the bottom of `middleware.ts` for when/if you need
custom-domain support per studio — swapping to it only changes the
slug-extraction line.

## How cross-tenant leaks are prevented

This is the part worth reading carefully before extending the app:

1. **`src/lib/db.ts` — `getTenantDb(studioId)`**
   Returns a Prisma Client Extension, not the raw client. The
   extension auto-injects `studioId` into the `where` of every
   `findMany` / `findFirst` / `count` / `update` / `delete` (and
   `data` on `create`) for tenant-scoped models. `findUnique` is
   handled specially (Prisma doesn't allow extra `where` clauses on
   unique lookups) by checking the result's `studioId` after the
   fetch and returning `null` if it belongs to another tenant.

   The raw client is exported as `unscopedDb` — deliberately named
   loudly so reviewers notice it in a PR. It's used only for: looking
   up the Studio row itself by slug (you don't have a studioId yet at
   that point), and inside the booking transaction (see below), where
   studioId is checked manually at every step instead.

2. **`src/lib/auth.ts` — `requireStudioAccess()`**
   Resolves the studio from the slug, loads the session user, and
   throws unless the user's `studioId` matches (or they're
   `super_admin`). Returns a `SessionContext` with a verified
   `studioId` — this is the *only* studioId that should ever be
   passed into `getTenantDb()`. Never trust a `studioId` from a
   request body or query string.

3. **Postgres Row-Level Security** (`prisma/schema.sql`, bottom
   section) — included as defense-in-depth for Supabase deployments.
   Optional if you're not on Supabase, but recommended.

## The booking transaction (`src/lib/bookings.ts`)

This is the trickiest correctness requirement in the spec: prevent
overbooking and prevent a punch-card balance from going negative
under concurrent requests.

- `createBooking()` runs at **Serializable** isolation inside a
  single `$transaction`. It re-reads the class capacity and the
  membership's remaining punches *inside* the transaction,
  immediately before writing. If two requests race, Postgres itself
  detects the conflict (SQLSTATE `40001`) and aborts one — which this
  code catches and retries (up to 2 times) rather than surfacing a
  500 to the user.
- If the class is full, the booking is created with `status:
  "waitlist"` instead of being rejected outright (per the MVP spec).
- `cancelBooking()` refunds a punch (if applicable) and promotes the
  oldest waitlisted booking for that class — also inside one
  transaction.
- A focused test suite for this lives in `src/lib/bookings.test.ts`,
  including a test that fires two bookings concurrently at a
  capacity-1 class and asserts exactly one comes back `"booked"`.

**Known simplification**: `Booking` doesn't yet store *which*
membership paid for it. Cancellation refunds a punch by looking up
the client's current active punch-card membership, which is correct
as long as a client has at most one active punch card at a time —
true for MVP scope, called out in code comments for when you outgrow it.

## Project layout

```
prisma/
  schema.prisma       Prisma schema (source of truth)
  schema.sql           Raw SQL equivalent + RLS policies (for non-Prisma-migrate workflows)
  seed.ts              Seeds two tenants + REAL Supabase logins (see Setup below)
src/
  middleware.ts         Tenant-slug resolution + Supabase session refresh
  lib/
    db.ts               getTenantDb() / unscopedDb
    auth.ts             requireStudioAccess() / requireStudioAccessForPage()
    supabase-server.ts   Supabase client for Server Components/Route Handlers
    supabase-browser.ts  Supabase client for Client Components
    supabase-admin.ts    Service-role client (signup, user creation only)
    api-handler.ts       Shared error -> HTTP status mapping
    bookings.ts          createBooking() / cancelBooking() transactions
    bookings.test.ts     Concurrency + business-rule tests
  components/
    LogoutButton.tsx
  app/
    login/page.tsx       Email/password login
    signup/page.tsx       New studio + owner signup
    [studio_slug]/
      dashboard/page.tsx  Owner/staff dashboard shell (CRM/scheduler/attendance stats)
      portal/page.tsx     Client-facing mobile schedule + booking
      portal/BookClassButton.tsx
    api/
      me/route.ts                            "Which studio/role am I?" (used right after login)
      studios/route.ts                       Studio + owner signup
      [studio_slug]/users/route.ts            Owner/staff adds clients or staff
      [studio_slug]/classes/route.ts          List/create classes
      [studio_slug]/bookings/route.ts         List/create bookings
      [studio_slug]/bookings/[bookingId]/route.ts   Cancel / mark attendance
      [studio_slug]/memberships/route.ts      List/create memberships & punch cards
```

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. From your Supabase project, grab three values:
   - **Settings → Database → Connection string** (URI) → this is your `DATABASE_URL`
   - **Settings → API → Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Settings → API → anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Settings → API → service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret — never commit it or expose it to the browser)
3.
   ```bash
   cp .env.example .env   # paste in the four values above
   npm install
   npx prisma migrate dev   # creates tables from prisma/schema.prisma
   npx prisma db seed       # creates 2 demo studios + real Supabase logins
   npm run dev
   ```
4. Open `http://localhost:3000/login` and sign in with one of the
   accounts the seed script prints to your terminal (all use the
   password `Password123!`) — or visit `http://localhost:3000/signup`
   to create your own studio from scratch.

## What's deliberately NOT built yet (Phase 2+)

- The `Service` / `Appointment` models (sketched as comments at the
  bottom of `schema.prisma` and `schema.sql`) — they'd follow the
  identical `studio_id`-scoping pattern, so no changes to middleware,
  auth, or `getTenantDb` are needed when you add them; just register
  the new Prisma model names in `TENANT_SCOPED_MODELS` in `db.ts`.
- Billing / Stripe integration for studio subscriptions to the SaaS
  itself (separate from clients' studio memberships).
- The dashboard's CRM/scheduler/attendance pages currently show
  summary stats only on the shell page — the three linked sub-pages
  (`/dashboard/clients`, `/dashboard/schedule`, `/dashboard/attendance`)
  aren't built yet; the API routes they'd call (`classes`, `bookings`,
  `memberships`, `users`) already exist and are ready to wire up.
- Adding a client/staff member currently uses a temporary password the
  owner sets and relays directly — there's no email invite yet. See
  the note in `src/app/api/[studio_slug]/users/route.ts` for the
  one-block change to switch to `inviteUserByEmail()` instead.
- Password reset / "forgot password" flow isn't built — Supabase
  supports it out of the box via `resetPasswordForEmail()`, just
  needs a page + route added.
