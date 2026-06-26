"use client";

/**
 * src/app/[studio_slug]/dashboard/settings/SettingsForm.tsx
 *
 * Simple number input + save button for cancellationWindowHours.
 * Disabled for staff (view-only) since the API also enforces
 * owner-only on PATCH - this just avoids a confusing 403 round trip.
 */

import { useState } from "react";

export function SettingsForm({
  studioSlug,
  isOwner,
  initialHours,
}: {
  studioSlug: string;
  isOwner: boolean;
  initialHours: number;
}) {
  const [hours, setHours] = useState(initialHours);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/${studioSlug}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancellationWindowHours: hours }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Could not save.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setSavedAt(Date.now());
  }

  return (
    <div className="mt-4 flex items-end gap-3">
      <div>
        <label className="block text-sm font-medium text-slate-700">Hours before start</label>
        <input
          type="number"
          min={0}
          max={168}
          value={hours}
          disabled={!isOwner}
          onChange={(e) => setHours(Number(e.target.value))}
          className="mt-1 w-28 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
        />
      </div>
      {isOwner && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      )}
      {savedAt && !saving && <span className="text-sm text-teal-700">Saved</span>}
      {error && <span className="text-sm text-rose-600">{error}</span>}
    </div>
  );
}
