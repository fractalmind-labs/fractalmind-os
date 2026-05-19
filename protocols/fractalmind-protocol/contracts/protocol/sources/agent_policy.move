/// FractalMind Protocol — Bounded Agent Policy
/// Grants a specific agent bounded authority to emit verifiable on-chain
/// action evidence for one action kind and target scope.
module fractalmind_protocol::agent_policy {
    use sui::event;
    use std::string::String;

    use fractalmind_protocol::agent::AgentCertificate;
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::agent;
    use fractalmind_protocol::organization;
    use fractalmind_protocol::constants;

    // ===== Error Codes (82xx) =====

    const E_NOT_POLICY_OWNER: u64 = 8201;
    const E_AGENT_NOT_IN_ORG: u64 = 8202;
    const E_INVALID_POLICY: u64 = 8203;
    const E_POLICY_REVOKED: u64 = 8204;
    const E_POLICY_EXPIRED: u64 = 8205;
    const E_POLICY_USES_EXHAUSTED: u64 = 8206;
    const E_ACTION_NOT_ALLOWED: u64 = 8207;
    const E_TARGET_NOT_ALLOWED: u64 = 8208;
    const E_GAS_BUDGET_EXCEEDED: u64 = 8209;
    const E_INVALID_HASH: u64 = 8210;
    const E_NOT_POLICY_AGENT: u64 = 8211;

    const HASH_BYTES: u64 = 32;

    // ===== Structs =====

    /// Shared bounded policy for one agent. The owner can revoke it at any time.
    public struct AgentPolicy has key {
        id: UID,
        org_id: ID,
        owner: address,
        agent: address,
        allowed_action: String,
        target_scope: String,
        max_uses: u64,
        uses_consumed: u64,
        expires_at_ms: u64,
        max_gas_budget: u64,
        revoked: bool,
    }

    // ===== Events =====

    public struct PolicyCreated has copy, drop {
        policy_id: ID,
        org_id: ID,
        owner: address,
        agent: address,
        allowed_action: String,
        target_scope: String,
        max_uses: u64,
        expires_at_ms: u64,
        max_gas_budget: u64,
    }

    public struct PolicyRevoked has copy, drop {
        policy_id: ID,
        org_id: ID,
        revoked_by: address,
    }

    public struct ActionExecuted has copy, drop {
        policy_id: ID,
        org_id: ID,
        agent: address,
        action_kind: String,
        target_scope: String,
        intent_hash: vector<u8>,
        result_hash: vector<u8>,
        gas_budget: u64,
        uses_consumed: u64,
    }

    // ===== Public Functions =====

    /// Create and share a bounded policy for one agent.
    /// Only the organization admin may create policies.
    public fun create_policy(
        org: &Organization,
        agent_addr: address,
        allowed_action: String,
        target_scope: String,
        max_uses: u64,
        expires_at_ms: u64,
        max_gas_budget: u64,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        let now = ctx.epoch_timestamp_ms();
        let org_id = organization::org_id(org);

        assert!(organization::admin(org) == sender, E_NOT_POLICY_OWNER);
        assert!(organization::has_agent(org, agent_addr), E_AGENT_NOT_IN_ORG);
        assert!(std::string::length(&allowed_action) > 0, E_INVALID_POLICY);
        assert!(std::string::length(&target_scope) > 0, E_INVALID_POLICY);
        assert!(max_uses > 0, E_INVALID_POLICY);
        assert!(expires_at_ms > now, E_INVALID_POLICY);
        assert!(max_gas_budget > 0, E_INVALID_POLICY);

        let policy = AgentPolicy {
            id: object::new(ctx),
            org_id,
            owner: sender,
            agent: agent_addr,
            allowed_action,
            target_scope,
            max_uses,
            uses_consumed: 0,
            expires_at_ms,
            max_gas_budget,
            revoked: false,
        };
        let policy_id = object::id(&policy);

        event::emit(PolicyCreated {
            policy_id,
            org_id,
            owner: policy.owner,
            agent: policy.agent,
            allowed_action: policy.allowed_action,
            target_scope: policy.target_scope,
            max_uses: policy.max_uses,
            expires_at_ms: policy.expires_at_ms,
            max_gas_budget: policy.max_gas_budget,
        });

        transfer::share_object(policy);
    }

    /// Revoke a policy. The original owner or the current org admin may revoke.
    public fun revoke_policy(
        policy: &mut AgentPolicy,
        org: &Organization,
        ctx: &TxContext,
    ) {
        let sender = ctx.sender();
        let org_id = organization::org_id(org);

        assert!(policy.org_id == org_id, constants::e_unauthorized());
        assert!(
            sender == policy.owner || sender == organization::admin(org),
            E_NOT_POLICY_OWNER,
        );

        policy.revoked = true;

        event::emit(PolicyRevoked {
            policy_id: object::id(policy),
            org_id,
            revoked_by: sender,
        });
    }

    /// Record one policy-authorized action with canonical hashes.
    public fun execute_action(
        policy: &mut AgentPolicy,
        org: &Organization,
        cert: &AgentCertificate,
        action_kind: String,
        target_scope: String,
        intent_hash: vector<u8>,
        result_hash: vector<u8>,
        gas_budget: u64,
        ctx: &TxContext,
    ) {
        let sender = ctx.sender();
        let now = ctx.epoch_timestamp_ms();
        let org_id = organization::org_id(org);

        assert!(policy.org_id == org_id, constants::e_unauthorized());
        assert!(policy.agent == sender, E_NOT_POLICY_AGENT);
        assert!(agent::cert_agent(cert) == sender, constants::e_unauthorized());
        assert!(agent::cert_org_id(cert) == org_id, constants::e_not_member());
        assert!(organization::has_agent(org, sender), constants::e_not_member());
        assert!(agent::cert_status(cert) == constants::agent_status_active(), constants::e_agent_not_active());
        assert!(!policy.revoked, E_POLICY_REVOKED);
        assert!(now < policy.expires_at_ms, E_POLICY_EXPIRED);
        assert!(policy.uses_consumed < policy.max_uses, E_POLICY_USES_EXHAUSTED);
        assert!(action_kind == policy.allowed_action, E_ACTION_NOT_ALLOWED);
        assert!(target_scope == policy.target_scope, E_TARGET_NOT_ALLOWED);
        assert!(gas_budget <= policy.max_gas_budget, E_GAS_BUDGET_EXCEEDED);
        assert!(vector::length(&intent_hash) == HASH_BYTES, E_INVALID_HASH);
        assert!(vector::length(&result_hash) == HASH_BYTES, E_INVALID_HASH);

        policy.uses_consumed = policy.uses_consumed + 1;

        event::emit(ActionExecuted {
            policy_id: object::id(policy),
            org_id,
            agent: sender,
            action_kind,
            target_scope,
            intent_hash,
            result_hash,
            gas_budget,
            uses_consumed: policy.uses_consumed,
        });
    }

    // ===== Query Functions =====

    public fun policy_org_id(policy: &AgentPolicy): ID { policy.org_id }
    public fun policy_owner(policy: &AgentPolicy): address { policy.owner }
    public fun policy_agent(policy: &AgentPolicy): address { policy.agent }
    public fun policy_allowed_action(policy: &AgentPolicy): String { policy.allowed_action }
    public fun policy_target_scope(policy: &AgentPolicy): String { policy.target_scope }
    public fun policy_max_uses(policy: &AgentPolicy): u64 { policy.max_uses }
    public fun policy_uses_consumed(policy: &AgentPolicy): u64 { policy.uses_consumed }
    public fun policy_expires_at_ms(policy: &AgentPolicy): u64 { policy.expires_at_ms }
    public fun policy_max_gas_budget(policy: &AgentPolicy): u64 { policy.max_gas_budget }
    public fun policy_revoked(policy: &AgentPolicy): bool { policy.revoked }
}
