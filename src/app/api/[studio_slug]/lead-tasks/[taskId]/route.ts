/**
 * src/app/api/[studio_slug]/lead-tasks/[taskId]/route.ts
 *
 * PATCH -> mark a task complete (or reopen it)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioAccess } from "@/lib/auth";
import { getTenantDb } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/api-handler";

const PatchTaskSchema = z.object({
  action: z.enum(["complete", "reopen"]),
});

export const PATCH = withApiErrorHandling(async (req, ctx) => {
  const session = await requireStudioAccess({ minRole: ["owner", "staff"] });
  const { taskId } = await ctx.params;
  const db = getTenantDb(session.studioId);

  const body = await req.json();
  const parsed = PatchTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const task = await db.leadTask.update({
    where: { id: taskId },
    data: { completedAt: parsed.data.action === "complete" ? new Date() : null },
  });

  return NextResponse.json({ task });
});
