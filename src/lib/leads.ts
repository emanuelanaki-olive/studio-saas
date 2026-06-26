/**
 * src/lib/leads.ts
 *
 * Lead lifecycle logic. Most CRUD on leads/tasks is simple enough to
 * live directly in the route handlers (see
 * src/app/api/[studio_slug]/leads/), but conversion is pulled out
 * here because it has a real side effect worth isolating: creating
 * a brand new Supabase Auth user, the same pattern used by studio
 * signup and the existing users route (see comments there for why
 * id must match between auth.users and our own users table).
 */

import { unscopedDb } from "./db";
import { createSupabaseAdminClient } from "./supabase-admin";

export class LeadNotFoundError extends Error {}
export class LeadAlreadyConvertedError extends Error {}

interface ConvertLeadParams {
  studioId: string;
  leadId: string;
  temporaryPassword: string;
}

/**
 * Converts a lead into a real client: creates a Supabase auth user
 * (same convention as elsewhere - id matches across both tables),
 * creates the User row, and updates the Lead to status=converted
 * with convertedUserId pointing at the new user. If creating the
 * User row fails after the auth user was created, the auth user is
 * deleted so we don't leave an orphaned login behind - identical
 * cleanup pattern to src/app/api/studios/route.ts and
 * src/app/api/[studio_slug]/users/route.ts.
 */
export async function convertLead({ studioId, leadId, temporaryPassword }: ConvertLeadParams) {
  const lead = await unscopedDb.lead.findFirst({ where: { id: leadId, studioId } });
  if (!lead) {
    throw new LeadNotFoundError("Lead not found for this studio.");
  }
  if (lead.status === "converted") {
    throw new LeadAlreadyConvertedError("This lead has already been converted.");
  }
  if (!lead.email) {
    throw new Error("Lead has no email on file - cannot create a login without one.");
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: lead.email,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    throw new Error(authError?.message ?? "Could not create the account.");
  }

  try {
    const [user] = await unscopedDb.$transaction([
      unscopedDb.user.create({
        data: {
          id: authData.user.id,
          studioId,
          email: lead.email,
          fullName: lead.fullName,
          phone: lead.phone,
          role: "client",
          clientStatus: "active",
        },
      }),
      unscopedDb.lead.update({
        where: { id: lead.id },
        data: { status: "converted", convertedUserId: authData.user.id },
      }),
    ]);
    return user;
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch(() => {
      console.error(`Orphaned Supabase auth user after failed lead conversion: ${authData.user.id}`);
    });
    throw err;
  }
}
