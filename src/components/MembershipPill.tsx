/**
 * src/components/MembershipPill.tsx
 *
 * Compact badge showing a membership's type and remaining credit at
 * a glance. Used consistently across the Clients list, Client
 * detail, and (later) booking screens so the credit model is always
 * legible without needing a separate lookup.
 *
 * Visual language:
 *   - monthly_unlimited -> solid teal pill, "Unlimited"
 *   - monthly_limited   -> teal pill, "X/Y this period"
 *   - punch_card        -> teal pill, "X punches left"
 *   - frozen            -> slate/grey pill regardless of type, "Frozen"
 *   - expired/cancelled -> outline pill, muted
 */

type MembershipLike = {
  type: "monthly_unlimited" | "monthly_limited" | "punch_card";
  status: "active" | "expired" | "cancelled" | "frozen";
  remainingPunches: number | null;
  totalPunches: number | null;
  classesUsedThisPeriod: number;
  classesPerPeriod: number | null;
};

export function MembershipPill({ membership }: { membership: MembershipLike }) {
  const label = getLabel(membership);
  const tone = getTone(membership);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />
      {label}
    </span>
  );
}

function getLabel(m: MembershipLike): string {
  if (m.status === "frozen") return "Frozen";
  if (m.status === "expired") return "Expired";
  if (m.status === "cancelled") return "Cancelled";

  if (m.type === "monthly_unlimited") return "Unlimited";
  if (m.type === "monthly_limited") {
    return `${m.classesUsedThisPeriod}/${m.classesPerPeriod ?? "?"} this period`;
  }
  return `${m.remainingPunches ?? 0} punch${m.remainingPunches === 1 ? "" : "es"} left`;
}

type Tone = "active" | "low" | "muted";

function getTone(m: MembershipLike): Tone {
  if (m.status !== "active") return "muted";
  if (m.type === "punch_card" && (m.remainingPunches ?? 0) <= 2) return "low";
  if (
    m.type === "monthly_limited" &&
    m.classesPerPeriod !== null &&
    m.classesUsedThisPeriod >= m.classesPerPeriod - 1
  ) {
    return "low";
  }
  return "active";
}

const toneClasses: Record<Tone, string> = {
  active: "bg-teal-50 text-teal-800",
  low: "bg-amber-50 text-amber-800",
  muted: "bg-slate-100 text-slate-500",
};

const dotClasses: Record<Tone, string> = {
  active: "bg-teal-600",
  low: "bg-amber-500",
  muted: "bg-slate-400",
};
