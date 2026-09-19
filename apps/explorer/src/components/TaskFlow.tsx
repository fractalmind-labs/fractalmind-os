import type { Task } from "../sui/types.ts";
import { STATUS_COLORS, truncateId, openOnSuiScan } from "./utils.ts";

interface Props {
  tasks: Task[];
}

const STEPS = [
  "created",
  "assigned",
  "submitted",
  "verified",
  "completed",
] as const;

export default function TaskFlow({ tasks }: Props) {
  const counts = Object.fromEntries(STEPS.map((s) => [s, 0]));
  for (const t of tasks) {
    if (t.status in counts) counts[t.status]++;
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-alt rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-secondary mb-3">
          Task Pipeline
        </h3>
        <div className="flex items-center justify-between overflow-x-auto gap-1 pb-1">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center shrink-0">
              <div className="text-center">
                <div
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-base sm:text-lg font-bold border-2 mx-auto"
                  style={{
                    borderColor: STATUS_COLORS[step],
                    backgroundColor: STATUS_COLORS[step] + "22",
                    color: STATUS_COLORS[step],
                  }}
                >
                  {counts[step]}
                </div>
                <div className="text-[10px] text-muted mt-1 capitalize">
                  {step}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-8 h-0.5 bg-border mx-1" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {tasks.length === 0 && (
          <div className="text-center text-muted py-8">
            No tasks found on-chain
          </div>
        )}
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => openOnSuiScan(task.id)}
            className="w-full text-left bg-surface-alt rounded-lg border border-border p-3 hover:border-border-hover transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-primary font-medium">
                {task.title || truncateId(task.id)}
              </span>
              <span
                className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize"
                style={{
                  backgroundColor: STATUS_COLORS[task.status] + "22",
                  color: STATUS_COLORS[task.status],
                  border: `1px solid ${STATUS_COLORS[task.status]}44`,
                }}
              >
                {task.status}
              </span>
            </div>
            <div className="text-xs text-muted mt-1 font-mono">
              {truncateId(task.id)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
