/**
 * src/app/[studio_slug]/dashboard/layout.tsx
 *
 * Wraps every page under /[studio_slug]/dashboard/* with the
 * persistent sidebar nav, and runs the owner/staff auth check ONCE
 * here rather than repeating requireStudioAccessForPage() at the top
 * of every dashboard page file.
 */

import { requireStudioAccessForPage } from "@/lib/auth";
import { DashboardNav } from "./DashboardNav";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ studio_slug: string }>;
}) {
  const { studio_slug } = await params;
  await requireStudioAccessForPage({ minRole: ["owner", "staff"] });

  return (
    <div className="flex min-h-screen bg-slate-50">
      <DashboardNav studioSlug={studio_slug} />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
