/**
 * src/app/api/[studio_slug]/memberships/[membershipId]/route.ts
 *
 * PATCH -> freeze / unfreeze / cancel a membership (owner/staff only)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { withApiErrorHandling } from "@/lib/api-handler";
import {
  freezeMembership,
  unfreezeMembership,
  cancelMembership,
  MembershipNotFoundError,
  MembershipStateError,
} from "@/lib/memberships";

const PatchMembershipSchema = z.object({
  action: z.enum(["freeze", "unfreeze", "cancel"]),
});

export const PATCH = withApiErrorHandling(async (req, ctx) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const { membershipId } = await ctx.params;

  const body = await req.json();
  const parsed = PatchMembershipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const params = { studioId: session.studioId, membershipId };
    const membership =
      parsed.data.action === "freeze"
        ? await freezeMembership(params)
        : parsed.data.action === "unfreeze"
        ? await unfreezeMembership(params)
        : await cancelMembership(params);

    return NextResponse.json({ membership });
  } catch (err) {
    if (err instanceof MembershipNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof MembershipStateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
});
