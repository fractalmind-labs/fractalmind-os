/** Wire format consumed by envd. Keep u64 counters as decimal strings. */
export interface SignedNodeCommand {
  version: string;
  command_id: string;
  signer: string;
  target: { organization_id: string; node_id: string; agent_id?: string };
  action: string;
  scope: string;
  capability: { id: string; revocation_version: string };
  nonce: string;
  issued_at_ms: number;
  expires_at_ms: number;
  idempotency_key: string;
  budget?: { asset: string; amount: string };
  payload: Record<string, unknown>;
  payload_hash: string;
  signature: string;
}

