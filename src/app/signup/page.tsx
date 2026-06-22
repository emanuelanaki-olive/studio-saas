"use client";

/**
 * src/app/signup/page.tsx
 *
 * New studio owner signup. Posts to /api/studios (see that route for
 * what happens server-side: creates the Supabase auth user, then the
 * Studio + owner User row). On success, signs the browser in
 * immediately (the account is already created with email_confirm:
 * true) and redirects to the new dashboard.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    slug: "",
    ownerFullName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/studios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const body = await res.json();
    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Something went wrong.");
      setLoading(false);
      return;
    }

    // The account was created server-side with email_confirm: true,
    // so we can sign in immediately from the browser without an
    // email-verification round trip.
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: form.ownerEmail,
      password: form.ownerPassword,
    });

    if (signInError) {
      setError("Studio created, but auto-login failed. Please log in manually.");
      setLoading(false);
      return;
    }

    router.push(`/${body.studio.slug}/dashboard`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Create your studio</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field label="Studio name" value={form.name} onChange={(v) => update("name", v)} />
        <Field
          label="Studio URL slug"
          value={form.slug}
          onChange={(v) => update("slug", v.toLowerCase())}
          hint="Lowercase letters, numbers, hyphens only — e.g. yoga-flow"
        />
        <Field
          label="Your full name"
          value={form.ownerFullName}
          onChange={(v) => update("ownerFullName", v)}
        />
        <Field
          label="Your email"
          type="email"
          value={form.ownerEmail}
          onChange={(v) => update("ownerEmail", v)}
        />
        <Field
          label="Password"
          type="password"
          value={form.ownerPassword}
          onChange={(v) => update("ownerPassword", v)}
          hint="At least 8 characters"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create studio"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500">
        Already have a studio?{" "}
        <a href="/login" className="font-medium text-blue-700">
          Log in
        </a>
      </p>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
