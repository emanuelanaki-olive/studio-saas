"use client";

/**
 * src/app/[studio_slug]/dashboard/attendance/[classId]/AttendanceActions.tsx
 *
 * Mark attended / no-show / cancel buttons for a single booking row,
 * calling PATCH /api/[studio_slug]/bookings/[bookingId].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AttendanceActions({
  studioSlug,
  bookingId,
  status,
}: {
  studioSlug: string;
  bookingId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function runAction(action: "cancel" | "mark_attended" | "mark_no_show") {
    setLoading(true);
    await fetch(`/api/${studioSlug}/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setLoading(false);
    router.refresh();
  }

  if (status !== "booked" && status !== "attended") {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {status === "booked" && (
        <button
          onClick={() => runAction("mark_attended")}
          disabled={loading}
          className="rounded-md border border-teal-300 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
        >
          Attended
        </button>
      )}
      <button
        onClick={() => runAction("mark_no_show")}
        disabled={loading}
        className="rounded-md border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
      >
        No show
      </button>
      <button
        onClick={() => runAction("cancel")}
        disabled={loading}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
