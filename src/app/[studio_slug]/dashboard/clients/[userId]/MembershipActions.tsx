"use client";

/**
 * src/app/[studio_slug]/dashboard/clients/[userId]/MembershipActions.tsx
 *
 * Freeze / unfreeze / cancel buttons for a single membership row,
 * calling PATCH /api/[studio_slug]/memberships/[membershipId].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface MembershipData {
  id: string;
  status: "active" | "expired" | "cancelled" | "frozen";
}

export function MembershipActions({
  studioSlug,
  membership,
}: {
  studioSlug: string;
  membership: MembershipData;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: "freeze" | "unfreeze" | "cancel") {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/${studioSlug}/memberships/${membership.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Action failed.");
      setLoading(false);
      return;
    }
    setLoading(false);
    router.refresh();
  }

  if (membership.status === "cancelled" || membership.status === "expired") {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-600">{error}</span>}
      {membership.status === "active" && (
        <button
          onClick={() => runAction("freeze")}
          disabled={loading}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Freeze
        </button>
      )}
      {membership.status === "frozen" && (
        <button
          onClick={() => runAction("unfreeze")}
          disabled={loading}
          className="rounded-md border border-teal-300 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
        >
          Unfreeze
        </button>
      )}
      <button
        onClick={() => runAction("cancel")}
        disabled={loading}
        className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
