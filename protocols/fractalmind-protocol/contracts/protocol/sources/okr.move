/// v0.2.0 product OKRs. Legacy Objective objects retain their ABI; this model
/// separates measurements, authorized verification and final human acceptance.
module fractalmind_protocol::okr {
    use sui::object::{Self, ID, UID};
    use sui::clock::{Self, Clock};
    use sui::tx_context::{Self, TxContext};
    use sui::dynamic_field as df;
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::event;
    use std::string::{Self, String};
    use std::option::{Self, Option};
    use std::hash;
    use std::bcs;
    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::node_execution::{Self, CommandExecution};
    use fractalmind_protocol::product_record::{Self, EncryptedRecord};
    use fractalmind_protocol::remote_authority::{Self as ra, RemoteCapability, ContractWitness};

    const E_INPUT: u64 = 9401;
    const E_VERSION: u64 = 9402;
    const E_STATE: u64 = 9403;
    const E_ACTIVE_LIMIT: u64 = 9404;
    const E_TARGET: u64 = 9405;
    const E_ORDER: u64 = 9406;
    const E_EVIDENCE: u64 = 9407;
    const E_STALE: u64 = 9408;
    const E_BUDGET: u64 = 9409;
    const E_HANDOVER_REQUIRED: u64 = 9410;
    const DRAFT: u8 = 0;
    const ACTIVE: u8 = 1;
    const PAUSED: u8 = 2;
    const ACHIEVED: u8 = 3;
    const ARCHIVED: u8 = 4;

    public struct IndexKey has copy, drop, store {}
    public struct DraftPointer has copy, drop, store { id: ID, fingerprint: vector<u8> }
    public struct OkrIndex has store { active_count: u64, records: Table<String, DraftPointer> }
    public struct BudgetKey has copy, drop, store {}
    public struct BudgetState has store { asset: String, spent: u64, reserved: u64, claims: Table<ID, BudgetClaim> }
    public struct BudgetClaim has copy, drop, store { capability_id: ID, agreement_version: u64, kr_index: u64, reserved: u64, spent: u64, settled: bool }
    public struct DraftIntent has copy, drop, store {
        human_id: ID, priority: u8, deadline_ms: u64, metrics: vector<Metric>, key_version: u64, encrypted_spec: vector<u8>,
    }
    // Numeric values use an explicit fixed scale in the encrypted spec; names,
    // units, sampling rules and sensitive success criteria remain encrypted.
    public struct Metric has copy, drop, store {
        baseline: u64, target: u64, weight: u64, max_age_ms: u64,
        current: Option<u64>, sampled_at_ms: u64, run_id: Option<ID>,
        evidence_id: Option<ID>, verified: bool, verification_id: Option<ID>,
    }
    public struct Observation has key {
        id: UID, org_id: ID, okr_id: ID, kr_index: u64, agreement_version: u64,
        current: u64, sampled_at_ms: u64, recorded_at_ms: u64,
        run_id: ID, evidence_id: ID, host_address: address,
    }
    public struct Okr has key {
        id: UID, org_id: ID, owner_human: ID, logical_id: String,
        state: u8, version: u64, agreement_version: u64, priority: u8,
        deadline_ms: u64, spec_record: ID, spec_revision: u64,
        metrics: vector<Metric>, next_kr: u64, observations: Table<u64, ID>,
        managed_agent: Option<ID>, managed_version: u64,
        membership_id: Option<ID>, membership_version: u64,
        workspace_hash: vector<u8>, boundary_hash: vector<u8>,
        budget_asset: String, budget_limit: u64, expires_at_ms: u64,
        activated_at_ms: u64, agreement_record: Option<ID>,
        acceptance_record: Option<ID>, accepted_by_human: Option<ID>, accepted_at_ms: u64,
    }
    public struct HandoverPolicyKey has copy, drop, store {}
    public struct HandoverPolicy has copy, drop, store {
        agreement_version: u64, managed_version: u64, max_calls: u64,
        nonce: vector<u8>, proposal_hash: vector<u8>, approval_id: ID,
    }
    public(package) fun record_handover_policy(okr: &mut Okr, max_calls: u64, nonce: vector<u8>, proposal_hash: vector<u8>, approval_id: ID) {
        assert!(okr.state == ACTIVE && max_calls > 0 && max_calls <= 1000 && max_calls <= okr.budget_limit
            && vector::length(&nonce) == 32 && vector::length(&proposal_hash) == 32, E_INPUT);
        if (df::exists_(&okr.id, HandoverPolicyKey {})) {
            let _: HandoverPolicy = df::remove(&mut okr.id, HandoverPolicyKey {});
        };
        df::add(&mut okr.id, HandoverPolicyKey {}, HandoverPolicy {
            agreement_version: okr.agreement_version, managed_version: okr.managed_version,
            max_calls, nonce, proposal_hash, approval_id,
        });
    }
    public struct Changed has copy, drop {
        org_id: ID, okr_id: ID, state: u8, version: u64, agreement_version: u64, next_kr: u64,
    }

    fun record_name(logical_id: String, suffix: vector<u8>): String {
        let mut name = string::utf8(b"okr-");
        string::append(&mut name, logical_id);
        string::append_utf8(&mut name, suffix);
        name
    }
    fun metrics(baselines: vector<u64>, targets: vector<u64>, weights: vector<u64>, ages: vector<u64>): vector<Metric> {
        let n = vector::length(&baselines);
        assert!(n > 0 && n <= 3 && vector::length(&targets) == n && vector::length(&weights) == n && vector::length(&ages) == n, E_INPUT);
        let mut out = vector[]; let mut i = 0u64;
        while (i < n) {
            assert!(baselines[i] != targets[i] && weights[i] > 0 && weights[i] <= 1000000 && ages[i] > 0 && ages[i] <= 2592000000, E_INPUT);
            vector::push_back(&mut out, Metric { baseline: baselines[i], target: targets[i], weight: weights[i], max_age_ms: ages[i],
                current: option::none(), sampled_at_ms: 0, run_id: option::none(), evidence_id: option::none(), verified: false, verification_id: option::none() });
            i = i + 1;
        };
        out
    }
    fun assert_version(okr: &Okr, org: &Organization, expected: u64) {
        assert!(okr.org_id == object::id(org), E_TARGET);
        assert!(okr.version == expected, E_VERSION);
    }
    fun changed(okr: &mut Okr) {
        okr.version = okr.version + 1;
        event::emit(Changed { org_id: okr.org_id, okr_id: object::id(okr), state: okr.state, version: okr.version, agreement_version: okr.agreement_version, next_kr: okr.next_kr });
    }
    fun index(org: &mut Organization, ctx: &mut TxContext): &mut OkrIndex {
        if (!df::exists_(organization::borrow_uid(org), IndexKey {})) {
            df::add(organization::borrow_uid_mut(org), IndexKey {}, OkrIndex { active_count: 0, records: table::new(ctx) });
        };
        df::borrow_mut(organization::borrow_uid_mut(org), IndexKey {})
    }

    /// The encrypted spec and its typed measurable criteria are created in one
    /// transaction. Exact draft retries return the original ID, not a new OKR.
    public fun create_draft(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        logical_id: String, priority: u8, deadline_ms: u64,
        baselines: vector<u64>, targets: vector<u64>, weights: vector<u64>, max_ages_ms: vector<u64>,
        key_version: u64, encrypted_spec: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert!(string::length(&logical_id) > 0 && string::length(&logical_id) <= 64 && priority <= 2 && deadline_ms > clock::timestamp_ms(clock), E_INPUT);
        let measured = metrics(baselines, targets, weights, max_ages_ms);
        let intent = DraftIntent { human_id: object::id(human), priority, deadline_ms, metrics: measured, key_version, encrypted_spec };
        let fingerprint = hash::sha2_256(bcs::to_bytes(&intent));
        let registry = index(org, ctx);
        if (table::contains(&registry.records, logical_id)) {
            let previous = table::borrow(&registry.records, logical_id);
            assert!(previous.fingerprint == fingerprint, E_VERSION);
            return previous.id
        };
        let spec_record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            1, record_name(logical_id, b"-spec"), 0, key_version, encrypted_spec, clock, ctx);
        let okr = Okr { id: object::new(ctx), org_id: object::id(org), owner_human: object::id(human), logical_id,
            state: DRAFT, version: 1, agreement_version: 0, priority, deadline_ms, spec_record, spec_revision: 1,
            metrics: measured, next_kr: 0, observations: table::new(ctx), managed_agent: option::none(), managed_version: 0,
            membership_id: option::none(), membership_version: 0, workspace_hash: vector[], boundary_hash: vector[],
            budget_asset: string::utf8(b""), budget_limit: 0, expires_at_ms: 0, activated_at_ms: 0,
            agreement_record: option::none(), acceptance_record: option::none(), accepted_by_human: option::none(), accepted_at_ms: 0 };
        let id = object::id(&okr);
        table::add(&mut index(org, ctx).records, logical_id, DraftPointer { id, fingerprint });
        event::emit(Changed { org_id: okr.org_id, okr_id: id, state: DRAFT, version: 1, agreement_version: 0, next_kr: 0 });
        transfer::share_object(okr);
        id
    }

    /// Activation/resumption binds exactly one live, explicitly controllable
    /// instance. A new agreement version invalidates prior runtime approvals.
    #[allow(unused_variable)]
    public fun activate(
        okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        expected_version: u64, workspace_hash: vector<u8>, boundary_hash: vector<u8>,
        budget_asset: String, budget_limit: u64, expires_at_ms: u64,
        expected_record_revision: u64, key_version: u64, encrypted_agreement: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        abort E_HANDOVER_REQUIRED
    }
    public(package) fun activate_reviewed(
        okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        expected_version: u64, workspace_hash: vector<u8>, boundary_hash: vector<u8>,
        budget_asset: String, budget_limit: u64, expires_at_ms: u64,
        expected_record_revision: u64, key_version: u64, encrypted_agreement: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert_version(okr, org, expected_version);
        assert!(okr.state == DRAFT || okr.state == PAUSED, E_STATE);
        host::assert_member(org, member, binding, clock);
        host::assert_managed(org, member, managed, true);
        assert!(workspace_hash == host::managed_workspace_hash(managed) && vector::length(&workspace_hash) == 32 && vector::length(&boundary_hash) == 32, E_TARGET);
        assert!(string::length(&budget_asset) > 0 && string::length(&budget_asset) <= 32 && budget_limit > 0 && expires_at_ms > clock::timestamp_ms(clock) && expires_at_ms <= okr.deadline_ms, E_INPUT);
        let registry = index(org, ctx);
        assert!(registry.active_count < 3, E_ACTIVE_LIMIT);
        registry.active_count = registry.active_count + 1;
        let record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            2, record_name(okr.logical_id, b"-agreement"), expected_record_revision, key_version, encrypted_agreement, clock, ctx);
        okr.managed_agent = option::some(object::id(managed)); okr.managed_version = host::managed_version(managed);
        okr.membership_id = option::some(object::id(member)); okr.membership_version = host::membership_version(member);
        okr.workspace_hash = workspace_hash; okr.boundary_hash = boundary_hash;
        okr.budget_asset = budget_asset; okr.budget_limit = budget_limit; okr.expires_at_ms = expires_at_ms;
        let ledger = budget(okr, ctx);
        assert!((ledger.asset == budget_asset || (ledger.spent == 0 && ledger.reserved == 0 && table::length(&ledger.claims) == 0)) && ledger.spent <= budget_limit && ledger.reserved <= budget_limit - ledger.spent, E_BUDGET);
        ledger.asset = budget_asset;
        okr.agreement_record = option::some(record); okr.agreement_version = okr.agreement_version + 1;
        okr.activated_at_ms = clock::timestamp_ms(clock); okr.state = ACTIVE;
        changed(okr);
    }
    fun budget(okr: &mut Okr, ctx: &mut TxContext): &mut BudgetState {
        if (!df::exists_(&okr.id, BudgetKey {})) {
            df::add(&mut okr.id, BudgetKey {}, BudgetState { asset: okr.budget_asset, spent: 0, reserved: 0, claims: table::new(ctx) });
        };
        df::borrow_mut(&mut okr.id, BudgetKey {})
    }
    fun assignment_witness(
        okr: &Okr, org: &Organization, member: &HostMembership, binding: &CoordinatorBinding,
        managed: &ManagedAgent, cap: &RemoteCapability, kr_index: u64, clock: &Clock,
    ): ContractWitness {
        assert!(okr.org_id == object::id(org) && ra::org_id(cap) == okr.org_id, E_TARGET);
        assert!(okr.state == ACTIVE && clock::timestamp_ms(clock) < okr.expires_at_ms, E_STATE);
        assert!(kr_index == okr.next_kr && kr_index < vector::length(&okr.metrics), E_ORDER);
        host::assert_member(org, member, binding, clock); host::assert_managed(org, member, managed, true);
        assert!(okr.managed_agent == option::some(object::id(managed)) && okr.managed_version == host::managed_version(managed)
            && okr.membership_id == option::some(object::id(member)) && okr.membership_version == host::membership_version(member)
            && okr.workspace_hash == host::managed_workspace_hash(managed), E_TARGET);
        assert!(ra::actions(cap) == vector[string::utf8(b"assign")] && ra::scope(cap) == string::utf8(b"control")
            && ra::budget_asset(cap) == okr.budget_asset && ra::max_budget(cap) <= okr.budget_limit && ra::expires_at_ms(cap) <= okr.expires_at_ms, E_TARGET);
        ra::contract_witness(cap, object::id(okr), okr.agreement_version, kr_index, okr.boundary_hash)
    }
    public fun issue_capability(
        okr: &Okr, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        expected_version: u64, max_uses: u64, clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert_version(okr, org, expected_version);
        assert!(okr.state == ACTIVE && okr.next_kr < vector::length(&okr.metrics), E_STATE);
        assert!(df::exists_(&okr.id, HandoverPolicyKey {}), E_HANDOVER_REQUIRED);
        let policy: &HandoverPolicy = df::borrow(&okr.id, HandoverPolicyKey {});
        assert!(policy.agreement_version == okr.agreement_version && policy.managed_version == okr.managed_version, E_TARGET);
        let mut cap = host::new_agent_capability(org, human, grant, member, binding, managed,
            vector[string::utf8(b"assign")], string::utf8(b"control"), max_uses, okr.budget_asset, policy.max_calls, okr.expires_at_ms, clock, ctx);
        ra::bind_execution_contract(&mut cap, object::id(okr), okr.agreement_version, okr.boundary_hash);
        let _ = assignment_witness(okr, org, member, binding, managed, &cap, okr.next_kr, clock);
        ra::share_capability(cap);
    }
    public fun prepare_command(
        okr: &mut Okr, cap: &mut RemoteCapability, org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, expected_agreement: u64, kr_index: u64,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        assert!(expected_agreement == okr.agreement_version, E_VERSION);
        let witness = assignment_witness(okr, org, member, binding, managed, cap, kr_index, clock);
        assert!(budget_asset == okr.budget_asset && budget_amount > 0, E_BUDGET);
        let old = node_execution::execution_id(cap, intent_hash);
        let limit = okr.budget_limit; let agreement_version = okr.agreement_version;
        let ledger = budget(okr, ctx);
        let existed = option::is_some(&old) && table::contains(&ledger.claims, *option::borrow(&old));
        if (!existed) assert!(ledger.spent <= limit && ledger.reserved <= limit - ledger.spent && budget_amount <= limit - ledger.spent - ledger.reserved, E_BUDGET);
        let run_id = node_execution::prepare_agent_command_with_contract(cap, org, human, grant, member, binding, managed, witness,
            action, scope, command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
        let ledger = budget(okr, ctx);
        if (existed) {
            let previous = table::borrow(&ledger.claims, run_id);
            assert!(previous.capability_id == object::id(cap) && previous.agreement_version == agreement_version && previous.kr_index == kr_index && previous.reserved == budget_amount, E_BUDGET);
        } else {
            assert!(!table::contains(&ledger.claims, run_id), E_BUDGET);
            ledger.reserved = ledger.reserved + budget_amount;
            table::add(&mut ledger.claims, run_id, BudgetClaim { capability_id: object::id(cap), agreement_version, kr_index, reserved: budget_amount, spent: 0, settled: false });
        };
    }
    public fun prepare_command_v2(
        okr: &mut Okr, cap: &mut RemoteCapability, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent, expected_agreement: u64, kr_index: u64,
        action: String, scope: String, command_id: String, nonce: String, idempotency_key: String,
        budget_asset: String, budget_amount: u64, intent_hash: vector<u8>, issued_at_ms: u64, expires_at_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        assert!(expected_agreement == okr.agreement_version, E_VERSION);
        let witness = assignment_witness(okr, org, member, binding, managed, cap, kr_index, clock);
        assert!(budget_asset == okr.budget_asset && budget_amount > 0, E_BUDGET);
        let old = node_execution::execution_id(cap, intent_hash);
        let limit = okr.budget_limit; let agreement_version = okr.agreement_version;
        let ledger = budget(okr, ctx);
        let existed = option::is_some(&old) && table::contains(&ledger.claims, *option::borrow(&old));
        if (!existed) assert!(ledger.spent <= limit && ledger.reserved <= limit - ledger.spent && budget_amount <= limit - ledger.spent - ledger.reserved, E_BUDGET);
        let run_id = node_execution::prepare_agent_command_with_contract_v2(cap, org, human, grant, member, binding, managed, witness,
            action, scope, command_id, nonce, idempotency_key, budget_asset, budget_amount, intent_hash, issued_at_ms, expires_at_ms, clock, ctx);
        let ledger = budget(okr, ctx);
        if (existed) {
            let previous = table::borrow(&ledger.claims, run_id);
            assert!(previous.capability_id == object::id(cap) && previous.agreement_version == agreement_version && previous.kr_index == kr_index && previous.reserved == budget_amount, E_BUDGET);
        } else {
            assert!(!table::contains(&ledger.claims, run_id), E_BUDGET);
            ledger.reserved = ledger.reserved + budget_amount;
            table::add(&mut ledger.claims, run_id, BudgetClaim { capability_id: object::id(cap), agreement_version, kr_index, reserved: budget_amount, spent: 0, settled: false });
        };
    }
    public fun begin_command(
        okr: &Okr, run: &mut CommandExecution, cap: &RemoteCapability, org: &Organization,
        human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership, binding: &CoordinatorBinding,
        managed: &ManagedAgent, attempt_id: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        let witness = assignment_witness(okr, org, member, binding, managed, cap, okr.next_kr, clock);
        let ledger: &BudgetState = df::borrow(&okr.id, BudgetKey {});
        let claim = table::borrow(&ledger.claims, sui::object::id(run));
        assert!(!claim.settled && claim.capability_id == object::id(cap) && claim.agreement_version == okr.agreement_version && claim.kr_index == okr.next_kr, E_BUDGET);
        node_execution::begin_agent_command_with_contract(run, cap, org, human, grant, member, binding, managed, witness, attempt_id, clock, ctx);
    }
    public fun finish_command(
        okr: &mut Okr, run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization, final_state: u8,
        expected_cursor: u64, spent_amount: u64, key_version: u64, encrypted_result: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert!(okr.org_id == object::id(org) && node_execution::capability_id(run) == object::id(cap), E_TARGET);
        let witness = ra::settlement_witness(cap, node_execution::intent_hash(run), object::id(okr));
        let ledger = budget(okr, ctx); let claim = table::borrow(&ledger.claims, object::id(run));
        assert!(!claim.settled && claim.capability_id == object::id(cap) && claim.reserved == node_execution::budget_amount(run)
            && ledger.asset == node_execution::budget_asset(run) && spent_amount <= claim.reserved, E_BUDGET);
        node_execution::finish_command_with_contract(run, cap, org, witness, final_state, expected_cursor, spent_amount, key_version, encrypted_result, clock, ctx);
        if (final_state != 4) settle(okr, object::id(run), spent_amount, ctx);
    }
    public fun request_stop(
        okr: &mut Okr, run: &mut CommandExecution, cap: &mut RemoteCapability, org: &Organization,
        human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert!(okr.org_id == object::id(org) && node_execution::capability_id(run) == object::id(cap), E_TARGET);
        let witness = ra::settlement_witness(cap, node_execution::intent_hash(run), object::id(okr));
        let was_queued = node_execution::state(run) == 0;
        node_execution::request_stop_with_contract(run, cap, org, human, grant, witness, clock, ctx);
        if (was_queued) settle(okr, object::id(run), 0, ctx);
    }
    public fun request_stop_v2(
        okr: &mut Okr, run: &mut CommandExecution, cap: &mut RemoteCapability, org: &mut Organization,
        human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert!(okr.org_id == object::id(org) && node_execution::capability_id(run) == object::id(cap), E_TARGET);
        let witness = ra::settlement_witness(cap, node_execution::intent_hash(run), object::id(okr));
        let was_queued = node_execution::state(run) == 0;
        node_execution::request_stop_with_contract_v2(run, cap, org, human, grant, witness, clock, ctx);
        if (was_queued) settle(okr, object::id(run), 0, ctx);
    }
    fun settle(okr: &mut Okr, run_id: ID, spent: u64, ctx: &mut TxContext) {
        let ledger = budget(okr, ctx); let claim = table::borrow_mut(&mut ledger.claims, run_id);
        assert!(!claim.settled && spent <= claim.reserved && ledger.reserved >= claim.reserved, E_BUDGET);
        ledger.reserved = ledger.reserved - claim.reserved; ledger.spent = ledger.spent + spent;
        claim.spent = spent; claim.settled = true;
    }
    public fun pause(
        okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        expected_version: u64, expected_record_revision: u64, key_version: u64, encrypted_reason: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::operate_action(), clock, ctx);
        assert_version(okr, org, expected_version); assert!(okr.state == ACTIVE, E_STATE);
        let record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            2, record_name(okr.logical_id, b"-agreement"), expected_record_revision, key_version, encrypted_reason, clock, ctx);
        let registry = index(org, ctx); registry.active_count = registry.active_count - 1;
        okr.state = PAUSED; okr.agreement_version = okr.agreement_version + 1; okr.agreement_record = option::some(record);
        changed(okr);
    }
    public fun replace_spec(
        okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, expected_version: u64,
        priority: u8, deadline_ms: u64, baselines: vector<u64>, targets: vector<u64>, weights: vector<u64>, max_ages_ms: vector<u64>,
        key_version: u64, encrypted_spec: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert_version(okr, org, expected_version); assert!(okr.state == DRAFT || okr.state == PAUSED, E_STATE);
        assert!(priority <= 2 && deadline_ms > clock::timestamp_ms(clock), E_INPUT);
        let measured = metrics(baselines, targets, weights, max_ages_ms);
        okr.spec_record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            1, record_name(okr.logical_id, b"-spec"), okr.spec_revision, key_version, encrypted_spec, clock, ctx);
        okr.spec_revision = okr.spec_revision + 1; okr.metrics = measured; okr.next_kr = 0;
        okr.priority = priority; okr.deadline_ms = deadline_ms; okr.agreement_version = okr.agreement_version + 1;
        changed(okr);
    }

    /// Host observations are explicitly unverified. A real successful Run and
    /// its immutable encrypted result must exist; a supplied hash alone is not
    /// evidence. The capability and command must bind this agreement and KR.
    public fun observe(
        okr: &mut Okr, org: &Organization, member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        cap: &RemoteCapability, run: &CommandExecution, evidence: &EncryptedRecord, expected_version: u64, expected_agreement: u64,
        kr_index: u64, current: u64, sampled_at_ms: u64, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert_version(okr, org, expected_version); assert!(okr.agreement_version == expected_agreement, E_VERSION);
        assert!(okr.state == ACTIVE && clock::timestamp_ms(clock) < okr.expires_at_ms, E_STATE);
        host::assert_member(org, member, binding, clock); host::assert_managed(org, member, managed, true);
        assert!(okr.managed_agent == option::some(object::id(managed)) && okr.managed_version == host::managed_version(managed)
            && okr.membership_id == option::some(object::id(member)) && okr.membership_version == host::membership_version(member), E_TARGET);
        assert!(tx_context::sender(ctx) == host::membership_host_address(member), E_TARGET);
        assert!(kr_index == okr.next_kr && kr_index < vector::length(&okr.metrics), E_ORDER);
        let witness = assignment_witness(okr, org, member, binding, managed, cap, kr_index, clock);
        ra::assert_contract_command(cap, node_execution::intent_hash(run), &witness);
        assert!(node_execution::state(run) == 2 && node_execution::capability_id(run) == object::id(cap) && node_execution::organization_id(run) == okr.org_id
            && node_execution::managed_agent_id(run) == okr.managed_agent && node_execution::host_address(run) == tx_context::sender(ctx)
            && node_execution::created_at_ms(run) >= okr.activated_at_ms && node_execution::result_record(run) == option::some(object::id(evidence))
            && product_record::record_organization(evidence) == okr.org_id, E_EVIDENCE);
        let metric = &mut okr.metrics[kr_index]; let now = clock::timestamp_ms(clock);
        assert!(sampled_at_ms >= node_execution::created_at_ms(run) && sampled_at_ms <= now
            && now - sampled_at_ms <= metric.max_age_ms && sampled_at_ms >= metric.sampled_at_ms, E_STALE);
        metric.current = option::some(current); metric.sampled_at_ms = sampled_at_ms;
        metric.run_id = option::some(object::id(run)); metric.evidence_id = option::some(object::id(evidence));
        metric.verified = false; metric.verification_id = option::none();
        let observation = Observation { id: object::new(ctx), org_id: okr.org_id, okr_id: object::id(okr), kr_index,
            agreement_version: okr.agreement_version, current, sampled_at_ms, recorded_at_ms: now,
            run_id: object::id(run), evidence_id: object::id(evidence), host_address: tx_context::sender(ctx) };
        table::add(&mut okr.observations, okr.version, object::id(&observation));
        transfer::freeze_object(observation);
        changed(okr);
    }
    fun assert_measured(metric: &Metric, now: u64) {
        assert!(option::is_some(&metric.current) && option::is_some(&metric.evidence_id) && option::is_some(&metric.run_id), E_EVIDENCE);
        assert!(metric.sampled_at_ms <= now && now - metric.sampled_at_ms <= metric.max_age_ms, E_STALE);
        let current = *option::borrow(&metric.current);
        assert!((metric.target > metric.baseline && current >= metric.target) || (metric.target < metric.baseline && current <= metric.target), E_EVIDENCE);
    }
    public fun verify_kr(
        okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        expected_version: u64, kr_index: u64, expected_record_revision: u64, key_version: u64,
        encrypted_verification: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert_version(okr, org, expected_version); assert!(okr.state == ACTIVE, E_STATE);
        assert!(kr_index == okr.next_kr && kr_index < vector::length(&okr.metrics), E_ORDER);
        assert_measured(&okr.metrics[kr_index], clock::timestamp_ms(clock));
        let record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            4, record_name(okr.logical_id, b"-verification"), expected_record_revision, key_version, encrypted_verification, clock, ctx);
        okr.metrics[kr_index].verified = true; okr.metrics[kr_index].verification_id = option::some(record);
        okr.next_kr = okr.next_kr + 1;
        changed(okr);
    }
    /// Final success criteria are reviewed by an authorized human separately
    /// from metrics and KR verification. Neither an Agent nor a Run can call
    /// this on the human's behalf using Host identity.
    public fun achieve(
        okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        expected_version: u64, success_criteria_confirmed: bool, key_version: u64, encrypted_acceptance: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert_version(okr, org, expected_version);
        assert!(okr.state == ACTIVE && success_criteria_confirmed && okr.next_kr == vector::length(&okr.metrics), E_STATE);
        let now = clock::timestamp_ms(clock); let mut i = 0u64;
        while (i < vector::length(&okr.metrics)) {
            assert!(okr.metrics[i].verified && option::is_some(&okr.metrics[i].verification_id), E_EVIDENCE);
            assert_measured(&okr.metrics[i], now); i = i + 1;
        };
        let record = product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            4, record_name(okr.logical_id, b"-acceptance"), 0, key_version, encrypted_acceptance, clock, ctx);
        let registry = index(org, ctx); registry.active_count = registry.active_count - 1;
        okr.state = ACHIEVED; okr.acceptance_record = option::some(record); okr.accepted_by_human = option::some(object::id(human)); okr.accepted_at_ms = now;
        okr.agreement_version = okr.agreement_version + 1; changed(okr);
    }
    public fun archive(okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, expected_version: u64, clock: &Clock, ctx: &mut TxContext) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert_version(okr, org, expected_version); assert!(okr.state != ARCHIVED, E_STATE);
        if (okr.state == ACTIVE) {
            let registry = index(org, ctx); registry.active_count = registry.active_count - 1;
        };
        okr.state = ARCHIVED; okr.agreement_version = okr.agreement_version + 1; changed(okr);
    }
    public fun organization_id(okr: &Okr): ID { okr.org_id }
    public fun spec_revision(okr: &Okr): u64 { okr.spec_revision }
    public fun deadline_ms(okr: &Okr): u64 { okr.deadline_ms }
    public fun state(okr: &Okr): u8 { okr.state }
    public fun version(okr: &Okr): u64 { okr.version }
    public fun agreement_version(okr: &Okr): u64 { okr.agreement_version }
    public fun next_kr(okr: &Okr): u64 { okr.next_kr }
    public fun active_count(org: &Organization): u64 {
        if (!df::exists_(organization::borrow_uid(org), IndexKey {})) return 0;
        let registry: &OkrIndex = df::borrow(organization::borrow_uid(org), IndexKey {}); registry.active_count
    }
}
