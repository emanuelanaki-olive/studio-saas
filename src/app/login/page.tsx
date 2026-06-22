"use client";

/**
 * src/app/login/page.tsx
 *
 * Real email/password login via Supabase Auth. On success, looks up
 * which studio this user belongs to and redirects to the right
 * dashboard or portal — the person doesn't need to know their studio
 * slug in advance.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // Find out which studio this user belongs to so we can route
    // them without asking for a slug. This calls a small lookup
    // route rather than querying Prisma directly from the browser.
    const res = await fetch("/api/me");
    if (!res.ok) {
      setError("Signed in, but couldn't find your studio. Contact support.");
      setLoading(false);
      return;
    }
    const { studioSlug, role } = await res.json();

    router.push(
      role === "owner" || role === "staff" ? `/${studioSlug}/dashboard` : `/${studioSlug}/portal`
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Log in</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Log in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500">
        Don&apos;t have a studio yet?{" "}
        <a href="/signup" className="font-medium text-blue-700">
          Create one
        </a>
      </p>
    </main>
  );
}
