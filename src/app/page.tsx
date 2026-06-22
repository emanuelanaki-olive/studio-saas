/**
 * src/app/page.tsx
 *
 * Root landing page. Keeps this app usable when someone visits
 * "/" directly instead of a studio-specific URL — without this,
 * the empty path would fall through to middleware's tenant
 * resolution and fail with "studio not found."
 */

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Studio SaaS</h1>
      <p className="text-slate-500">Multi-tenant studio management platform.</p>
      <div className="flex gap-3">
        <a
          href="/login"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          Log in
        </a>
        <a
          href="/signup"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
        >
          Create a studio
        </a>
      </div>
    </main>
  );
}
