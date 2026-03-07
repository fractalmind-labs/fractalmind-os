import { truncateId, openOnSuiScan, STATUS_COLORS } from "./utils.ts";
import type {
  Organization,
  AgentCertificate,
  Task,
  PeerNode,
} from "../sui/types.ts";

export interface DetailItem {
  type: "org" | "suborg" | "agent" | "task" | "peer";
  data: Organization | AgentCertificate | Task | PeerNode;
}

interface Props {
  item: DetailItem | null;
  onClose: () => void;
}

function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: (color ?? "#4b5563") + "22",
        color: color ?? "#9ca3af",
        border: `1px solid ${color ?? "#4b5563"}44`,
      }}
    >
      {label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div className="text-sm text-gray-200">{value}</div>
    </div>
  );
}

function IdLink({ id }: { id: string }) {
  return (
    <button
      onClick={() => openOnSuiScan(id)}
      className="text-fractal-400 hover:text-fractal-300 font-mono text-xs underline decoration-dotted cursor-pointer"
      title="View on SuiScan"
    >
      {truncateId(id)}
    </button>
  );
}

function getDisplayName(item: DetailItem): string {
  const d = item.data as unknown as Record<string, unknown>;
  if (typeof d.name === "string" && d.name) return d.name;
  if (typeof d.title === "string" && d.title) return d.title;
  if (typeof d.node_id === "string" && d.node_id) return d.node_id;
  if (typeof d.agent === "string" && d.agent) return truncateId(d.agent as string, 4);
  return truncateId(String(d.id ?? ""));
}

export default function DetailPanel({ item, onClose }: Props) {
  if (!item) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-gray-900/95 backdrop-blur-sm border-l border-gray-800 shadow-2xl z-50 overflow-y-auto animate-flow-in">
      {/* Header */}
      <div className="sticky top-0 bg-gray-900/90 backdrop-blur-sm border-b border-gray-800 px-5 py-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider">
            {item.type === "suborg" ? "Sub-Organization" : item.type}
          </div>
          <h2 className="text-lg font-semibold text-white mt-0.5">
            {getDisplayName(item)}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        <Field label="Object ID" value={<IdLink id={(item.data as { id: string }).id} />} />

        {(item.type === "org" || item.type === "suborg") && (
          <OrgDetail org={item.data as Organization} />
        )}
        {item.type === "agent" && (
          <AgentDetail agent={item.data as AgentCertificate} />
        )}
        {item.type === "task" && <TaskDetail task={item.data as Task} />}
        {item.type === "peer" && <PeerDetail peer={item.data as PeerNode} />}
      </div>
    </div>
  );
}

function OrgDetail({ org }: { org: Organization }) {
  return (
    <>
      <Field label="Description" value={org.description || "—"} />
      <Field label="Depth" value={String(org.depth)} />
      <Field
        label="Active"
        value={
          <Badge
            label={org.is_active ? "Yes" : "No"}
            color={org.is_active ? "#20c997" : "#ff6b6b"}
          />
        }
      />
      <Field label="Admin" value={<IdLink id={org.admin} />} />
      {org.parent_org && (
        <Field label="Parent Org" value={<IdLink id={org.parent_org} />} />
      )}
      <Field
        label={`Agents (${org.agent_count})`}
        value={
          org.agent_addresses.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {org.agent_addresses.map((a) => (
                <IdLink key={a} id={a} />
              ))}
            </div>
          ) : (
            "None"
          )
        }
      />
      <Field
        label={`Child Orgs (${org.child_org_count})`}
        value={
          org.child_org_ids.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {org.child_org_ids.map((id) => (
                <IdLink key={id} id={id} />
              ))}
            </div>
          ) : (
            "None"
          )
        }
      />
      <Field label="Tasks" value={`${org.task_count} task(s)`} />
    </>
  );
}

function AgentDetail({ agent }: { agent: AgentCertificate }) {
  return (
    <>
      <Field label="Agent Address" value={<IdLink id={agent.agent} />} />
      <Field
        label="Status"
        value={
          <Badge
            label={agent.status}
            color={STATUS_COLORS[agent.status]}
          />
        }
      />
      <Field label="Organization" value={<IdLink id={agent.org_id} />} />
      <Field
        label="Capabilities"
        value={
          agent.capability_tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {agent.capability_tags.map((c, i) => (
                <Badge key={i} label={c} />
              ))}
            </div>
          ) : (
            "None"
          )
        }
      />
      <Field
        label="Reputation Score"
        value={String(agent.reputation_score)}
      />
      <Field
        label="Tasks Completed"
        value={String(agent.tasks_completed)}
      />
    </>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const steps: Array<{ label: string; key: string }> = [
    { label: "Created", key: "created" },
    { label: "Assigned", key: "assigned" },
    { label: "Submitted", key: "submitted" },
    { label: "Verified", key: "verified" },
    { label: "Completed", key: "completed" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === task.status);

  return (
    <>
      <Field label="Description" value={task.description || "—"} />
      <Field
        label="Status"
        value={
          <Badge
            label={task.status}
            color={STATUS_COLORS[task.status]}
          />
        }
      />

      {/* Task lifecycle flow */}
      <div className="my-4">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
          Lifecycle
        </div>
        <div className="flex items-center gap-1">
          {steps.map((step, i) => {
            const isComplete = i <= currentIdx;
            const isCurrent = i === currentIdx;
            return (
              <div key={step.key} className="flex items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                    isCurrent
                      ? "border-fractal-400 bg-fractal-400/20 text-fractal-300"
                      : isComplete
                        ? "border-green-500 bg-green-500/20 text-green-400"
                        : "border-gray-700 bg-gray-800 text-gray-600"
                  }`}
                >
                  {isComplete && !isCurrent ? "✓" : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`w-4 h-0.5 ${
                      i < currentIdx ? "bg-green-500" : "bg-gray-700"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-1 px-0.5">
          {steps.map((step) => (
            <span key={step.key} className="text-[10px] text-gray-600">
              {step.label}
            </span>
          ))}
        </div>
      </div>

      <Field label="Creator" value={<IdLink id={task.creator} />} />
      <Field
        label="Assignee"
        value={task.assignee ? <IdLink id={task.assignee} /> : "Unassigned"}
      />
      {task.verifier && (
        <Field label="Verifier" value={<IdLink id={task.verifier} />} />
      )}
      {task.submission && (
        <Field label="Submission" value={task.submission} />
      )}
      <Field label="Organization" value={<IdLink id={task.org_id} />} />
    </>
  );
}

function PeerDetail({ peer }: { peer: PeerNode }) {
  return (
    <>
      <Field label="Node ID" value={peer.node_id} />
      <Field label="Endpoint" value={peer.endpoint || "—"} />
      <Field
        label="Status"
        value={
          <Badge
            label={peer.status}
            color={STATUS_COLORS[peer.status]}
          />
        }
      />
      <Field
        label="Last Heartbeat"
        value={peer.last_heartbeat || "—"}
      />
      <Field
        label="Capabilities"
        value={
          peer.capabilities.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {peer.capabilities.map((c, i) => (
                <Badge key={i} label={c} />
              ))}
            </div>
          ) : (
            "None"
          )
        }
      />
    </>
  );
}
