/**
 * src/app/[studio_slug]/dashboard/schedule/ClassRow.tsx
 *
 * Single row in the schedule list: title, time, instructor, and a
 * booked/capacity indicator. Links through to the attendance page
 * for that class.
 */

import Link from "next/link";

interface ClassRowData {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  capacity: number;
  bookedCount: number;
  instructorName: string | null;
}

export function ClassRow({
  studioSlug,
  classData,
}: {
  studioSlug: string;
  classData: ClassRowData;
}) {
  const isFull = classData.bookedCount >= classData.capacity;

  return (
    <Link
      href={`/${studioSlug}/dashboard/attendance/${classData.id}`}
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-teal-200"
    >
      <div>
        <p className="font-medium text-slate-900">{classData.title}</p>
        <p className="text-xs text-slate-400">
          {classData.startTime.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          {classData.instructorName && <> | {classData.instructorName}</>}
        </p>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
          isFull ? "bg-amber-50 text-amber-800" : "bg-teal-50 text-teal-800"
        }`}
      >
        {classData.bookedCount}/{classData.capacity}
      </span>
    </Link>
  );
}
