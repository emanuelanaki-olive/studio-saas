/**
 * prisma/seed.ts
 *
 * Seeds TWO studios with overlapping data on purpose, so you can
 * manually verify tenant isolation: log in as a user from
 * "yoga-flow" and confirm you can never see "pilates-pro" data, and
 * vice versa, even though both have a class called "Morning Flow"
 * at a similar time.
 *
 * Every seeded person also gets a REAL Supabase auth account (same
 * password for all of them, for convenience: see DEMO_PASSWORD
 * below), so you can immediately log in at /login as any of them.
 *
 * Run with: npx prisma db seed
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to
 * be set in your .env (same ones the app itself uses).
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Password123!";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your .env — " +
      "the seed script needs both to create matching Supabase auth users."
  );
  process.exit(1);
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Creates a Supabase auth user and returns its id, which we then use
 * as the id for the matching Prisma `User` row — this is the same
 * "id must match" convention the real app follows (see
 * src/lib/auth.ts and src/app/api/studios/route.ts).
 */
async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create Supabase auth user for ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function main() {
  // ---- Studio 1: Yoga Flow ----
  const yogaFlow = await prisma.studio.create({
    data: { name: "Yoga Flow Studio", slug: "yoga-flow" },
  });

  const yogaOwnerAuthId = await createAuthUser("owner@yogaflow.example");
  const yogaOwner = await prisma.user.create({
    data: {
      id: yogaOwnerAuthId,
      studioId: yogaFlow.id,
      email: "owner@yogaflow.example",
      fullName: "Dana Levi",
      role: "owner",
    },
  });

  const yogaInstructorAuthId = await createAuthUser("instructor@yogaflow.example");
  const yogaInstructor = await prisma.user.create({
    data: {
      id: yogaInstructorAuthId,
      studioId: yogaFlow.id,
      email: "instructor@yogaflow.example",
      fullName: "Maya Cohen",
      role: "staff",
    },
  });

  const yogaClientAuthId = await createAuthUser("client@yogaflow.example");
  const yogaClient = await prisma.user.create({
    data: {
      id: yogaClientAuthId,
      studioId: yogaFlow.id,
      email: "client@yogaflow.example",
      fullName: "Noa Bar",
      phone: "+972501234567",
      role: "client",
    },
  });

  const yogaClass = await prisma.class.create({
    data: {
      studioId: yogaFlow.id,
      title: "Morning Flow",
      instructorId: yogaInstructor.id,
      capacity: 2, // intentionally small to test overbooking/waitlist
      startTime: new Date(Date.now() + 1000 * 60 * 60 * 24),
      endTime: new Date(Date.now() + 1000 * 60 * 60 * 25),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    },
  });

  await prisma.membership.create({
    data: {
      studioId: yogaFlow.id,
      clientId: yogaClient.id,
      type: "punch_card",
      totalPunches: 10,
      remainingPunches: 1, // intentionally low to test the InsufficientPunches path
    },
  });

  // ---- Studio 2: Pilates Pro (deliberately similar names/data) ----
  const pilatesPro = await prisma.studio.create({
    data: { name: "Pilates Pro", slug: "pilates-pro" },
  });

  const pilatesOwnerAuthId = await createAuthUser("owner@pilatespro.example");
  const pilatesOwner = await prisma.user.create({
    data: {
      id: pilatesOwnerAuthId,
      studioId: pilatesPro.id,
      email: "owner@pilatespro.example",
      fullName: "Tom Aviv",
      role: "owner",
    },
  });

  const pilatesClientAuthId = await createAuthUser("client@pilatespro.example");
  const pilatesClient = await prisma.user.create({
    data: {
      id: pilatesClientAuthId,
      studioId: pilatesPro.id,
      email: "client@pilatespro.example",
      fullName: "Noa Bar", // same name as the yoga client, different person/tenant
      role: "client",
    },
  });

  await prisma.class.create({
    data: {
      studioId: pilatesPro.id,
      title: "Morning Flow", // same title as yoga-flow's class, different studio
      capacity: 8,
      startTime: new Date(Date.now() + 1000 * 60 * 60 * 24),
      endTime: new Date(Date.now() + 1000 * 60 * 60 * 25),
    },
  });

  await prisma.membership.create({
    data: {
      studioId: pilatesPro.id,
      clientId: pilatesClient.id,
      type: "monthly_subscription",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });

  console.log("\nSeeded two tenants. Every login below uses the password: " + DEMO_PASSWORD + "\n");
  console.log(`yoga-flow (/yoga-flow/dashboard or /portal):`);
  console.log(`  owner:      ${yogaOwner.email}`);
  console.log(`  instructor: ${yogaInstructor.email}`);
  console.log(`  client:     ${yogaClient.email}`);
  console.log(`\npilates-pro:`);
  console.log(`  owner:  ${pilatesOwner.email}`);
  console.log(`  client: ${pilatesClient.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
