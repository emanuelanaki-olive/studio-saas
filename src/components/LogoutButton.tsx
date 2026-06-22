"use client";

/**
 * src/components/LogoutButton.tsx
 *
 * Small shared client component used on both the dashboard and the
 * client portal. Signs out of Supabase and sends the person back to
 * /login.
 */

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button onClick={handleLogout} className="text-sm font-medium text-slate-500 hover:text-slate-700">
      Log out
    </button>
  );
}
