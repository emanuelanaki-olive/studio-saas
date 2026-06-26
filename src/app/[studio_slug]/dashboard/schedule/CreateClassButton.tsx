"use client";

/**
 * src/app/[studio_slug]/dashboard/schedule/CreateClassButton.tsx
 *
 * Modal form to create a new class, posting to
 * /api/[studio_slug]/classes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Instructor {
  id: string;
  fullName: string;
}

export function CreateClassButton({
  studioSlug,
  instructors,
}: {
  studioSlug: string;
  instructors: Instructor[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    instructorId: "",
    capacity: "10",
    date: "",
    startTime: "",
    durationMin: "60",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const start = new Date(`${form.date}T${form.startTime}`);
    const end = new Date(start.getTime() + Number(form.durationMin) * 60 * 1000);

    const res = await fetch(`/api/${studioSlug}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        instructorId: form.instructorId || undefined,
        capacity: Number(form.capacity),
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Could not create class.");
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
        New class
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-slate-900">New class</h2>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Title</label>
                  <input
                    required
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Morning Flow"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Instructor</label>
                  <select
                    value={form.instructorId}
                    onChange={(e) => setForm((f) => ({ ...f, instructorId: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {instructors.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Date</label>
                    <input
                      type="date"
                      required
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Start time</label>
                    <input
                      type="time"
                      required
                      value={form.startTime}
                      onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">
                      Duration (min)
                    </label>
                    <input
                      type="number"
                      required
                      min={5}
                      value={form.durationMin}
                      onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Capacity</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={form.capacity}
                      onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
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
                  {loading ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
