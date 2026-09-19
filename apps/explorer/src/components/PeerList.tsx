import type { PeerNode } from "../sui/types.ts";
import { STATUS_COLORS, truncateId, openOnSuiScan } from "./utils.ts";

interface Props {
  peers: PeerNode[];
}

export default function PeerList({ peers }: Props) {
  if (peers.length === 0) {
    return (
      <div className="text-center text-muted py-8">
        No peer nodes found in PeerRegistry
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {peers.map((peer) => (
        <button
          key={peer.id}
          onClick={() => openOnSuiScan(peer.id)}
          className="w-full text-left bg-surface-alt rounded-lg border border-border p-3 hover:border-border-hover transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-primary font-medium">
              {peer.node_id || truncateId(peer.id)}
            </span>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize"
              style={{
                backgroundColor: STATUS_COLORS[peer.status] + "22",
                color: STATUS_COLORS[peer.status],
                border: `1px solid ${STATUS_COLORS[peer.status]}44`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
                style={{ backgroundColor: STATUS_COLORS[peer.status] }}
              />
              {peer.status}
            </span>
          </div>
          {peer.endpoint && (
            <div className="text-xs text-muted mt-1">{peer.endpoint}</div>
          )}
          <div className="text-xs text-muted mt-1 font-mono">
            {truncateId(peer.id)}
          </div>
        </button>
      ))}
    </div>
  );
}
