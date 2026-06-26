"use client";

/**
 * src/app/[studio_slug]/dashboard/leads/[leadId]/ConvertLeadButton.tsx
 *
 * Converts a lead into a real client (Supabase auth user + User
 * row), generating a temporary password the same way AddClientButton
 * does on the Clients page - see that component for the rationale on
 * relaying the password directly versus an email invite flow.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConvertLeadButton({
  studioSlug,
  leadId,
  hasEmail,
}: {
  studioSlug: string;
  leadId: string;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  async function handleConvert() {
    setLoading(true);
    setError(null);
    const temporaryPassword = generateTemporaryPassword();

    const res = await fetch(`/api/${studioSlug}/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "convert", temporaryPassword }),
    });

    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Could not convert lead.");
      setLoading(false);
      return;
    }

    setCreatedPassword(temporaryPassword);
    setLoading(false);
  }

  function close() {
    setOpen(false);
    setError(null);
    setCreatedPassword(null);
    if (createdPassword) router.refresh();
  }

  if (!hasEmail) {
    return (
      <span className="text-xs text-slate-400" title="Add an email to this lead before converting">
        Add an email to convert
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
      >
        Convert to client
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            {createdPassword ? (
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Lead converted</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Share this temporary password so they can log in. It will not be shown again.
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
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Convert this lead?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  This creates a real account for them and marks the lead as converted.
                </p>
                {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
                <div className="mt-5 flex gap-2">
                  <button
                    onClick={close}
                    className="flex-1 rounded-md border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConvert}
                    disabled={loading}
                    className="flex-1 rounded-md bg-teal-700 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    {loading ? "Converting..." : "Convert"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
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
