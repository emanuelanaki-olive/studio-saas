/**
 * src/app/[studio_slug]/dashboard/DashboardNav.tsx
 *
 * Persistent sidebar navigation for every dashboard page. Pulled out
 * of layout.tsx into its own client component only because it needs
 * usePathname() to highlight the active link - everything else here
 * could be a Server Component, but splitting it out keeps the parent
 * layout simple.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

const NAV_ITEMS = [
  { href: "", label: "Overview" },
  { href: "/clients", label: "Clients" },
  { href: "/leads", label: "Leads" },
  { href: "/schedule", label: "Schedule" },
  { href: "/attendance", label: "Attendance" },
  { href: "/settings", label: "Settings" },
];

export function DashboardNav({ studioSlug }: { studioSlug: string }) {
  const pathname = usePathname();
  const base = `/${studioSlug}/dashboard`;

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 py-5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Studio</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{studioSlug}</p>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map((item) => {
          const href = `${base}${item.href}`;
          const isActive = item.href === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={item.href}
              href={href}
              className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-teal-50 text-teal-800"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 px-5 py-4">
        <LogoutButton />
      </div>
    </aside>
  );
}
