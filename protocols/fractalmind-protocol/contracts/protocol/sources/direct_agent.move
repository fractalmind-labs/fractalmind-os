/// v0.2.0 direct interaction with a fixed managed instance. Legacy AgentPolicy
/// objects retain their certificate/action ABI; managed-device permissions use
/// the existing RemoteCapability, CommandExecution and encrypted product records.
module fractalmind_protocol::direct_agent {
    use sui::object::{Self, ID, UID};
    use sui::clock::{Self, Clock};
    use sui::tx_context::{Self, TxContext};
    use sui::dynamic_field as df;
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::event;
    use sui::address;
    use std::string::{Self, String};
    use std::option::{Self, Option};
    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::okr;
    use fractalmind_protocol::product_record;
    use fractalmind_protocol::node_execution::{Self as execution, CommandExecution};
    use fractalmind_protocol::remote_authority::{Self as ra, RemoteCapability, ContractWitness};

    const E_INPUT: u64 = 9601;
    const E_VERSION: u64 = 9602;
    const E_SCOPE: u64 = 9603;
    const E_EXPIRED: u64 = 9604;
    const E_APPROVAL_REQUIRED: u64 = 9605;
    const E_APPROVAL_STATE: u64 = 9606;
    const E_BUDGET: u64 = 9607;
    const E_CONFLICT: u64 = 9608;
    const E_WORKSPACE_UNKNOWN: u64 = 9609;
    const MAX_TTL: u64 = 2592000000;

    public struct IndexKey has copy, drop, store {}
    public struct PermissionIndex has store { agents: Table<ID, ID> }
    public struct PermissionCapabilityKey has copy, drop, store {}
    public struct PermissionCapability has copy, drop, store {
        permission_id: ID, permission_version: u64, approval_id: Option<ID>,
    }
    public struct DirectCommandKey has copy, drop, store { intent_hash: vector<u8> }
    public struct DirectCommandBinding has copy, drop, store {
        permission_id: ID, permission_version: u64, message_id: ID, approval_id: Option<ID>,
    }
    public struct StandingPermission has key {
        id: UID, org_id: ID, owner_human: ID, human_generation: u64,
        managed_agent: ID, managed_version: u64, membership_id: ID, membership_version: u64,
        host_address: address, workspace_hash: vector<u8>, version: u64, revoked: bool,
        allowed_actions: vector<String>, boundary_hash: vector<u8>, max_calls: u64,
        budget_limit: u64, spent: u64, reserved: u64,
        // One-off exceptions have their own explicit grants/accounting. They
        // never increase the standing limit or reset its accumulated spend.
        approved_spent: u64, approved_reserved: u64,
        expires_at_ms: u64, approved_device: address, approved_grant: ID,
        permission_record: ID, record_revision: u64,
        messages: Table<String, ID>, approvals: Table<ID, ID>,
        message_runs: Table<ID, ID>, claims: Table<ID, DirectClaim>,
    }
    public struct Message has key {
        id: UID, org_id: ID, permission_id: ID, permission_version: u64,
        managed_agent: ID, managed_version: u64, membership_id: ID,
        conversation_id: String, message_token: String, action: String,
        boundary_hash: vector<u8>, budget_amount: u64, request_hash: vector<u8>,
        human_id: ID, human_generation: u64, writer_device: address,
        grant_id: ID, grant_version: u64, created_at_ms: u64, expires_at_ms: u64,
        encrypted_record: ID,
    }
    public struct Approval has key {
        id: UID, org_id: ID, permission_id: ID, permission_version: u64,
        message_id: ID, managed_agent: ID, managed_version: u64,
        action: String, boundary_hash: vector<u8>, budget_amount: u64,
        workspace_revision: u64, state: u8, expires_at_ms: u64,
        approved_device: address, approved_grant: Option<ID>, grant_version: u64,
        human_generation: u64, encrypted_record: ID,
    }
    public struct DirectClaim has copy, drop, store {
        capability_id: ID, message_id: ID, permission_version: u64,
        approval_id: Option<ID>, reserved: u64, spent: u64, settled: bool,
    }
    public struct PermissionChanged has copy, drop { permission_id: ID, org_id: ID, managed_agent: ID, version: u64, revoked: bool }
    public struct MessageCreated has copy, drop { message_id: ID, permission_id: ID, permission_version: u64, record_id: ID }
    public struct ApprovalChanged has copy, drop { approval_id: ID, permission_id: ID, permission_version: u64, message_id: ID, state: u8 }

    fun supported(action: &String): bool {
        *action == string::utf8(b"ask") || *action == string::utf8(b"status") ||
        *action == string::utf8(b"file.read") || *action == string::utf8(b"file.write")
    }
    fun writes(action: &String): bool { *action == string::utf8(b"file.write") }
    fun input(actions: &vector<String>, boundary: &vector<u8>, max_calls: u64, limit: u64, expiry: u64, clock: &Clock) {
        assert!(vector::length(actions) <= 4 && vector::length(boundary) == 32 && max_calls <= 1000 && max_calls <= limit, E_INPUT);
        let mut i = 0;
        while (i < vector::length(actions)) {
            assert!(supported(&actions[i]), E_INPUT); let mut j = 0;
            while (j < i) { assert!(actions[i] != actions[j], E_INPUT); j = j + 1; }; i = i + 1;
        };
        let now = clock::timestamp_ms(clock); assert!(expiry > now && expiry - now <= MAX_TTL, E_EXPIRED);
    }
    fun name(managed: ID, suffix: vector<u8>): String {
        let mut out = b"standing-0x";
        let mut bytes = *string::as_bytes(&address::to_string(object::id_to_address(&managed)));
        let mut i = 0;
        while (i < vector::length(&bytes)) { let byte = bytes[i]; if (byte >= 65 && byte <= 70) *vector::borrow_mut(&mut bytes, i) = byte + 32; i = i + 1; };
        vector::append(&mut out, bytes); vector::append(&mut out, suffix); string::utf8(out)
    }
    fun message_name(token: String, approval: bool): String {
        let mut out = if (approval) b"direct-approval-" else b"direct-message-";
        vector::append(&mut out, *string::as_bytes(&token)); string::utf8(out)
    }
    fun changed(permission: &StandingPermission) {
        event::emit(PermissionChanged { permission_id: object::id(permission), org_id: permission.org_id, managed_agent: permission.managed_agent, version: permission.version, revoked: permission.revoked });
    }
    fun approve_source(org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, clock: &Clock, ctx: &TxContext) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        host::assert_member(org, member, binding, clock); host::assert_managed(org, member, managed, true);
        assert!(host::managed_runtime(managed) == string::utf8(b"bounded-process-v1"), E_SCOPE);
    }
    public fun create_permission(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership,
        binding: &CoordinatorBinding, managed: &ManagedAgent, actions: vector<String>, boundary_hash: vector<u8>,
        max_calls: u64, budget_limit: u64, expires_at_ms: u64, key_version: u64, encrypted_permission: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        approve_source(org, human, grant, member, binding, managed, clock, ctx);
        input(&actions, &boundary_hash, max_calls, budget_limit, expires_at_ms, clock);
        if (!df::exists_(organization::borrow_uid(org), IndexKey {}))
            df::add(organization::borrow_uid_mut(org), IndexKey {}, PermissionIndex { agents: table::new(ctx) });
        let idx: &PermissionIndex = df::borrow(organization::borrow_uid(org), IndexKey {});
        assert!(!table::contains(&idx.agents, object::id(managed)), E_CONFLICT);
        let record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            2, name(object::id(managed), b"-permission"), 0, key_version, encrypted_permission, clock, ctx);
        let permission = StandingPermission {
            id: object::new(ctx), org_id: object::id(org), owner_human: object::id(human), human_generation: identity::generation(human),
            managed_agent: object::id(managed), managed_version: host::managed_version(managed), membership_id: object::id(member), membership_version: host::membership_version(member),
            host_address: host::membership_host_address(member), workspace_hash: host::managed_workspace_hash(managed), version: 1, revoked: false, allowed_actions: actions, boundary_hash,
            max_calls, budget_limit, spent: 0, reserved: 0, approved_spent: 0, approved_reserved: 0, expires_at_ms,
            approved_device: tx_context::sender(ctx), approved_grant: object::id(grant), permission_record: record, record_revision: 1,
            messages: table::new(ctx), approvals: table::new(ctx), message_runs: table::new(ctx), claims: table::new(ctx),
        };
        let id = object::id(&permission);
        let idx: &mut PermissionIndex = df::borrow_mut(organization::borrow_uid_mut(org), IndexKey {}); table::add(&mut idx.agents, object::id(managed), id);
        changed(&permission); transfer::share_object(permission); id
    }
    public fun update_permission(
        permission: &mut StandingPermission, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, expected_version: u64,
        actions: vector<String>, boundary_hash: vector<u8>, max_calls: u64, budget_limit: u64, expires_at_ms: u64,
        key_version: u64, encrypted_permission: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        approve_source(org, human, grant, member, binding, managed, clock, ctx);
        assert!(permission.org_id == object::id(org) && permission.owner_human == object::id(human) && permission.managed_agent == object::id(managed), E_SCOPE);
        assert!(permission.version == expected_version, E_VERSION);
        input(&actions, &boundary_hash, max_calls, budget_limit, expires_at_ms, clock);
        assert!(permission.spent <= budget_limit && permission.reserved <= budget_limit - permission.spent, E_BUDGET);
        permission.permission_record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            2, name(permission.managed_agent, b"-permission"), permission.record_revision, key_version, encrypted_permission, clock, ctx);
        permission.record_revision = permission.record_revision + 1;
        permission.version = permission.version + 1; permission.revoked = false;
        permission.human_generation = identity::generation(human); permission.managed_version = host::managed_version(managed);
        permission.membership_id = object::id(member); permission.membership_version = host::membership_version(member); permission.host_address = host::membership_host_address(member); permission.workspace_hash = host::managed_workspace_hash(managed);
        permission.allowed_actions = actions; permission.boundary_hash = boundary_hash; permission.max_calls = max_calls; permission.budget_limit = budget_limit; permission.expires_at_ms = expires_at_ms;
        permission.approved_device = tx_context::sender(ctx); permission.approved_grant = object::id(grant); changed(permission);
    }
    public fun revoke_permission(permission: &mut StandingPermission, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, expected_version: u64, clock: &Clock, ctx: &TxContext) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert!(permission.org_id == object::id(org) && permission.owner_human == object::id(human), E_SCOPE);
        assert!(permission.version == expected_version && !permission.revoked, E_VERSION);
        permission.revoked = true; permission.version = permission.version + 1; changed(permission);
    }
    fun current(permission: &StandingPermission, org: &Organization, human: &HumanIdentity, member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, clock: &Clock) {
        assert!(permission.org_id == object::id(org) && permission.owner_human == object::id(human) && permission.human_generation == identity::generation(human), E_SCOPE);
        assert!(!permission.revoked && clock::timestamp_ms(clock) < permission.expires_at_ms, E_EXPIRED);
        host::assert_member(org, member, binding, clock); host::assert_managed(org, member, managed, true);
        assert!(permission.managed_agent == object::id(managed) && permission.managed_version == host::managed_version(managed) && permission.membership_id == object::id(member)
            && permission.membership_version == host::membership_version(member) && permission.host_address == host::membership_host_address(member) && permission.workspace_hash == host::managed_workspace_hash(managed), E_VERSION);
        let idx: &PermissionIndex = df::borrow(organization::borrow_uid(org), IndexKey {});
        assert!(*table::borrow(&idx.agents, permission.managed_agent) == object::id(permission), E_SCOPE);
    }
    public fun create_message(
        permission: &mut StandingPermission, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, expected_version: u64,
        conversation_id: String, message_token: String, action: String, boundary_hash: vector<u8>, budget_amount: u64, request_hash: vector<u8>,
        expires_at_ms: u64, key_version: u64, encrypted_message: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        identity::assert_can(human, grant, org, identity::read_action(), clock, ctx);
        current(permission, org, human, member, binding, managed, clock); assert!(permission.version == expected_version, E_VERSION);
        let now = clock::timestamp_ms(clock);
        assert!(string::length(&conversation_id) > 0 && string::length(&conversation_id) <= 64 && string::length(&message_token) > 0 && string::length(&message_token) <= 64 && supported(&action) && vector::length(&boundary_hash) == 32 && vector::length(&request_hash) == 32, E_INPUT);
        assert!(budget_amount <= 1000 && ((action == string::utf8(b"ask") || action == string::utf8(b"status")) == (budget_amount == 0)), E_BUDGET);
        assert!(expires_at_ms > now && expires_at_ms - now <= 300000 && expires_at_ms <= permission.expires_at_ms, E_EXPIRED);
        assert!(!table::contains(&permission.messages, message_token), E_CONFLICT);
        let record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            6, message_name(message_token, false), 0, key_version, encrypted_message, clock, ctx);
        let message = Message { id: object::new(ctx), org_id: permission.org_id, permission_id: object::id(permission), permission_version: permission.version,
            managed_agent: permission.managed_agent, managed_version: permission.managed_version, membership_id: permission.membership_id,
            conversation_id, message_token, action, boundary_hash, budget_amount, request_hash, human_id: object::id(human), human_generation: identity::generation(human),
            writer_device: tx_context::sender(ctx), grant_id: object::id(grant), grant_version: identity::grant_version(grant), created_at_ms: now, expires_at_ms, encrypted_record: record };
        let id = object::id(&message); table::add(&mut permission.messages, message_token, id);
        event::emit(MessageCreated { message_id: id, permission_id: object::id(permission), permission_version: permission.version, record_id: record });
        transfer::freeze_object(message); id
    }
    fun message_current(permission: &StandingPermission, message: &Message, human: &HumanIdentity, clock: &Clock) {
        assert!(message.org_id == permission.org_id && message.permission_id == object::id(permission) && message.human_id == object::id(human) && message.managed_agent == permission.managed_agent && message.membership_id == permission.membership_id, E_SCOPE);
        assert!(message.permission_version == permission.version && message.managed_version == permission.managed_version && message.human_generation == identity::generation(human), E_VERSION);
        assert!(clock::timestamp_ms(clock) < message.expires_at_ms, E_EXPIRED);
        assert!(*table::borrow(&permission.messages, message.message_token) == object::id(message), E_SCOPE);
    }
    fun normal_allowed(permission: &StandingPermission, message: &Message, org: &Organization): bool {
        let (protected, _, complete) = workspace_state(permission, org);
        vector::contains(&permission.allowed_actions, &message.action) && message.boundary_hash == permission.boundary_hash && message.budget_amount <= permission.max_calls
            && permission.spent <= permission.budget_limit && permission.reserved <= permission.budget_limit - permission.spent
            && message.budget_amount <= permission.budget_limit - permission.spent - permission.reserved && (!writes(&message.action) || (complete && !protected))
    }
    fun workspace_state(permission: &StandingPermission, org: &Organization): (bool, u64, bool) {
        okr::direct_workspace_state(org, permission.managed_agent, permission.host_address, permission.workspace_hash)
    }
    public fun request_approval(
        permission: &mut StandingPermission, message: &Message, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, key_version: u64, encrypted_request: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        identity::assert_can(human, grant, org, identity::read_action(), clock, ctx);
        current(permission, org, human, member, binding, managed, clock); message_current(permission, message, human, clock);
        assert!(!normal_allowed(permission, message, org), E_APPROVAL_STATE);
        assert!(!table::contains(&permission.approvals, object::id(message)) && !table::contains(&permission.message_runs, object::id(message)), E_CONFLICT);
        let (_, revision, _) = workspace_state(permission, org);
        let record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            3, message_name(message.message_token, true), 0, key_version, encrypted_request, clock, ctx);
        let approval = Approval { id: object::new(ctx), org_id: permission.org_id, permission_id: object::id(permission), permission_version: permission.version,
            message_id: object::id(message), managed_agent: permission.managed_agent, managed_version: permission.managed_version,
            action: message.action, boundary_hash: message.boundary_hash, budget_amount: message.budget_amount,
            workspace_revision: revision, state: 0, expires_at_ms: message.expires_at_ms,
            approved_device: @0x0, approved_grant: option::none(), grant_version: 0, human_generation: identity::generation(human), encrypted_record: record };
        let id = object::id(&approval); table::add(&mut permission.approvals, object::id(message), id);
        approval_changed(&approval); transfer::share_object(approval); id
    }
    fun approval_changed(approval: &Approval) {
        event::emit(ApprovalChanged { approval_id: object::id(approval), permission_id: approval.permission_id, permission_version: approval.permission_version, message_id: approval.message_id, state: approval.state });
    }
    fun approval_message(permission: &StandingPermission, approval: &Approval, message: &Message) {
        assert!(approval.org_id == permission.org_id && approval.permission_id == object::id(permission) && approval.message_id == object::id(message)
            && approval.managed_agent == permission.managed_agent && approval.action == message.action && approval.boundary_hash == message.boundary_hash && approval.budget_amount == message.budget_amount, E_SCOPE);
        assert!(approval.permission_version == permission.version && approval.managed_version == permission.managed_version && approval.human_generation == permission.human_generation, E_VERSION);
        assert!(*table::borrow(&permission.approvals, object::id(message)) == object::id(approval), E_SCOPE);
    }
    fun approval_workspace(permission: &StandingPermission, approval: &Approval, org: &Organization) {
        if (writes(&approval.action)) {
            let (_, revision, complete) = workspace_state(permission, org);
            assert!(complete, E_WORKSPACE_UNKNOWN); assert!(revision == approval.workspace_revision, E_VERSION);
        };
    }
    public fun decide_approval(
        permission: &StandingPermission, approval: &mut Approval, message: &Message, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, approve: bool,
        key_version: u64, encrypted_decision: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        approve_source(org, human, grant, member, binding, managed, clock, ctx);
        current(permission, org, human, member, binding, managed, clock); message_current(permission, message, human, clock); approval_message(permission, approval, message);
        assert!(approval.state == 0 && clock::timestamp_ms(clock) < approval.expires_at_ms, E_APPROVAL_STATE);
        if (approve) approval_workspace(permission, approval, org);
        approval.encrypted_record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            3, message_name(message.message_token, true), 1, key_version, encrypted_decision, clock, ctx);
        approval.state = if (approve) 1 else 2; approval.approved_device = tx_context::sender(ctx); approval.approved_grant = option::some(object::id(grant));
        approval.grant_version = identity::grant_version(grant); approval_changed(approval);
    }
    fun approved(permission: &StandingPermission, approval: &Approval, message: &Message, org: &Organization, human: &HumanIdentity, approving_grant: &DeviceGrant, consumed: bool, clock: &Clock) {
        approval_message(permission, approval, message); approval_workspace(permission, approval, org);
        assert!(approval.state == (if (consumed) 3 else 1) && clock::timestamp_ms(clock) < approval.expires_at_ms, E_APPROVAL_STATE);
        assert!(approval.approved_grant == option::some(object::id(approving_grant)) && approval.grant_version == identity::grant_version(approving_grant), E_VERSION);
        identity::assert_can_for_device(human, approving_grant, org, identity::approve_action(), clock, approval.approved_device);
    }
    fun issue(permission: &StandingPermission, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        boundary: vector<u8>, amount: u64, approval: Option<ID>, expires: u64, max_uses: u64, clock: &Clock, ctx: &mut TxContext) {
        current(permission, org, human, member, binding, managed, clock);
        let asset = if (amount == 0) string::utf8(b"") else string::utf8(b"TOOL_CALLS");
        let mut cap = host::new_agent_capability(org, human, grant, member, binding, managed, vector[string::utf8(b"direct.message")], string::utf8(b"direct"), max_uses, asset, amount, expires, clock, ctx);
        ra::bind_execution_contract(&mut cap, object::id(permission), permission.version, boundary);
        df::add(ra::capability_uid_mut(&mut cap), PermissionCapabilityKey {}, PermissionCapability { permission_id: object::id(permission), permission_version: permission.version, approval_id: approval });
        ra::share_capability(cap);
    }
    public fun issue_capability(permission: &StandingPermission, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, expected_version: u64, expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext) {
        assert!(permission.version == expected_version, E_VERSION); assert!(expires_at_ms <= permission.expires_at_ms, E_EXPIRED);
        issue(permission, org, human, grant, member, binding, managed, permission.boundary_hash, permission.budget_limit, option::none(), expires_at_ms, 10000, clock, ctx);
    }
    public fun issue_approved_capability(permission: &StandingPermission, approval: &Approval, message: &Message, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, approving_grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, clock: &Clock, ctx: &mut TxContext) {
        current(permission, org, human, member, binding, managed, clock); message_current(permission, message, human, clock);
        approved(permission, approval, message, org, human, approving_grant, false, clock);
        issue(permission, org, human, grant, member, binding, managed, message.boundary_hash, message.budget_amount, option::some(object::id(approval)), approval.expires_at_ms, 1, clock, ctx);
    }
    fun witness(permission: &StandingPermission, cap: &RemoteCapability, message: &Message, approval: Option<ID>): ContractWitness {
        let binding: &PermissionCapability = df::borrow(ra::capability_uid(cap), PermissionCapabilityKey {});
        assert!(binding.permission_id == object::id(permission) && binding.permission_version == permission.version && binding.approval_id == approval, E_VERSION);
        assert!(ra::org_id(cap) == permission.org_id && ra::actions(cap) == vector[string::utf8(b"direct.message")] && ra::scope(cap) == string::utf8(b"direct"), E_SCOPE);
        ra::contract_witness(cap, object::id(permission), permission.version, 0, message.boundary_hash)
    }
    fun prepare(
        permission: &mut StandingPermission, message: &Message, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, approval: Option<ID>, witness: ContractWitness,
        command_id: String, nonce: String, idempotency_key: String, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        assert!(message.writer_device == tx_context::sender(ctx) && message.grant_id == object::id(grant) && message.grant_version == identity::grant_version(grant), E_SCOPE);
        assert!(expires_at_ms <= message.expires_at_ms, E_EXPIRED);
        let old = execution::execution_id(cap, intent_hash);
        if (table::contains(&permission.message_runs, object::id(message))) assert!(old == option::some(*table::borrow(&permission.message_runs, object::id(message))), E_CONFLICT);
        let budget_asset = if (message.budget_amount == 0) string::utf8(b"") else string::utf8(b"TOOL_CALLS");
        let run = execution::prepare_agent_command_with_contract_v2(cap, org, human, grant, member, binding, managed, witness,
            string::utf8(b"direct.message"), string::utf8(b"direct"), command_id, nonce, idempotency_key, budget_asset, message.budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
        let key = DirectCommandKey { intent_hash };
        let value = DirectCommandBinding { permission_id: object::id(permission), permission_version: permission.version, message_id: object::id(message), approval_id: approval };
        if (option::is_none(&old)) {
            if (option::is_some(&approval)) permission.approved_reserved = permission.approved_reserved + message.budget_amount else permission.reserved = permission.reserved + message.budget_amount;
            table::add(&mut permission.message_runs, object::id(message), run);
            table::add(&mut permission.claims, run, DirectClaim { capability_id: object::id(cap), message_id: object::id(message), permission_version: permission.version, approval_id: approval, reserved: message.budget_amount, spent: 0, settled: false });
            df::add(ra::capability_uid_mut(cap), key, value);
        } else assert!(*df::borrow<DirectCommandKey, DirectCommandBinding>(ra::capability_uid(cap), key) == value, E_CONFLICT);
        run
    }
    public fun prepare_message(permission: &mut StandingPermission, message: &Message, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, command_id: String, nonce: String, idempotency_key: String, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext) {
        current(permission, org, human, member, binding, managed, clock); message_current(permission, message, human, clock);
        // A duplicate returns its original Run, but cannot create another claim.
        if (option::is_none(&execution::execution_id(cap, intent_hash))) assert!(normal_allowed(permission, message, org), E_APPROVAL_REQUIRED);
        let witness = witness(permission, cap, message, option::none());
        let _ = prepare(permission, message, cap, org, human, grant, member, binding, managed, option::none(), witness, command_id, nonce, idempotency_key, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
    }
    public fun prepare_approved_message(permission: &mut StandingPermission, approval: &mut Approval, message: &Message, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, approving_grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, command_id: String, nonce: String, idempotency_key: String, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext) {
        current(permission, org, human, member, binding, managed, clock); message_current(permission, message, human, clock);
        let duplicate = option::is_some(&execution::execution_id(cap, intent_hash));
        approved(permission, approval, message, org, human, approving_grant, duplicate, clock);
        let approval_id = option::some(object::id(approval)); let witness = witness(permission, cap, message, approval_id);
        let _ = prepare(permission, message, cap, org, human, grant, member, binding, managed, approval_id, witness, command_id, nonce, idempotency_key, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
        if (!duplicate) { approval.state = 3; approval_changed(approval); };
    }
    fun begin(permission: &StandingPermission, message: &Message, run: &mut CommandExecution, cap: &RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, approval: Option<ID>, witness: ContractWitness, attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext) {
        current(permission, org, human, member, binding, managed, clock); message_current(permission, message, human, clock);
        let claim = table::borrow(&permission.claims, object::id(run));
        assert!(!claim.settled && claim.permission_version == permission.version && claim.message_id == object::id(message) && claim.capability_id == object::id(cap) && claim.approval_id == approval
            && *table::borrow(&permission.message_runs, object::id(message)) == object::id(run), E_SCOPE);
        execution::begin_agent_command_with_contract(run, cap, org, human, grant, member, binding, managed, witness, attempt_id, clock, ctx);
    }
    public fun begin_message(permission: &StandingPermission, message: &Message, run: &mut CommandExecution, cap: &RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext) {
        // Do not count this Run's own reservation a second time at start.
        assert!(vector::contains(&permission.allowed_actions, &message.action) && message.boundary_hash == permission.boundary_hash && message.budget_amount <= permission.max_calls, E_APPROVAL_REQUIRED);
        if (writes(&message.action)) { let (protected, _, complete) = workspace_state(permission, org); assert!(complete && !protected, E_APPROVAL_REQUIRED); };
        let witness = witness(permission, cap, message, option::none());
        begin(permission, message, run, cap, org, human, grant, member, binding, managed, option::none(), witness, attempt_id, clock, ctx);
    }
    public fun begin_approved_message(permission: &StandingPermission, approval: &Approval, message: &Message, run: &mut CommandExecution, cap: &RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, approving_grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext) {
        approved(permission, approval, message, org, human, approving_grant, true, clock);
        let id = option::some(object::id(approval)); let witness = witness(permission, cap, message, id);
        begin(permission, message, run, cap, org, human, grant, member, binding, managed, id, witness, attempt_id, clock, ctx);
    }
    fun historical(permission: &StandingPermission, run: &CommandExecution, cap: &RemoteCapability, org: &Organization): ContractWitness {
        assert!(permission.org_id == object::id(org) && execution::organization_id(run) == permission.org_id && execution::capability_id(run) == object::id(cap), E_SCOPE);
        let claim = table::borrow(&permission.claims, object::id(run));
        let binding: &DirectCommandBinding = df::borrow(ra::capability_uid(cap), DirectCommandKey { intent_hash: execution::intent_hash(run) });
        assert!(!claim.settled && claim.capability_id == object::id(cap) && claim.reserved == execution::budget_amount(run) && binding.permission_id == object::id(permission)
            && binding.permission_version == claim.permission_version && binding.message_id == claim.message_id && binding.approval_id == claim.approval_id, E_SCOPE);
        ra::settlement_witness(cap, execution::intent_hash(run), object::id(permission))
    }
    fun settle(permission: &mut StandingPermission, run: ID, spent: u64) {
        let claim = table::borrow_mut(&mut permission.claims, run);
        assert!(!claim.settled && spent <= claim.reserved, E_BUDGET);
        if (option::is_some(&claim.approval_id)) {
            assert!(permission.approved_reserved >= claim.reserved, E_BUDGET); permission.approved_reserved = permission.approved_reserved - claim.reserved; permission.approved_spent = permission.approved_spent + spent;
        } else {
            assert!(permission.reserved >= claim.reserved, E_BUDGET); permission.reserved = permission.reserved - claim.reserved; permission.spent = permission.spent + spent;
        };
        claim.spent = spent; claim.settled = true;
    }
    public fun finish_message(permission: &mut StandingPermission, run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, final_state: u8,
        expected_cursor: u64, spent_amount: u64, key_version: u64, encrypted_result: vector<u8>, clock: &Clock, ctx: &mut TxContext) {
        let witness = historical(permission, run, cap, org);
        execution::finish_command_with_contract(run, cap, org, witness, final_state, expected_cursor, spent_amount, key_version, encrypted_result, clock, ctx);
        if (final_state != 4) settle(permission, object::id(run), spent_amount);
    }
    public fun request_stop(permission: &mut StandingPermission, run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &mut TxContext) {
        let witness = historical(permission, run, cap, org); let queued = execution::state(run) == 0;
        execution::request_stop_with_contract_v2(run, cap, org, human, grant, witness, clock, ctx);
        if (queued) settle(permission, object::id(run), 0);
    }
    public fun version(permission: &StandingPermission): u64 { permission.version }
    public fun budget_totals(permission: &StandingPermission): (u64, u64, u64, u64) {
        (permission.spent, permission.reserved, permission.approved_spent, permission.approved_reserved)
    }
    public fun approval_state(approval: &Approval): u8 { approval.state }
}
