// Compatibility seam for terra/agent-cli-p0b.  Approval must never create an
// Agent grant with empty or plaintext organization keys.  The real pure
// wrapper will replace this fail-closed stub without changing the approval
// flow or transaction construction.
import type { NetworkName } from "@fractalmind-labs/fractalmind-sdk";

export type AgentOrgKeyWrapInput = {
  profile: string;
  network: NetworkName;
  organizationId: string;
  encryptedKeys: string;
  recipientAddress: string;
  signingPublicKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
};

export class AgentOrgKeyWrapError extends Error {
  constructor() {
    super("agent_key_wrap_unavailable");
  }
}

/** Replaced by terra-1's `wrapOrgKeysForAgent` implementation. */
export async function wrapOrgKeysForAgent(_input: AgentOrgKeyWrapInput): Promise<Uint8Array> {
  throw new AgentOrgKeyWrapError();
}
