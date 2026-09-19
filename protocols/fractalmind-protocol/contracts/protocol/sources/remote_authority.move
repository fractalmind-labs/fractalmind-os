/// FractalMind Protocol - Remote Control Authority v1
///
/// This module is the canonical authority projection for signed NodeCommand
/// intents. Command payloads, logs, media, and input events remain off-chain.
/// Organization-scoped capabilities use an authority-wide pre-execution claim;
/// node- and agent-scoped capabilities are reserved by envd in durable local
/// storage under the same bounds.
module fractalmind_protocol::remote_authority {
    use std::option::{Self, Option};
    use std::string::{Self, String};
    use sui::event;
    use sui::table::{Self, Table};

    use fractalmind_protocol::constants;
    use fractalmind_protocol::organization::{Self, Organization};

    const E_NOT_ISSUER: u64 = 8301;
    const E_INVALID_CAPABILITY: u64 = 8302;
    const E_INVALID_TARGET: u64 = 8303;
    const E_INVALID_SCOPE: u64 = 8304;
    const E_INVALID_ACTION: u64 = 8305;
    const E_CAPABILITY_REVOKED: u64 = 8306;
    const E_CAPABILITY_EXPIRED: u64 = 8307;
    const E_USES_EXHAUSTED: u64 = 8308;
    const E_BUDGET_EXHAUSTED: u64 = 8309;
    const E_NOT_DELEGATE: u64 = 8310;
    const E_REPLAY: u64 = 8311;
    const E_INVALID_HASH: u64 = 8312;
    const E_DELEGATION_NOT_ALLOWED: u64 = 8313;
    const E_PARENT_AUTHORITY_STALE: u64 = 8314;
    const E_WRONG_RESERVATION_SCOPE: u64 = 8315;
    const E_INVALID_TOKEN: u64 = 8316;
    const E_IDEMPOTENCY_CONFLICT: u64 = 8317;
    const E_CLAIM_MISMATCH: u64 = 8318;

    const SCHEMA_VERSION: u8 = 1;
    const TARGET_ORGANIZATION: u8 = 1;
    const TARGET_NODE: u8 = 2;
    const TARGET_AGENT: u8 = 3;
    const RESERVATION_AUTHORITY: u8 = 1;
    const RESERVATION_NODE: u8 = 2;
    const HASH_BYTES: u64 = 32;
    const MAX_ACTIONS: u64 = 32;
    const MAX_TOKEN_BYTES: u64 = 128;

    /// Lossless authority reference embedded in a signed off-chain intent.
    public struct CapabilityReference has copy, drop, store {
        id: ID,
        revocation_version: u64,
        parent_id: Option<ID>,
        parent_revocation_version: u64,
        reservation_scope: u8,
    }

    public struct AuthorityClaimRecord has store {
        action: String,
        scope: String,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        command_id: String,
        nonce: String,
        idempotency_key: String,
        budget_asset: String,
        budget_amount: u64,
        intent_hash: vector<u8>,
    }

    /// Shared authority object resolved by envd and the TypeScript SDK.
    /// Phase 0 delegation is one level and only organization roots may delegate
    /// bounded node/agent children, preventing local usage from racing later
    /// quota subdivision.
    public struct RemoteCapability has key {
        id: UID,
        schema_version: u8,
        org_id: ID,
        issuer: address,
        delegate: address,
        parent_id: Option<ID>,
        parent_revocation_version: u64,
        reservation_scope: u8,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        actions: vector<String>,
        scope: String,
        max_uses: u64,
        uses_claimed: u64,
        uses_delegated: u64,
        budget_asset: String,
        max_budget: u64,
        budget_claimed: u64,
        budget_delegated: u64,
        expires_at_ms: u64,
        revocation_version: u64,
        revoked: bool,
        authority_claims: Table<vector<u8>, AuthorityClaimRecord>,
        authority_commands: Table<vector<u8>, vector<u8>>,
        authority_nonces: Table<vector<u8>, vector<u8>>,
        authority_idempotency_keys: Table<vector<u8>, vector<u8>>,
    }

    public struct CapabilityCreated has copy, drop {
        capability_id: ID,
        schema_version: u8,
        org_id: ID,
        issuer: address,
        delegate: address,
        parent_id: Option<ID>,
        parent_revocation_version: u64,
        reservation_scope: u8,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        scope: String,
        max_uses: u64,
        budget_asset: String,
        max_budget: u64,
        expires_at_ms: u64,
        revocation_version: u64,
    }

    public struct CapabilityRevoked has copy, drop {
        capability_id: ID,
        org_id: ID,
        revoked_by: address,
        revocation_version: u64,
    }

    /// Pre-execution claim for an organization-scoped command. Evidence is not
    /// accepted here because it does not exist until after local execution.
    public struct AuthorityUseClaimed has copy, drop {
        capability_id: ID,
        org_id: ID,
        delegate: address,
        action: String,
        scope: String,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        command_id: String,
        nonce: String,
        idempotency_key: String,
        budget_asset: String,
        budget_amount: u64,
        intent_hash: vector<u8>,
        uses_claimed: u64,
        budget_claimed: u64,
        revocation_version: u64,
        duplicate: bool,
    }

    public fun create_capability(
        org: &Organization,
        delegate: address,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        actions: vector<String>,
        scope: String,
        max_uses: u64,
        budget_asset: String,
        max_budget: u64,
        expires_at_ms: u64,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        assert!(organization::admin(org) == sender, E_NOT_ISSUER);
        assert!(delegate != @0x0, E_INVALID_CAPABILITY);
        validate_capability_shape(
            target_kind,
            &node_id,
            &agent_id,
            &actions,
            &scope,
            max_uses,
            &budget_asset,
            max_budget,
            expires_at_ms,
            ctx.epoch_timestamp_ms(),
        );

        let capability = RemoteCapability {
            id: object::new(ctx),
            schema_version: SCHEMA_VERSION,
            org_id: organization::org_id(org),
            issuer: sender,
            delegate,
            parent_id: option::none(),
            parent_revocation_version: 0,
            reservation_scope: reservation_scope_for_target(target_kind),
            target_kind,
            node_id,
            agent_id,
            actions,
            scope,
            max_uses,
            uses_claimed: 0,
            uses_delegated: 0,
            budget_asset,
            max_budget,
            budget_claimed: 0,
            budget_delegated: 0,
            expires_at_ms,
            revocation_version: 1,
            revoked: false,
            authority_claims: table::new(ctx),
            authority_commands: table::new(ctx),
            authority_nonces: table::new(ctx),
            authority_idempotency_keys: table::new(ctx),
        };
        emit_created(&capability);
        transfer::share_object(capability);
    }

    /// Delegate a bounded node/agent subset from an organization root. Quota is
    /// reserved at child creation and never returned in Phase 0.
    public fun delegate_capability(
        parent: &mut RemoteCapability,
        org: &Organization,
        delegate: address,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        actions: vector<String>,
        scope: String,
        max_uses: u64,
        budget_asset: String,
        max_budget: u64,
        expires_at_ms: u64,
        ctx: &mut TxContext,
    ): ID {
        let sender = ctx.sender();
        let now = ctx.epoch_timestamp_ms();
        let org_id = organization::org_id(org);

        assert!(parent.org_id == org_id, constants::e_unauthorized());
        assert!(option::is_none(&parent.parent_id), E_DELEGATION_NOT_ALLOWED);
        assert!(parent.reservation_scope == RESERVATION_AUTHORITY, E_DELEGATION_NOT_ALLOWED);
        assert!(target_kind == TARGET_NODE || target_kind == TARGET_AGENT, E_DELEGATION_NOT_ALLOWED);
        assert!(sender == parent.delegate || sender == organization::admin(org), E_NOT_ISSUER);
        assert!(!parent.revoked, E_CAPABILITY_REVOKED);
        assert!(now < parent.expires_at_ms, E_CAPABILITY_EXPIRED);
        assert!(delegate != @0x0, E_INVALID_CAPABILITY);
        validate_capability_shape(
            target_kind,
            &node_id,
            &agent_id,
            &actions,
            &scope,
            max_uses,
            &budget_asset,
            max_budget,
            expires_at_ms,
            now,
        );
        assert!(expires_at_ms <= parent.expires_at_ms, E_DELEGATION_NOT_ALLOWED);
        assert!(target_contains(parent, target_kind, &node_id, &agent_id), E_INVALID_TARGET);
        assert!(scope == parent.scope, E_INVALID_SCOPE);
        assert!(is_subset(&actions, &parent.actions), E_INVALID_ACTION);

        if (max_uses > 0) {
            assert!(parent.max_uses > 0, E_DELEGATION_NOT_ALLOWED);
            assert!(
                parent.uses_claimed + parent.uses_delegated + max_uses <= parent.max_uses,
                E_USES_EXHAUSTED,
            );
            parent.uses_delegated = parent.uses_delegated + max_uses;
        };
        if (max_budget > 0) {
            assert!(parent.max_budget > 0, E_DELEGATION_NOT_ALLOWED);
            assert!(budget_asset == parent.budget_asset, E_DELEGATION_NOT_ALLOWED);
            assert!(
                parent.budget_claimed + parent.budget_delegated + max_budget <= parent.max_budget,
                E_BUDGET_EXHAUSTED,
            );
            parent.budget_delegated = parent.budget_delegated + max_budget;
        };

        let child = RemoteCapability {
            id: object::new(ctx),
            schema_version: SCHEMA_VERSION,
            org_id,
            issuer: sender,
            delegate,
            parent_id: option::some(object::id(parent)),
            parent_revocation_version: parent.revocation_version,
            reservation_scope: RESERVATION_NODE,
            target_kind,
            node_id,
            agent_id,
            actions,
            scope,
            max_uses,
            uses_claimed: 0,
            uses_delegated: 0,
            budget_asset,
            max_budget,
            budget_claimed: 0,
            budget_delegated: 0,
            expires_at_ms,
            revocation_version: 1,
            revoked: false,
            authority_claims: table::new(ctx),
            authority_commands: table::new(ctx),
            authority_nonces: table::new(ctx),
            authority_idempotency_keys: table::new(ctx),
        };
        emit_created(&child);
        let child_id = object::id(&child);
        transfer::share_object(child);
        child_id
    }

    public fun revoke_capability(
        capability: &mut RemoteCapability,
        org: &Organization,
        ctx: &TxContext,
    ) {
        let sender = ctx.sender();
        assert!(capability.org_id == organization::org_id(org), constants::e_unauthorized());
        assert!(sender == capability.issuer || sender == organization::admin(org), E_NOT_ISSUER);
        assert!(!capability.revoked, E_CAPABILITY_REVOKED);

        capability.revoked = true;
        capability.revocation_version = capability.revocation_version + 1;
        event::emit(CapabilityRevoked {
            capability_id: object::id(capability),
            org_id: capability.org_id,
            revoked_by: sender,
            revocation_version: capability.revocation_version,
        });
    }

    /// Claim an organization-scoped intent before execution. The delegate
    /// submits this transaction; target envd verifies the claim by intent hash.
    public fun claim_authority_use(
        capability: &mut RemoteCapability,
        action: String,
        scope: String,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        command_id: String,
        nonce: String,
        idempotency_key: String,
        budget_asset: String,
        budget_amount: u64,
        intent_hash: vector<u8>,
        ctx: &TxContext,
    ) {
        assert!(capability.reservation_scope == RESERVATION_AUTHORITY, E_WRONG_RESERVATION_SCOPE);
        assert!(ctx.sender() == capability.delegate, E_NOT_DELEGATE);
        assert_authorized(capability, &action, &scope, target_kind, &node_id, &agent_id, ctx);
        assert!(is_token(&command_id, false), E_INVALID_TOKEN);
        assert!(is_token(&nonce, false), E_INVALID_TOKEN);
        assert!(is_token(&idempotency_key, false), E_INVALID_TOKEN);
        assert!(vector::length(&intent_hash) == HASH_BYTES, E_INVALID_HASH);

        let command_key = *string::as_bytes(&command_id);
        let nonce_key = *string::as_bytes(&nonce);
        let idempotency_key_bytes = *string::as_bytes(&idempotency_key);
        if (table::contains(&capability.authority_commands, command_key)) {
            assert!(table::borrow(&capability.authority_commands, command_key) == &intent_hash, E_REPLAY);
            assert!(table::contains(&capability.authority_nonces, nonce_key), E_REPLAY);
            assert!(table::borrow(&capability.authority_nonces, nonce_key) == &intent_hash, E_REPLAY);
            assert!(table::contains(&capability.authority_idempotency_keys, idempotency_key_bytes), E_REPLAY);
            assert!(
                table::borrow(&capability.authority_idempotency_keys, idempotency_key_bytes) == &intent_hash,
                E_IDEMPOTENCY_CONFLICT,
            );
            let claim = table::borrow(&capability.authority_claims, intent_hash);
            assert!(claim_matches(
                claim,
                &action,
                &scope,
                target_kind,
                &node_id,
                &agent_id,
                &command_id,
                &nonce,
                &idempotency_key,
                &budget_asset,
                budget_amount,
                &intent_hash,
            ), E_CLAIM_MISMATCH);
            emit_authority_claim(
                capability,
                action,
                scope,
                target_kind,
                node_id,
                agent_id,
                command_id,
                nonce,
                idempotency_key,
                budget_asset,
                budget_amount,
                intent_hash,
                true,
            );
            return
        };
        assert!(
            !table::contains(&capability.authority_idempotency_keys, idempotency_key_bytes),
            E_IDEMPOTENCY_CONFLICT,
        );
        assert!(!table::contains(&capability.authority_nonces, nonce_key), E_REPLAY);
        assert!(!table::contains(&capability.authority_claims, intent_hash), E_REPLAY);

        if (capability.max_uses > 0) {
            assert!(
                capability.uses_claimed + capability.uses_delegated < capability.max_uses,
                E_USES_EXHAUSTED,
            );
            capability.uses_claimed = capability.uses_claimed + 1;
        };
        if (budget_amount > 0) {
            assert!(capability.max_budget > 0, E_BUDGET_EXHAUSTED);
            assert!(budget_asset == capability.budget_asset, E_BUDGET_EXHAUSTED);
            assert!(
                capability.budget_claimed + capability.budget_delegated + budget_amount <= capability.max_budget,
                E_BUDGET_EXHAUSTED,
            );
            capability.budget_claimed = capability.budget_claimed + budget_amount;
        } else {
            assert!(string::length(&budget_asset) == 0, E_BUDGET_EXHAUSTED);
        };

        table::add(&mut capability.authority_claims, intent_hash, AuthorityClaimRecord {
            action,
            scope,
            target_kind,
            node_id,
            agent_id,
            command_id,
            nonce,
            idempotency_key,
            budget_asset,
            budget_amount,
            intent_hash,
        });
        table::add(&mut capability.authority_commands, command_key, intent_hash);
        table::add(&mut capability.authority_nonces, nonce_key, intent_hash);
        table::add(
            &mut capability.authority_idempotency_keys,
            idempotency_key_bytes,
            intent_hash,
        );
        emit_authority_claim(
            capability,
            action,
            scope,
            target_kind,
            node_id,
            agent_id,
            command_id,
            nonce,
            idempotency_key,
            budget_asset,
            budget_amount,
            intent_hash,
            false,
        );
    }

    fun emit_authority_claim(
        capability: &RemoteCapability,
        action: String,
        scope: String,
        target_kind: u8,
        node_id: String,
        agent_id: String,
        command_id: String,
        nonce: String,
        idempotency_key: String,
        budget_asset: String,
        budget_amount: u64,
        intent_hash: vector<u8>,
        duplicate: bool,
    ) {
        event::emit(AuthorityUseClaimed {
            capability_id: object::id(capability),
            org_id: capability.org_id,
            delegate: capability.delegate,
            action,
            scope,
            target_kind,
            node_id,
            agent_id,
            command_id,
            nonce,
            idempotency_key,
            budget_asset,
            budget_amount,
            intent_hash,
            uses_claimed: capability.uses_claimed,
            budget_claimed: capability.budget_claimed,
            revocation_version: capability.revocation_version,
            duplicate,
        });
    }

    fun claim_matches(
        claim: &AuthorityClaimRecord,
        action: &String,
        scope: &String,
        target_kind: u8,
        node_id: &String,
        agent_id: &String,
        command_id: &String,
        nonce: &String,
        idempotency_key: &String,
        budget_asset: &String,
        budget_amount: u64,
        intent_hash: &vector<u8>,
    ): bool {
        &claim.action == action &&
            &claim.scope == scope &&
            claim.target_kind == target_kind &&
            &claim.node_id == node_id &&
            &claim.agent_id == agent_id &&
            &claim.command_id == command_id &&
            &claim.nonce == nonce &&
            &claim.idempotency_key == idempotency_key &&
            &claim.budget_asset == budget_asset &&
            claim.budget_amount == budget_amount &&
            &claim.intent_hash == intent_hash
    }

    /// Read-only validation shared by the authority claim and tests/adapters.
    public fun assert_authorized(
        capability: &RemoteCapability,
        action: &String,
        scope: &String,
        target_kind: u8,
        node_id: &String,
        agent_id: &String,
        ctx: &TxContext,
    ) {
        assert!(!capability.revoked, E_CAPABILITY_REVOKED);
        assert!(ctx.epoch_timestamp_ms() < capability.expires_at_ms, E_CAPABILITY_EXPIRED);
        assert!(scope == &capability.scope, E_INVALID_SCOPE);
        assert!(vector::contains(&capability.actions, action), E_INVALID_ACTION);
        assert!(target_contains(capability, target_kind, node_id, agent_id), E_INVALID_TARGET);
    }

    public fun assert_delegated_authorized(
        parent: &RemoteCapability,
        capability: &RemoteCapability,
        action: &String,
        scope: &String,
        target_kind: u8,
        node_id: &String,
        agent_id: &String,
        ctx: &TxContext,
    ) {
        assert!(!parent.revoked, E_PARENT_AUTHORITY_STALE);
        assert!(ctx.epoch_timestamp_ms() < parent.expires_at_ms, E_PARENT_AUTHORITY_STALE);
        assert!(option::is_some(&capability.parent_id), E_PARENT_AUTHORITY_STALE);
        assert!(*option::borrow(&capability.parent_id) == object::id(parent), E_PARENT_AUTHORITY_STALE);
        assert!(capability.parent_revocation_version == parent.revocation_version, E_PARENT_AUTHORITY_STALE);
        assert_authorized(capability, action, scope, target_kind, node_id, agent_id, ctx);
    }

    fun validate_capability_shape(
        target_kind: u8,
        node_id: &String,
        agent_id: &String,
        actions: &vector<String>,
        scope: &String,
        max_uses: u64,
        budget_asset: &String,
        max_budget: u64,
        expires_at_ms: u64,
        now_ms: u64,
    ) {
        validate_target(target_kind, node_id, agent_id);
        validate_actions(actions);
        assert!(is_initial_scope(scope), E_INVALID_SCOPE);
        assert!(is_token(scope, false), E_INVALID_TOKEN);
        assert!(max_uses > 0 || max_budget > 0, E_INVALID_CAPABILITY);
        if (max_budget > 0) {
            assert!(is_token(budget_asset, false), E_INVALID_TOKEN);
        } else {
            assert!(string::length(budget_asset) == 0, E_INVALID_CAPABILITY);
        };
        assert!(expires_at_ms > now_ms, E_INVALID_CAPABILITY);
    }

    fun validate_target(target_kind: u8, node_id: &String, agent_id: &String) {
        if (target_kind == TARGET_ORGANIZATION) {
            assert!(string::length(node_id) == 0 && string::length(agent_id) == 0, E_INVALID_TARGET);
        } else if (target_kind == TARGET_NODE) {
            assert!(is_token(node_id, false) && string::length(agent_id) == 0, E_INVALID_TARGET);
        } else if (target_kind == TARGET_AGENT) {
            assert!(is_token(node_id, false) && is_token(agent_id, false), E_INVALID_TARGET);
        } else {
            abort E_INVALID_TARGET
        };
    }

    fun validate_actions(actions: &vector<String>) {
        let length = vector::length(actions);
        assert!(length > 0 && length <= MAX_ACTIONS, E_INVALID_ACTION);
        let mut i = 0;
        while (i < length) {
            let value = vector::borrow(actions, i);
            assert!(is_token(value, false), E_INVALID_TOKEN);
            let mut j = i + 1;
            while (j < length) {
                assert!(value != vector::borrow(actions, j), E_INVALID_ACTION);
                j = j + 1;
            };
            i = i + 1;
        };
    }

    fun is_token(value: &String, allow_empty: bool): bool {
        let bytes = string::as_bytes(value);
        let length = vector::length(bytes);
        if (length == 0) return allow_empty;
        if (length > MAX_TOKEN_BYTES) return false;
        let mut i = 0;
        while (i < length) {
            let b = *vector::borrow(bytes, i);
            let valid = (b >= 48 && b <= 57) ||
                (b >= 65 && b <= 90) ||
                (b >= 97 && b <= 122) ||
                b == 43 || b == 45 || b == 46 || b == 47 || b == 58 ||
                b == 64 || b == 95;
            if (!valid) return false;
            i = i + 1;
        };
        true
    }

    fun is_initial_scope(value: &String): bool {
        value == &string::utf8(b"view") ||
            value == &string::utf8(b"control") ||
            value == &string::utf8(b"logs") ||
            value == &string::utf8(b"terminal") ||
            value == &string::utf8(b"shell") ||
            value == &string::utf8(b"lifecycle") ||
            value == &string::utf8(b"deploy")
    }

    fun is_subset(values: &vector<String>, allowed: &vector<String>): bool {
        let mut i = 0;
        while (i < vector::length(values)) {
            if (!vector::contains(allowed, vector::borrow(values, i))) return false;
            i = i + 1;
        };
        true
    }

    fun reservation_scope_for_target(target_kind: u8): u8 {
        if (target_kind == TARGET_ORGANIZATION) RESERVATION_AUTHORITY else RESERVATION_NODE
    }

    fun target_contains(
        parent: &RemoteCapability,
        child_kind: u8,
        child_node_id: &String,
        child_agent_id: &String,
    ): bool {
        validate_target(child_kind, child_node_id, child_agent_id);
        if (parent.target_kind == TARGET_ORGANIZATION) {
            true
        } else if (parent.target_kind == TARGET_NODE) {
            child_kind != TARGET_ORGANIZATION && parent.node_id == *child_node_id
        } else {
            child_kind == TARGET_AGENT &&
                parent.node_id == *child_node_id &&
                parent.agent_id == *child_agent_id
        }
    }

    fun emit_created(capability: &RemoteCapability) {
        event::emit(CapabilityCreated {
            capability_id: object::id(capability),
            schema_version: capability.schema_version,
            org_id: capability.org_id,
            issuer: capability.issuer,
            delegate: capability.delegate,
            parent_id: capability.parent_id,
            parent_revocation_version: capability.parent_revocation_version,
            reservation_scope: capability.reservation_scope,
            target_kind: capability.target_kind,
            node_id: capability.node_id,
            agent_id: capability.agent_id,
            scope: capability.scope,
            max_uses: capability.max_uses,
            budget_asset: capability.budget_asset,
            max_budget: capability.max_budget,
            expires_at_ms: capability.expires_at_ms,
            revocation_version: capability.revocation_version,
        });
    }

    public fun capability_id(capability: &RemoteCapability): ID { object::id(capability) }
    public fun schema_version(capability: &RemoteCapability): u8 { capability.schema_version }
    public fun org_id(capability: &RemoteCapability): ID { capability.org_id }
    public fun issuer(capability: &RemoteCapability): address { capability.issuer }
    public fun delegate(capability: &RemoteCapability): address { capability.delegate }
    public fun parent_id(capability: &RemoteCapability): Option<ID> { capability.parent_id }
    public fun parent_revocation_version(capability: &RemoteCapability): u64 { capability.parent_revocation_version }
    public fun reservation_scope(capability: &RemoteCapability): u8 { capability.reservation_scope }
    public fun target_kind(capability: &RemoteCapability): u8 { capability.target_kind }
    public fun node_id(capability: &RemoteCapability): String { capability.node_id }
    public fun agent_id(capability: &RemoteCapability): String { capability.agent_id }
    public fun actions(capability: &RemoteCapability): vector<String> { capability.actions }
    public fun scope(capability: &RemoteCapability): String { capability.scope }
    public fun max_uses(capability: &RemoteCapability): u64 { capability.max_uses }
    public fun uses_claimed(capability: &RemoteCapability): u64 { capability.uses_claimed }
    public fun uses_delegated(capability: &RemoteCapability): u64 { capability.uses_delegated }
    public fun budget_asset(capability: &RemoteCapability): String { capability.budget_asset }
    public fun max_budget(capability: &RemoteCapability): u64 { capability.max_budget }
    public fun budget_claimed(capability: &RemoteCapability): u64 { capability.budget_claimed }
    public fun budget_delegated(capability: &RemoteCapability): u64 { capability.budget_delegated }
    public fun expires_at_ms(capability: &RemoteCapability): u64 { capability.expires_at_ms }
    public fun revocation_version(capability: &RemoteCapability): u64 { capability.revocation_version }
    public fun revoked(capability: &RemoteCapability): bool { capability.revoked }
    public fun has_authority_claim(capability: &RemoteCapability, intent_hash: vector<u8>): bool {
        table::contains(&capability.authority_claims, intent_hash)
    }

    public fun authority_claim_matches(
        capability: &RemoteCapability,
        action: &String,
        scope: &String,
        target_kind: u8,
        node_id: &String,
        agent_id: &String,
        command_id: &String,
        nonce: &String,
        idempotency_key: &String,
        budget_asset: &String,
        budget_amount: u64,
        intent_hash: &vector<u8>,
    ): bool {
        let command_key = *string::as_bytes(command_id);
        let nonce_key = *string::as_bytes(nonce);
        let idempotency_key_bytes = *string::as_bytes(idempotency_key);
        table::contains(&capability.authority_claims, *intent_hash) &&
            claim_matches(
                table::borrow(&capability.authority_claims, *intent_hash),
                action,
                scope,
                target_kind,
                node_id,
                agent_id,
                command_id,
                nonce,
                idempotency_key,
                budget_asset,
                budget_amount,
                intent_hash,
            ) &&
            table::contains(&capability.authority_commands, command_key) &&
            table::borrow(&capability.authority_commands, command_key) == intent_hash &&
            table::contains(&capability.authority_nonces, nonce_key) &&
            table::borrow(&capability.authority_nonces, nonce_key) == intent_hash &&
            table::contains(&capability.authority_idempotency_keys, idempotency_key_bytes) &&
            table::borrow(&capability.authority_idempotency_keys, idempotency_key_bytes) == intent_hash
    }

    public fun reference(capability: &RemoteCapability): CapabilityReference {
        CapabilityReference {
            id: object::id(capability),
            revocation_version: capability.revocation_version,
            parent_id: capability.parent_id,
            parent_revocation_version: capability.parent_revocation_version,
            reservation_scope: capability.reservation_scope,
        }
    }

    public fun reference_id(reference: &CapabilityReference): ID { reference.id }
    public fun reference_revocation_version(reference: &CapabilityReference): u64 { reference.revocation_version }
    public fun reference_parent_id(reference: &CapabilityReference): Option<ID> { reference.parent_id }
    public fun reference_parent_revocation_version(reference: &CapabilityReference): u64 {
        reference.parent_revocation_version
    }
    public fun reference_reservation_scope(reference: &CapabilityReference): u8 { reference.reservation_scope }

    public fun target_organization(): u8 { TARGET_ORGANIZATION }
    public fun target_node(): u8 { TARGET_NODE }
    public fun target_agent(): u8 { TARGET_AGENT }
    public fun reservation_authority(): u8 { RESERVATION_AUTHORITY }
    public fun reservation_node(): u8 { RESERVATION_NODE }
}
