/**
 * src/app/api/me/route.ts
 *
 * Tiny helper endpoint: "given my current Supabase session, which
 * studio do I belong to and what's my role?" Used right after login
 * (see src/app/login/page.tsx) so the person doesn't need to know
 * or type their studio's slug — we look it up server-side instead.
 *
 * Deliberately does NOT go through requireStudioAccess(), since that
 * function needs a studio slug up front and the whole point of this
 * route is figuring out the slug in the first place.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { unscopedDb } from "@/lib/db";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await unscopedDb.user.findUnique({
    where: { id: data.user.id },
    include: { studio: { select: { slug: true } } },
  });

  if (!user || !user.studio) {
    return NextResponse.json({ error: "No studio found for this account." }, { status: 404 });
  }

  return NextResponse.json({ studioSlug: user.studio.slug, role: user.role });
}
