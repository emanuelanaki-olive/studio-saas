"use client";

/**
 * src/app/[studio_slug]/dashboard/clients/AddClientButton.tsx
 *
 * Opens a modal to create a new client, posting to
 * /api/[studio_slug]/users. Generates a random temporary password
 * client-side (the current flow has the studio relay it directly to
 * the new client - see the note in that route about switching to
 * inviteUserByEmail() later) and shows it after creation so it can
 * be copied and shared.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddClientButton({ studioSlug }: { studioSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setForm({ fullName: "", email: "", phone: "" });
    setError(null);
    setCreatedPassword(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const temporaryPassword = generateTemporaryPassword();

    const res = await fetch(`/api/${studioSlug}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.fullName,
        email: form.email,
        phone: form.phone || undefined,
        role: "client",
        temporaryPassword,
      }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Could not create client.");
      setLoading(false);
      return;
    }

    setCreatedPassword(temporaryPassword);
    setLoading(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
      >
        Add client
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            {createdPassword ? (
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Client created</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Share this temporary password with {form.fullName} so they can log in. It
                  will not be shown again.
                </p>
                <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 font-mono text-sm text-slate-800">
                  {createdPassword}
                </div>
                <button
                  onClick={close}
                  className="mt-4 w-full rounded-md bg-teal-700 py-2 text-sm font-medium text-white hover:bg-teal-800"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <h2 className="text-lg font-semibold text-slate-900">Add a client</h2>
                <div className="mt-4 space-y-3">
                  <Field
                    label="Full name"
                    value={form.fullName}
                    onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
                  />
                  <Field
                    label="Email"
                    type="email"
                    value={form.email}
                    onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                  />
                  <Field
                    label="Phone (optional)"
                    value={form.phone}
                    onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                  />
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
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        required={type !== "tel"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
    </div>
  );
}

function generateTemporaryPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
