"use client";

/**
 * src/app/[studio_slug]/portal/BookClassButton.tsx
 *
 * Small client component handling the booking submission. Kept
 * separate from the (server) PortalPage so the data fetch above
 * stays server-side while only this interactive bit ships JS to
 * the browser.
 */

import { useState } from "react";

export function BookClassButton({
  studioSlug,
  classId,
  alreadyBooked,
  isFull,
}: {
  studioSlug: string;
  classId: string;
  alreadyBooked: boolean;
  isFull: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    alreadyBooked ? "done" : "idle"
  );

  async function handleBook() {
    setStatus("loading");
    try {
      const res = await fetch(`/api/${studioSlug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      });
      if (!res.ok) throw new Error("Booking failed");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return <span className="text-sm font-medium text-green-700">Booked ✓</span>;
  }

  return (
    <button
      onClick={handleBook}
      disabled={status === "loading"}
      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {status === "loading" ? "Booking…" : isFull ? "Join waitlist" : "Book"}
      {status === "error" && <span className="ml-1 text-red-200">(retry)</span>}
    </button>
  );
}
