"use client";

/**
 * src/app/[studio_slug]/dashboard/leads/AddLeadButton.tsx
 *
 * Modal form to manually add a new lead (e.g. someone who called or
 * walked in). Source list is fetched client-side on open rather than
 * passed down as a prop, to keep the parent Server Component page
 * simple - this is a small, infrequent fetch so the extra round trip
 * doesn't matter.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface LeadSource {
  id: string;
  name: string;
}

export function AddLeadButton({ studioSlug }: { studioSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", sourceId: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/${studioSlug}/lead-sources`)
      .then((r) => r.json())
      .then((data) => setSources(data.sources ?? []));
  }, [open, studioSlug]);

  function close() {
    setOpen(false);
    setForm({ fullName: "", phone: "", email: "", sourceId: "" });
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/${studioSlug}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.fullName,
        phone: form.phone || undefined,
        email: form.email || undefined,
        sourceId: form.sourceId || undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Could not create lead.");
      setLoading(false);
      return;
    }

    setLoading(false);
    close();
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
      >
        Add lead
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-slate-900">Add a lead</h2>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Full name</label>
                  <input
                    required
                    value={form.fullName}
                    onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Source</label>
                  <select
                    value={form.sourceId}
                    onChange={(e) => setForm((f) => ({ ...f, sourceId: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Unknown</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="flex-1 rounded-md border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-md bg-teal-700 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {loading ? "Adding..." : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
