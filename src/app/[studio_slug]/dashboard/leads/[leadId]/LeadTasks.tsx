"use client";

/**
 * src/app/[studio_slug]/dashboard/leads/[leadId]/LeadTasks.tsx
 *
 * Follow-up task list for one lead: shows existing tasks (open ones
 * first, with a checkbox to mark complete), and a small inline form
 * to add a new one. Kept as a single client component rather than
 * splitting "list" and "add form" further, since both pieces of
 * state (task list, new-task draft) are small and closely related.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Task {
  id: string;
  type: string;
  description: string | null;
  dueAt: Date;
  completedAt: Date | null;
}

export function LeadTasks({
  studioSlug,
  leadId,
  initialTasks,
}: {
  studioSlug: string;
  leadId: string;
  initialTasks: Task[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [description, setDescription] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const openTasks = initialTasks.filter((t) => !t.completedAt);
  const doneTasks = initialTasks.filter((t) => t.completedAt);

  async function toggleComplete(task: Task) {
    setBusyTaskId(task.id);
    await fetch(`/api/${studioSlug}/lead-tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: task.completedAt ? "reopen" : "complete" }),
    });
    setBusyTaskId(null);
    router.refresh();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`/api/${studioSlug}/lead-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId,
        description: description || undefined,
        dueAt: new Date(dueAt).toISOString(),
      }),
    });
    setAdding(false);
    setDueAt("");
    setDescription("");
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3">
      {openTasks.map((task) => (
        <TaskRow key={task.id} task={task} busy={busyTaskId === task.id} onToggle={toggleComplete} />
      ))}
      {doneTasks.length > 0 && (
        <details className="text-sm text-slate-400">
          <summary className="cursor-pointer">{doneTasks.length} completed</summary>
          <div className="mt-2 space-y-2">
            {doneTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                busy={busyTaskId === task.id}
                onToggle={toggleComplete}
              />
            ))}
          </div>
        </details>
      )}

      {adding ? (
        <form onSubmit={handleAdd} className="space-y-2 rounded-md border border-slate-200 p-3">
          <input
            type="datetime-local"
            required
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="flex-1 rounded-md border border-slate-300 py-1.5 text-sm text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-md bg-teal-700 py-1.5 text-sm font-medium text-white"
            >
              Add task
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-sm font-medium text-teal-700 hover:text-teal-800"
        >
          + Add follow-up task
        </button>
      )}
    </div>
  );
}

function TaskRow({
  task,
  busy,
  onToggle,
}: {
  task: Task;
  busy: boolean;
  onToggle: (task: Task) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={!!task.completedAt}
        disabled={busy}
        onChange={() => onToggle(task)}
        className="rounded border-slate-300"
      />
      <span className={task.completedAt ? "text-slate-400 line-through" : "text-slate-900"}>
        {new Date(task.dueAt).toLocaleString()} {task.description && `- ${task.description}`}
      </span>
    </label>
  );
}
