/// Sealed extension bridge. The organization approves one original witness
/// type; only its defining module can construct that witness. Neither UID nor
/// unchecked record writers are exposed to callers in another package.
module fractalmind_protocol::execution_extension {
    use std::type_name::{Self, TypeName};
    use std::string::{Self, String};
    use sui::object::{Self, ID};
    use sui::clock::Clock;
    use sui::tx_context::TxContext;
    use sui::dynamic_field as df;
    use sui::table::{Self, Table};
    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::remote_authority::{Self as ra, RemoteCapability, ContractWitness};
    use fractalmind_protocol::product_record;

    const E_SOURCE: u64 = 9701;
    const E_CONFLICT: u64 = 9702;
    const E_RECORD: u64 = 9703;
    public struct IndexKey has copy, drop, store { family: u8 }
    public struct PermissionIndex has store { source: TypeName, agents: Table<ID, ID> }
    public struct SourceKey has copy, drop, store {}
    public struct ExtensionSource has store { source: TypeName }
    public struct FieldKey<phantom W> has copy, drop, store { tag: vector<u8> }

    public fun register_source<W: drop>(org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, family: u8, _witness: &W, clock: &Clock, ctx: &mut TxContext) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        assert!(family <= 1, E_SOURCE);
        let source = type_name::with_original_ids<W>();
        if (!df::exists_(organization::borrow_uid(org), IndexKey { family }))
            df::add(organization::borrow_uid_mut(org), IndexKey { family }, PermissionIndex { source, agents: table::new(ctx) });
        assert_source(org, family, _witness);
    }
    public fun register_permission<W: drop>(org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, managed: ID, permission: ID, witness: &W, clock: &Clock, ctx: &mut TxContext) {
        register_source(org, human, grant, 0, witness, clock, ctx);
        let index: &mut PermissionIndex = df::borrow_mut(organization::borrow_uid_mut(org), IndexKey { family: 0 });
        assert!(!table::contains(&index.agents, managed), E_CONFLICT);
        table::add(&mut index.agents, managed, permission);
    }
    fun assert_source<W: drop>(org: &Organization, family: u8, _witness: &W) {
        let index: &PermissionIndex = df::borrow(organization::borrow_uid(org), IndexKey { family });
        assert!(index.source == type_name::with_original_ids<W>(), E_SOURCE);
    }
    public fun assert_permission<W: drop>(org: &Organization, witness: &W, managed: ID, permission: ID) {
        assert_source(org, 0, witness);
        let index: &PermissionIndex = df::borrow(organization::borrow_uid(org), IndexKey { family: 0 });
        assert!(*table::borrow(&index.agents, managed) == permission, E_SOURCE);
    }
    public fun has_org_field<W: drop>(org: &Organization, family: u8, witness: &W, tag: vector<u8>): bool {
        assert_source(org, family, witness); df::exists_(organization::borrow_uid(org), FieldKey<W> { tag })
    }
    public fun put_org_field<W: drop, V: store>(org: &mut Organization, family: u8, witness: &W, tag: vector<u8>, value: V) {
        assert_source(org, family, witness); df::add(organization::borrow_uid_mut(org), FieldKey<W> { tag }, value);
    }
    public fun org_field<W: drop, V: store>(org: &Organization, family: u8, witness: &W, tag: vector<u8>): &V {
        assert_source(org, family, witness); df::borrow(organization::borrow_uid(org), FieldKey<W> { tag })
    }
    public fun org_field_mut<W: drop, V: store>(org: &mut Organization, family: u8, witness: &W, tag: vector<u8>): &mut V {
        assert_source(org, family, witness); df::borrow_mut(organization::borrow_uid_mut(org), FieldKey<W> { tag })
    }
    public fun confirm_reviewed_control<W: drop>(org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, witness: &W, member: &HostMembership, binding: &CoordinatorBinding, managed: &mut ManagedAgent, expected_version: u64, workspace_hash: vector<u8>, clock: &Clock, ctx: &mut TxContext) {
        assert_source(org, 1, witness);
        host::confirm_reviewed_control(org, human, grant, member, binding, managed, expected_version, workspace_hash, clock, ctx);
    }
    public fun save_record<W: drop>(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, family: u8, witness: &W,
        kind: u8, logical_id: String, revision: u64, key_version: u64,
        encrypted: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        assert_source(org, family, witness);
        assert!((family == 0 && (kind == 2 || kind == 3 || kind == 6)) || (family == 1 && (kind == 1 || kind == 2 || kind == 4)), E_RECORD);
        let action = if (family == 0 && (kind == 6 || (kind == 3 && revision == 0))) identity::read_action()
            else if (family == 1 && kind == 2 && revision > 0) identity::operate_action() else identity::approve_action();
        identity::assert_can(human, grant, org, action, clock, ctx);
        product_record::save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            kind, logical_id, revision, key_version, encrypted, clock, ctx)
    }
    public fun new_capability<W: drop>(
        org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        family: u8, witness: &W, permission: ID, version: u64, boundary: vector<u8>,
        max_uses: u64, budget_asset: String, budget: u64, expiry: u64, clock: &Clock, ctx: &mut TxContext,
    ): RemoteCapability {
        assert_source(org, family, witness);
        if (family == 0) assert_permission(org, witness, object::id(managed), permission);
        let mut cap = host::new_agent_capability(org, human, grant, member, binding, managed,
            vector[if (family == 0) string::utf8(b"direct.message") else string::utf8(b"assign")], if (family == 0) string::utf8(b"direct") else string::utf8(b"control"), max_uses, budget_asset, budget, expiry, clock, ctx);
        ra::bind_execution_contract(&mut cap, permission, version, boundary);
        df::add(ra::capability_uid_mut(&mut cap), SourceKey {}, ExtensionSource { source: type_name::with_original_ids<W>() });
        cap
    }
    fun assert_cap_source<W: drop>(cap: &RemoteCapability, _witness: &W) {
        let source: &ExtensionSource = df::borrow(ra::capability_uid(cap), SourceKey {});
        assert!(source.source == type_name::with_original_ids<W>(), E_SOURCE);
    }
    public fun put_field<W: drop, V: store>(cap: &mut RemoteCapability, witness: &W, tag: vector<u8>, value: V) {
        assert_cap_source(cap, witness);
        df::add(ra::capability_uid_mut(cap), FieldKey<W> { tag }, value);
    }
    public fun field<W: drop, V: store>(cap: &RemoteCapability, witness: &W, tag: vector<u8>): &V {
        assert_cap_source(cap, witness);
        df::borrow(ra::capability_uid(cap), FieldKey<W> { tag })
    }
    public fun witness<W: drop>(cap: &RemoteCapability, seal: &W, permission: ID, version: u64, kr_index: u64, boundary: vector<u8>): ContractWitness {
        assert_cap_source(cap, seal);
        ra::contract_witness(cap, permission, version, kr_index, boundary)
    }
    public fun settlement_witness<W: drop>(cap: &RemoteCapability, seal: &W, intent_hash: vector<u8>, permission: ID): ContractWitness {
        assert_cap_source(cap, seal);
        ra::settlement_witness(cap, intent_hash, permission)
    }
    /// Shared ownership for all registered OKR assignments; core types remain stable.
    public struct ActiveAssignmentsKey has copy, drop, store {}
    public struct ActiveAssignmentTrackedKey has copy, drop, store {}
    public struct WorkspaceKey has copy, drop, store { host_address: address, workspace_hash: vector<u8> }
    public struct ActiveAssignmentTracked has copy, drop, store { managed: ID, workspace: WorkspaceKey }
    public struct ActiveAssignments has store { total: u64, revision: u64, agents: Table<ID, u64>, workspaces: Table<WorkspaceKey, u64> }
    public fun register_assignment<W: drop>(org: &mut Organization, contract: &mut sui::object::UID, witness: &W, managed: ID, host_address: address, workspace_hash: vector<u8>, ctx: &mut TxContext) {
        assert_source(org, 1, witness);
        if (!df::exists_(organization::borrow_uid(org), ActiveAssignmentsKey {}))
            df::add(organization::borrow_uid_mut(org), ActiveAssignmentsKey {}, ActiveAssignments { total: 0, revision: 1, agents: table::new(ctx), workspaces: table::new(ctx) });
        assert!(!df::exists_(contract, ActiveAssignmentTrackedKey {}), E_CONFLICT);
        let entries: &mut ActiveAssignments = df::borrow_mut(organization::borrow_uid_mut(org), ActiveAssignmentsKey {});
        if (table::contains(&entries.agents, managed)) {
            let count = table::borrow_mut(&mut entries.agents, managed); *count = *count + 1;
        } else table::add(&mut entries.agents, managed, 1);
        let workspace = WorkspaceKey { host_address, workspace_hash };
        if (table::contains(&entries.workspaces, workspace)) {
            let count = table::borrow_mut(&mut entries.workspaces, workspace); *count = *count + 1;
        } else table::add(&mut entries.workspaces, workspace, 1);
        entries.total = entries.total + 1; entries.revision = entries.revision + 1;
        df::add(contract, ActiveAssignmentTrackedKey {}, ActiveAssignmentTracked { managed, workspace });
    }
    public fun release_assignment<W: drop>(org: &mut Organization, contract: &mut sui::object::UID, witness: &W) {
        assert_source(org, 1, witness);
        if (!df::exists_(contract, ActiveAssignmentTrackedKey {})) return;
        let tracked: ActiveAssignmentTracked = df::remove(contract, ActiveAssignmentTrackedKey {});
        let managed = tracked.managed;
        let entries: &mut ActiveAssignments = df::borrow_mut(organization::borrow_uid_mut(org), ActiveAssignmentsKey {});
        let count = table::borrow_mut(&mut entries.agents, managed); assert!(*count > 0 && entries.total > 0, E_CONFLICT);
        *count = *count - 1;
        if (*count == 0) { let _: u64 = table::remove(&mut entries.agents, managed); };
        let count = table::borrow_mut(&mut entries.workspaces, tracked.workspace); assert!(*count > 0, E_CONFLICT);
        *count = *count - 1;
        if (*count == 0) { let _: u64 = table::remove(&mut entries.workspaces, tracked.workspace); };
        entries.total = entries.total - 1; entries.revision = entries.revision + 1;
    }
    /// protected, revision, complete. Unknown legacy coverage cannot authorize
    /// direct writes; observations/questions need not pause another Run.
    public fun direct_workspace_state(org: &Organization, managed: ID, host_address: address, workspace_hash: vector<u8>): (bool, u64, bool) {
        if (!df::exists_(organization::borrow_uid(org), ActiveAssignmentsKey {})) return (false, 0, true);
        let entries: &ActiveAssignments = df::borrow(organization::borrow_uid(org), ActiveAssignmentsKey {});
        let workspace = WorkspaceKey { host_address, workspace_hash };
        ((table::contains(&entries.agents, managed) && *table::borrow(&entries.agents, managed) > 0)
            || (table::contains(&entries.workspaces, workspace) && *table::borrow(&entries.workspaces, workspace) > 0), entries.revision, true)
    }
}
