/// Chain reservations and execution checkpoints for signed NodeCommands.
/// Preparation consumes one bounded capability use; only the admitted target
/// Host can confirm a start. A running/unknown checkpoint never permits replay.
module fractalmind_protocol::node_execution {
    use sui::object::{Self, ID, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::event;
    use std::hash;
    use std::option::{Self, Option};
    use std::string::{Self, String};
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::remote_authority::{Self as ra, RemoteCapability, ContractWitness};
    use fractalmind_protocol::product_record;

    const E_INPUT: u64 = 9301;
    const E_TARGET: u64 = 9302;
    const E_EXPIRED: u64 = 9303;
    const E_STARTED: u64 = 9304;
    const E_STATE: u64 = 9305;
    const E_VERSION: u64 = 9306;
    const E_BUDGET_SETTLEMENT_REQUIRED: u64 = 9310;
    const E_RESULT_KEY: u64 = 9311;
    const QUEUED: u8 = 0;
    const RUNNING: u8 = 1;
    const SUCCEEDED: u8 = 2;
    const FAILED: u8 = 3;
    const NEEDS_CONFIRMATION: u8 = 4;
    const CANCELLED: u8 = 5;
    public struct ExecutionIndexKey has copy, drop, store {}
    public struct ExecutionIndex has store { executions: Table<vector<u8>, ID> }
    public struct ResultKeyKey has copy, drop, store { intent_hash: vector<u8>, key_version: u64 }
    public struct ResultKeyGrant has store { org_id: ID, membership_id: ID, host_address: address, key_version: u64, wrapped_key: vector<u8> }
    public struct CommandExecution has key {
        id: UID, org_id: ID, capability_id: ID, capability_version: u64,
        human_id: ID, grant_id: ID, grant_version: u64,
        membership_id: ID, host_address: address, managed_agent: Option<ID>,
        delegate: address, node_id: String, agent_id: String,
        command_id: String, nonce: String, idempotency_key: String,
        intent_hash: vector<u8>, action: String, scope: String,
        budget_asset: String, budget_amount: u64,
        issued_at_ms: u64, expires_at_ms: u64, state: u8, cursor: u64,
        stop_requested: bool, created_at_ms: u64, started_at_ms: u64, updated_at_ms: u64,
        result_record: Option<ID>, result_hash: vector<u8>, attempt_id: vector<u8>,
    }
    public struct CommandPrepared has copy, drop { execution_id: ID, capability_id: ID, intent_hash: vector<u8>, duplicate: bool }
    public struct ExecutionChanged has copy, drop { execution_id: ID, state: u8, cursor: u64, stop_requested: bool, updated_at_ms: u64 }

    /// Include before prepare_* in the same PTB. Wrapping is to the Host's
    /// membership encryption key and carries only this command's result key.
    public fun grant_result_key(
        cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, intent_hash: vector<u8>, key_version: u64,
        wrapped_key: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        host::assert_device_authority(org, human, grant, member, binding, cap, clock);
        assert!(tx_context::sender(ctx) == ra::delegate(cap), E_RESULT_KEY);
        let key = ResultKeyKey { intent_hash, key_version };
        assert!(key_version == product_record::key_version(org) && vector::length(&intent_hash) == 32, E_RESULT_KEY);
        assert!(vector::length(&wrapped_key) == 132 && wrapped_key[0] == 70 && wrapped_key[1] == 77 && wrapped_key[2] == 87 && wrapped_key[3] == 49
            && wrapped_key[68] == 70 && wrapped_key[69] == 77 && wrapped_key[70] == 69 && wrapped_key[71] == 49, E_RESULT_KEY);
        if (df::exists_(ra::capability_uid(cap), key)) return;
        // A started legacy command cannot have its encryption scheme switched.
        assert!(option::is_none(&execution_id(cap, intent_hash)), E_RESULT_KEY);
        df::add(ra::capability_uid_mut(cap), key, ResultKeyGrant { org_id: object::id(org), membership_id: object::id(member),
            host_address: host::membership_host_address(member), key_version, wrapped_key });
    }

    public fun prepare_agent_command(
        cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        ra::assert_unbound_contract(cap);
        host::assert_legacy_agent_execution(org, object::id(managed));
        host::assert_agent_authority(org, human, grant, member, binding, managed, cap, clock);
        prepare(cap, org, human, grant, member, option::some(object::id(managed)), action, scope,
            command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
    }
    public fun prepare_host_command(
        cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        ra::assert_unbound_contract(cap);
        host::assert_host_authority(org, human, grant, member, binding, cap, clock);
        prepare(cap, org, human, grant, member, option::none(), action, scope,
            command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
    }
    public fun prepare_agent_command_v2(
        cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        ra::assert_unbound_contract(cap);
        host::assert_tracked_agent_execution(org, object::id(managed));
        host::assert_agent_authority(org, human, grant, member, binding, managed, cap, clock);
        let duplicate = option::is_some(&execution_id(cap, intent_hash));
        let run_id = prepare(cap, org, human, grant, member, option::some(object::id(managed)), action, scope,
            command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
        if (!duplicate) host::record_agent_execution(org, object::id(managed), run_id, object::id(cap), action);
    }
    public(package) fun prepare_agent_command_with_contract(
        cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, witness: ContractWitness,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ): ID {
        host::assert_legacy_agent_execution(org, object::id(managed));
        host::assert_agent_authority(org, human, grant, member, binding, managed, cap, clock);
        ra::record_contract_command(cap, intent_hash, &witness);
        prepare(cap, org, human, grant, member, option::some(object::id(managed)), action, scope,
            command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx)
    }
    public(package) fun prepare_agent_command_with_contract_v2(
        cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, witness: ContractWitness,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ): ID {
        host::assert_tracked_agent_execution(org, object::id(managed));
        host::assert_agent_authority(org, human, grant, member, binding, managed, cap, clock);
        ra::record_contract_command(cap, intent_hash, &witness);
        let duplicate = option::is_some(&execution_id(cap, intent_hash));
        let run_id = prepare(cap, org, human, grant, member, option::some(object::id(managed)), action, scope,
            command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
        if (!duplicate) host::record_agent_execution(org, object::id(managed), run_id, object::id(cap), action);
        run_id
    }
    fun prepare(
        cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, managed: Option<ID>,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ): ID {
        let now = clock::timestamp_ms(clock);
        assert!(issued_at_ms > 0 && expires_at_ms > issued_at_ms && expires_at_ms - issued_at_ms <= 300000, E_INPUT);
        assert!(now < expires_at_ms && issued_at_ms <= now + 30000 && expires_at_ms <= ra::expires_at_ms(cap), E_EXPIRED);
        let target_kind = ra::target_kind(cap);
        let node_id = ra::node_id(cap);
        let agent_id = ra::agent_id(cap);
        ra::claim_bound_use(cap, action, scope, target_kind, node_id, agent_id,
            command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, clock, ctx);
        let old = execution_id(cap, intent_hash);
        if (option::is_some(&old)) {
            event::emit(CommandPrepared { execution_id: *option::borrow(&old), capability_id: object::id(cap), intent_hash, duplicate: true });
            return *option::borrow(&old)
        };
        let run = CommandExecution {
            id: object::new(ctx), org_id: object::id(org), capability_id: object::id(cap), capability_version: ra::revocation_version(cap),
            human_id: object::id(human), grant_id: object::id(grant), grant_version: identity::grant_version(grant),
            membership_id: object::id(member), host_address: host::membership_host_address(member), managed_agent: managed,
            delegate: ra::delegate(cap), node_id: ra::node_id(cap), agent_id: ra::agent_id(cap),
            command_id, nonce, idempotency_key, intent_hash, action, scope, budget_asset, budget_amount,
            issued_at_ms, expires_at_ms, state: QUEUED, cursor: 1, stop_requested: false,
            created_at_ms: now, started_at_ms: 0, updated_at_ms: now, result_record: option::none(), result_hash: vector[], attempt_id: vector[],
        };
        let run_id = object::id(&run);
        if (!df::exists_(ra::capability_uid(cap), ExecutionIndexKey {})) {
            df::add(ra::capability_uid_mut(cap), ExecutionIndexKey {}, ExecutionIndex { executions: table::new(ctx) });
        };
        let idx: &mut ExecutionIndex = df::borrow_mut(ra::capability_uid_mut(cap), ExecutionIndexKey {});
        table::add(&mut idx.executions, intent_hash, run_id);
        event::emit(CommandPrepared { execution_id: run_id, capability_id: object::id(cap), intent_hash, duplicate: false });
        transfer::share_object(run);
        run_id
    }
    public fun execution_id(cap: &RemoteCapability, intent_hash: vector<u8>): Option<ID> {
        if (!df::exists_(ra::capability_uid(cap), ExecutionIndexKey {})) return option::none();
        let idx: &ExecutionIndex = df::borrow(ra::capability_uid(cap), ExecutionIndexKey {});
        if (table::contains(&idx.executions, intent_hash)) option::some(*table::borrow(&idx.executions, intent_hash)) else option::none()
    }
    public fun begin_agent_command(
        run: &mut CommandExecution, cap: &RemoteCapability, org: &Organization,
        human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership,
        binding: &CoordinatorBinding, managed: &ManagedAgent, attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        ra::assert_unbound_contract(cap);
        host::assert_agent_authority(org, human, grant, member, binding, managed, cap, clock);
        assert!(run.managed_agent == option::some(object::id(managed)), E_TARGET);
        begin(run, cap, member, attempt_id, clock, ctx);
    }
    public fun begin_host_command(
        run: &mut CommandExecution, cap: &RemoteCapability, org: &Organization,
        human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership,
        binding: &CoordinatorBinding, attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        ra::assert_unbound_contract(cap);
        host::assert_host_authority(org, human, grant, member, binding, cap, clock);
        assert!(option::is_none(&run.managed_agent), E_TARGET);
        begin(run, cap, member, attempt_id, clock, ctx);
    }
    fun begin(run: &mut CommandExecution, cap: &RemoteCapability, member: &HostMembership, attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == run.host_address && host::membership_host_address(member) == run.host_address
            && object::id(member) == run.membership_id && object::id(cap) == run.capability_id, E_TARGET);
        assert!(run.state == QUEUED && !run.stop_requested, E_STARTED);
        assert!(vector::length(&attempt_id) == 32, E_INPUT);
        assert!(clock::timestamp_ms(clock) < run.expires_at_ms, E_EXPIRED);
        assert!(ra::revocation_version(cap) == run.capability_version && ra::delegate(cap) == run.delegate, E_VERSION);
        ra::assert_authorized_with_clock(cap, &run.action, &run.scope, ra::target_kind(cap), &run.node_id, &run.agent_id, clock, ctx);
        assert!(ra::authority_claim_matches(cap, &run.action, &run.scope, ra::target_kind(cap), &run.node_id, &run.agent_id,
            &run.command_id, &run.nonce, &run.idempotency_key, &run.budget_asset, run.budget_amount, &run.intent_hash), E_INPUT);
        assert!(execution_id(cap, run.intent_hash) == option::some(object::id(run)), E_TARGET);
        run.state = RUNNING;
        run.attempt_id = attempt_id;
        run.started_at_ms = clock::timestamp_ms(clock);
        changed(run, clock);
    }
    public(package) fun begin_agent_command_with_contract(
        run: &mut CommandExecution, cap: &RemoteCapability, org: &Organization,
        human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership,
        binding: &CoordinatorBinding, managed: &ManagedAgent, witness: ContractWitness,
        attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        host::assert_agent_authority(org, human, grant, member, binding, managed, cap, clock);
        assert!(run.managed_agent == option::some(object::id(managed)), E_TARGET);
        ra::assert_contract_command(cap, run.intent_hash, &witness);
        begin(run, cap, member, attempt_id, clock, ctx);
    }
    /// Publishing historical execution evidence remains allowed after authority
    /// expires or is revoked; this entry cannot start or approve new execution.
    /// Retain the previous ABI, requiring explicit budget settlement in v0.2.0.
    #[allow(unused_variable)]
    public fun finish_command(
        run: &mut CommandExecution, org: &mut Organization, final_state: u8,
        expected_cursor: u64, key_version: u64, encrypted_result: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        abort E_BUDGET_SETTLEMENT_REQUIRED
    }
    public fun finish_command_with_budget(
        run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, final_state: u8,
        expected_cursor: u64, spent_amount: u64, key_version: u64, encrypted_result: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        ra::assert_unbound_contract(cap);
        finish(run, cap, org, final_state, expected_cursor, spent_amount, key_version, encrypted_result, clock, ctx);
    }
    public(package) fun finish_command_with_contract(
        run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, witness: ContractWitness, final_state: u8,
        expected_cursor: u64, spent_amount: u64, key_version: u64, encrypted_result: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        ra::assert_contract_command(cap, run.intent_hash, &witness);
        finish(run, cap, org, final_state, expected_cursor, spent_amount, key_version, encrypted_result, clock, ctx);
    }
    fun finish(
        run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, final_state: u8,
        expected_cursor: u64, spent_amount: u64, key_version: u64, encrypted_result: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == run.host_address && object::id(org) == run.org_id, E_TARGET);
        assert!(object::id(cap) == run.capability_id, E_TARGET);
        assert!(run.state == RUNNING && run.cursor == expected_cursor, E_STATE);
        assert!(final_state == SUCCEEDED || final_state == FAILED || final_state == NEEDS_CONFIRMATION
            || (final_state == CANCELLED && run.stop_requested), E_STATE);
        if (vector::length(&encrypted_result) >= 4 && encrypted_result[3] == 50) {
            let key = ResultKeyKey { intent_hash: run.intent_hash, key_version };
            assert!(df::exists_(ra::capability_uid(cap), key), E_RESULT_KEY);
            let envelope: &ResultKeyGrant = df::borrow(ra::capability_uid(cap), key);
            assert!(envelope.org_id == run.org_id && envelope.membership_id == run.membership_id && envelope.host_address == run.host_address, E_RESULT_KEY);
        };
        if (final_state == NEEDS_CONFIRMATION) {
            // Unknown side effects retain their entire reservation. This entry
            // cannot invent zero actual cost and release their remaining budget.
            assert!(spent_amount == 0, E_INPUT);
        } else {
            ra::settle_bound_budget(cap, run.intent_hash, spent_amount);
        };
        let logical_id = result_logical_id(&run.intent_hash);
        let result_hash = hash::sha2_256(encrypted_result);
        let record_id = product_record::save_authorized(org, run.human_id, run.grant_id, run.grant_version,
            5, logical_id, 0, key_version, encrypted_result, clock, ctx);
        run.result_record = option::some(record_id);
        run.result_hash = result_hash;
        run.state = final_state;
        if (final_state != NEEDS_CONFIRMATION && option::is_some(&run.managed_agent))
            host::settle_agent_execution(org, *option::borrow(&run.managed_agent), object::id(run), object::id(cap));
        changed(run, clock);
    }
    #[allow(unused_variable)]
    public fun request_stop(run: &mut CommandExecution, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &TxContext) {
        abort E_BUDGET_SETTLEMENT_REQUIRED
    }
    public fun request_stop_with_budget(run: &mut CommandExecution, cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &TxContext) {
        ra::assert_unbound_contract(cap);
        assert_legacy_queued_stop(run, org);
        request_stop_authorized(run, cap, org, human, grant, clock, ctx);
    }
    public fun request_stop_with_budget_v2(run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &TxContext) {
        ra::assert_unbound_contract(cap);
        request_stop_tracked(run, cap, org, human, grant, clock, ctx);
    }
    public(package) fun request_stop_with_contract(run: &mut CommandExecution, cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, witness: ContractWitness, clock: &Clock, ctx: &TxContext) {
        ra::assert_contract_command(cap, run.intent_hash, &witness);
        assert_legacy_queued_stop(run, org);
        request_stop_authorized(run, cap, org, human, grant, clock, ctx);
    }
    public(package) fun request_stop_with_contract_v2(run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, witness: ContractWitness, clock: &Clock, ctx: &TxContext) {
        ra::assert_contract_command(cap, run.intent_hash, &witness);
        request_stop_tracked(run, cap, org, human, grant, clock, ctx);
    }
    fun assert_legacy_queued_stop(run: &CommandExecution, org: &Organization) {
        if (run.state == QUEUED && option::is_some(&run.managed_agent))
            host::assert_legacy_agent_execution(org, *option::borrow(&run.managed_agent));
    }
    fun request_stop_tracked(run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &TxContext) {
        let was_queued = run.state == QUEUED;
        request_stop_authorized(run, cap, org, human, grant, clock, ctx);
        if (was_queued && option::is_some(&run.managed_agent))
            host::settle_agent_execution(org, *option::borrow(&run.managed_agent), object::id(run), object::id(cap));
    }
    fun request_stop_authorized(run: &mut CommandExecution, cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &TxContext) {
        identity::assert_can(human, grant, org, identity::operate_action(), clock, ctx);
        assert!(run.org_id == object::id(org) && run.human_id == object::id(human) && run.capability_id == object::id(cap), E_TARGET);
        assert!(run.state == QUEUED || run.state == RUNNING, E_STATE);
        if (run.stop_requested) return;
        run.stop_requested = true;
        if (run.state == QUEUED) {
            ra::settle_bound_budget(cap, run.intent_hash, 0);
            run.state = CANCELLED;
        };
        changed(run, clock);
    }
    fun changed(run: &mut CommandExecution, clock: &Clock) {
        run.cursor = run.cursor + 1;
        run.updated_at_ms = clock::timestamp_ms(clock);
        event::emit(ExecutionChanged { execution_id: object::id(run), state: run.state, cursor: run.cursor, stop_requested: run.stop_requested, updated_at_ms: run.updated_at_ms });
    }
    fun result_logical_id(hash: &vector<u8>): String {
        let alphabet = b"0123456789abcdef";
        let mut bytes = b"command-";
        let mut i = 0u64;
        while (i < vector::length(hash)) {
            vector::push_back(&mut bytes, alphabet[hash[i] as u64 / 16]);
            vector::push_back(&mut bytes, alphabet[hash[i] as u64 % 16]);
            i = i + 1;
        };
        string::utf8(bytes)
    }
    public fun state(run: &CommandExecution): u8 { run.state }
    public fun cursor(run: &CommandExecution): u64 { run.cursor }
    /// Typed checkpoint facts for product evidence. These getters grant no
    /// authority and do not turn a Host measurement into human acceptance.
    public fun organization_id(run: &CommandExecution): ID { run.org_id }
    public fun managed_agent_id(run: &CommandExecution): Option<ID> { run.managed_agent }
    public fun host_address(run: &CommandExecution): address { run.host_address }
    public fun created_at_ms(run: &CommandExecution): u64 { run.created_at_ms }
    public fun result_record(run: &CommandExecution): Option<ID> { run.result_record }
    public fun intent_hash(run: &CommandExecution): vector<u8> { run.intent_hash }
    public fun capability_id(run: &CommandExecution): ID { run.capability_id }
    public fun budget_amount(run: &CommandExecution): u64 { run.budget_amount }
    public fun budget_asset(run: &CommandExecution): String { run.budget_asset }
}
