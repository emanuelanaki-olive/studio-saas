"use client";

/**
 * src/app/[studio_slug]/dashboard/leads/[leadId]/LeadStatusForm.tsx
 *
 * Editable status, notes, and (when status is set to "lost") a
 * required lost-reason picker. Fetches the studio's lost-reasons
 * list lazily only when the status is actually set to "lost", to
 * avoid an unnecessary request on every page load.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type LeadStatus = "new" | "contacted" | "meeting_scheduled" | "trial_scheduled" | "lost";

const STATUS_OPTIONS: LeadStatus[] = [
  "new",
  "contacted",
  "meeting_scheduled",
  "trial_scheduled",
  "lost",
];

interface LeadData {
  id: string;
  status: string;
  notes: string | null;
  lostReasonId: string | null;
}

interface LostReason {
  id: string;
  name: string;
}

export function LeadStatusForm({ studioSlug, lead }: { studioSlug: string; lead: LeadData }) {
  const router = useRouter();
  const [status, setStatus] = useState<LeadStatus>(lead.status as LeadStatus);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [lostReasonId, setLostReasonId] = useState(lead.lostReasonId ?? "");
  const [lostReasons, setLostReasons] = useState<LostReason[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status !== "lost") return;
    fetch(`/api/${studioSlug}/lead-lost-reasons`)
      .then((r) => r.json())
      .then((data) => setLostReasons(data.reasons ?? []));
  }, [status, studioSlug]);

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/${studioSlug}/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        status,
        notes: notes || undefined,
        lostReasonId: status === "lost" ? lostReasonId || undefined : null,
      }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm capitalize"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {status === "lost" && (
        <div>
          <label className="block text-sm font-medium text-slate-700">Lost reason</label>
          <select
            value={lostReasonId}
            onChange={(e) => setLostReasonId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Select a reason</option>
            {lostReasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
