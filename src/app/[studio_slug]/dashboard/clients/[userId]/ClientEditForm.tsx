"use client";

/**
 * src/app/[studio_slug]/dashboard/clients/[userId]/ClientEditForm.tsx
 *
 * Inline-editable CRM fields for a client: phone, status, health
 * declaration, medical notes, birth date. PATCHes
 * /api/[studio_slug]/users/[userId] on save.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

type ClientStatus = "lead" | "active" | "inactive" | "frozen";

interface ClientData {
  id: string;
  phone: string | null;
  clientStatus: ClientStatus | null;
  healthDeclaration: boolean;
  medicalNotes: string | null;
  birthDate: Date | null;
}

const STATUS_OPTIONS: ClientStatus[] = ["lead", "active", "inactive", "frozen"];

export function ClientEditForm({
  studioSlug,
  client,
}: {
  studioSlug: string;
  client: ClientData;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    phone: client.phone ?? "",
    clientStatus: client.clientStatus ?? "active",
    healthDeclaration: client.healthDeclaration,
    medicalNotes: client.medicalNotes ?? "",
    birthDate: client.birthDate ? toDateInputValue(client.birthDate) : "",
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/${studioSlug}/users/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: form.phone || undefined,
        clientStatus: form.clientStatus,
        healthDeclaration: form.healthDeclaration,
        medicalNotes: form.medicalNotes || undefined,
        birthDate: form.birthDate || undefined,
      }),
    });
    setSaving(false);
    setSavedAt(Date.now());
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Status</label>
          <select
            value={form.clientStatus}
            onChange={(e) =>
              setForm((f) => ({ ...f, clientStatus: e.target.value as ClientStatus }))
            }
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm capitalize"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700">Date of birth</label>
        <input
          type="date"
          value={form.birthDate}
          onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.healthDeclaration}
          onChange={(e) => setForm((f) => ({ ...f, healthDeclaration: e.target.checked }))}
          className="rounded border-slate-300"
        />
        Health declaration signed
      </label>

      <div>
        <label className="block text-sm font-medium text-slate-700">
          Medical notes / restrictions
        </label>
        <textarea
          value={form.medicalNotes}
          onChange={(e) => setForm((f) => ({ ...f, medicalNotes: e.target.value }))}
          rows={3}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {savedAt && !saving && <span className="text-sm text-teal-700">Saved</span>}
      </div>
    </div>
  );
}

function toDateInputValue(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}
