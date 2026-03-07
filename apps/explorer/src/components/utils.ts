import { suiScanUrl } from "../sui/config.ts";

/** Truncate a SUI object ID for display: 0x1234...abcd */
export function truncateId(id: string, chars = 6): string {
  if (id.length <= chars * 2 + 2) return id;
  return `${id.slice(0, chars + 2)}...${id.slice(-chars)}`;
}

/** Open SuiScan in a new tab */
export function openOnSuiScan(objectId: string) {
  window.open(suiScanUrl("object", objectId), "_blank", "noopener");
}

/** Color mapping for node types */
export const NODE_COLORS: Record<string, string> = {
  org: "#4c6ef5",
  fractal: "#7950f2",
  agent: "#20c997",
  task: "#fcc419",
  peer: "#ff6b6b",
};

/** Status badge colors */
export const STATUS_COLORS: Record<string, string> = {
  active: "#20c997",
  idle: "#868e96",
  suspended: "#fd7e14",
  offline: "#ff6b6b",
  online: "#20c997",
  syncing: "#fcc419",
  created: "#868e96",
  assigned: "#4c6ef5",
  submitted: "#7950f2",
  verified: "#20c997",
  completed: "#51cf66",
};
