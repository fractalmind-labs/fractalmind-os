/// Organization Host admission. Shared invitations are single-use and Clock
/// bounded; possession is proved without publishing the invite secret.
module fractalmind_protocol::host {
    use sui::object::{Self, ID, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use sui::dynamic_field as df;
    use sui::table::{Self, Table};
    use sui::event;
    use sui::ed25519;
    use sui::address;
    use std::bcs;
    use std::string::{Self, String};
    use std::option::{Self, Option};
    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::remote_authority::{Self, RemoteCapability};

    const E_INPUT: u64 = 9201;
    const E_EXPIRED: u64 = 9202;
    const E_REVOKED: u64 = 9203;
    const E_CONSUMED: u64 = 9204;
    const E_PROOF: u64 = 9205;
    const E_SCOPE: u64 = 9206;
    const E_CONFLICT: u64 = 9207;
    const DAY: u64 = 86400000;
    const MAX_INVITE_TTL: u64 = DAY;
    const MAX_MEMBER_TTL: u64 = 90 * DAY;

    public struct HostIndexBinding has copy, drop, store {}
    public struct HostIndex has store {
        bindings: vector<ID>, invitations: vector<ID>, memberships: vector<ID>,
        // A revoked membership remains indexed until replaced by explicit join.
        active_hosts: Table<address, ID>,
        instances: Table<InstanceKey, InstancePointer>,
    }
    public struct InstanceKey has copy, drop, store { host_address: address, instance_id: String }
    public struct InstancePointer has copy, drop, store {
        record_id: ID, membership_id: ID, runtime: String, workspace_hash: vector<u8>,
        control_confirmed: bool, revoked: bool,
    }
    public struct CoordinatorBinding has key {
        id: UID, org_id: ID, coordinator_address: address, public_key: vector<u8>,
        endpoint: String, version: u64, revoked: bool,
    }
    public struct HostInvite has key {
        id: UID, org_id: ID, coordinator_binding: ID, binding_version: u64,
        issuer_human: ID, issuer_device: address, issuer_grant: ID,
        issuer_grant_version: u64, issuer_generation: u64,
        proof_public_key: vector<u8>, template_version: u64,
        expires_at_ms: u64, membership_ttl_ms: u64, capability_ttl_ms: u64,
        max_uses: u8, uses: u8, revoked: bool,
    }
    public struct HostMembership has key {
        id: UID, org_id: ID, host_address: address, host_public_key: vector<u8>,
        encryption_public_key: vector<u8>, name: String, coordinator_binding: ID,
        version: u64, revoked: bool, expires_at_ms: u64, joined_at_ms: u64,
        source_invite: ID, observation_capability: ID,
    }
    /// Public Agent registrations are separate. This record is signed by a
    /// managing device and remains tied to a valid admitted Host.
    public struct ManagedAgent has key {
        id: UID, org_id: ID, membership_id: ID, host_address: address,
        instance_id: String, runtime: String, workspace_hash: vector<u8>,
        control_confirmed: bool, confirmed_by_human: ID, confirmed_by_device: address,
        version: u64, revoked: bool, imported_at_ms: u64,
    }
    public struct AuthorityBindingKey has copy, drop, store {}
    /// Bound to a RemoteCapability UID; neither a client nor another package
    /// can forge this metadata on a protocol capability.
    public struct AuthorityBinding has copy, drop, store {
        membership_id: ID, membership_version: u64,
        managed_agent: Option<ID>, managed_agent_version: u64,
        human_id: ID, device_grant: Option<ID>, device_grant_version: u64,
        human_generation: u64, required_action: u8,
    }
    public struct JoinIntent has copy, drop, store {
        domain: vector<u8>, invite_id: ID, org_id: ID, coordinator_binding: ID,
        binding_version: u64, host_address: address, host_public_key: vector<u8>,
        encryption_public_key: vector<u8>, proof_expires_at_ms: u64,
    }
    public struct BindingCreated has copy, drop { org_id: ID, binding_id: ID, version: u64 }
    public struct InviteCreated has copy, drop { org_id: ID, invite_id: ID, binding_id: ID, expires_at_ms: u64 }
    public struct HostJoined has copy, drop { org_id: ID, invite_id: ID, membership_id: ID, host_address: address, capability_id: ID }
    public struct MembershipRevoked has copy, drop { org_id: ID, membership_id: ID, version: u64 }
    public struct AgentImported has copy, drop { org_id: ID, membership_id: ID, record_id: ID, instance_id: String, duplicate: bool }

    fun index(org: &mut Organization, ctx: &mut TxContext): &mut HostIndex {
        if (!df::exists_(organization::borrow_uid(org), HostIndexBinding {})) {
            df::add(organization::borrow_uid_mut(org), HostIndexBinding {}, HostIndex {
                bindings: vector[], invitations: vector[], memberships: vector[],
                active_hosts: table::new(ctx), instances: table::new(ctx),
            });
        };
        df::borrow_mut(organization::borrow_uid_mut(org), HostIndexBinding {})
    }
    fun read_index(org: &Organization): &HostIndex { df::borrow(organization::borrow_uid(org), HostIndexBinding {}) }

    public fun create_coordinator_binding(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        public_key: vector<u8>, endpoint: String, clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert!(string::length(&endpoint) > 0 && string::length(&endpoint) <= 512, E_INPUT);
        let binding = CoordinatorBinding {
            id: object::new(ctx), org_id: object::id(org), coordinator_address: identity::signing_address(&public_key),
            public_key, endpoint, version: 1, revoked: false,
        };
        vector::push_back(&mut index(org, ctx).bindings, object::id(&binding));
        event::emit(BindingCreated { org_id: binding.org_id, binding_id: object::id(&binding), version: 1 });
        transfer::share_object(binding);
    }

    public fun revoke_coordinator_binding(org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, binding: &mut CoordinatorBinding, clock: &Clock, ctx: &TxContext) {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert!(binding.org_id == object::id(org) && !binding.revoked, E_SCOPE);
        binding.revoked = true;
        binding.version = binding.version + 1;
    }

    public fun create_invite(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, binding: &CoordinatorBinding,
        proof_public_key: vector<u8>, expires_at_ms: u64, membership_ttl_ms: u64, capability_ttl_ms: u64,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert_binding(org, binding);
        let now = clock::timestamp_ms(clock);
        assert!(expires_at_ms > now && expires_at_ms - now <= MAX_INVITE_TTL, E_EXPIRED);
        assert!(vector::length(&proof_public_key) == 32, E_INPUT);
        assert!(membership_ttl_ms > 0 && membership_ttl_ms <= MAX_MEMBER_TTL
            && capability_ttl_ms > 0 && capability_ttl_ms <= membership_ttl_ms, E_INPUT);
        let invite = HostInvite {
            id: object::new(ctx), org_id: object::id(org), coordinator_binding: object::id(binding), binding_version: binding.version,
            issuer_human: object::id(human), issuer_device: tx_context::sender(ctx), issuer_grant: object::id(grant),
            issuer_grant_version: identity::grant_version(grant), issuer_generation: identity::generation(human),
            proof_public_key, template_version: 1, expires_at_ms, membership_ttl_ms, capability_ttl_ms,
            max_uses: 1, uses: 0, revoked: false,
        };
        vector::push_back(&mut index(org, ctx).invitations, object::id(&invite));
        event::emit(InviteCreated { org_id: invite.org_id, invite_id: object::id(&invite), binding_id: object::id(binding), expires_at_ms });
        transfer::share_object(invite);
    }
    public fun revoke_invite(org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, invite: &mut HostInvite, clock: &Clock, ctx: &TxContext) {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert!(invite.org_id == object::id(org), E_SCOPE);
        assert!(invite.uses == 0, E_CONSUMED);
        assert!(!invite.revoked, E_REVOKED);
        invite.revoked = true;
    }

    public fun redeem_invite(
        org: &mut Organization, invite: &mut HostInvite, binding: &CoordinatorBinding,
        issuer: &HumanIdentity, issuer_grant: &DeviceGrant,
        host_public_key: vector<u8>, encryption_public_key: vector<u8>, name: String,
        proof_expires_at_ms: u64, proof_signature: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(invite.org_id == object::id(org) && invite.coordinator_binding == object::id(binding), E_SCOPE);
        assert_binding(org, binding);
        assert!(invite.binding_version == binding.version && invite.template_version == 1 && invite.max_uses == 1, E_SCOPE);
        assert!(!invite.revoked, E_REVOKED);
        assert!(invite.uses == 0, E_CONSUMED);
        assert!(now < invite.expires_at_ms && now < proof_expires_at_ms
            && proof_expires_at_ms <= invite.expires_at_ms && proof_expires_at_ms - now <= 300000, E_EXPIRED);
        assert!(invite.issuer_human == object::id(issuer) && invite.issuer_grant == object::id(issuer_grant)
            && invite.issuer_grant_version == identity::grant_version(issuer_grant)
            && invite.issuer_generation == identity::generation(issuer), E_SCOPE);
        identity::assert_can_for_device(issuer, issuer_grant, org, identity::manage_hosts_action(), clock, invite.issuer_device);
        let host_address = identity::signing_address(&host_public_key);
        assert!(host_address == tx_context::sender(ctx), E_PROOF);
        assert!(vector::length(&encryption_public_key) == 32 && string::length(&name) > 0 && string::length(&name) <= 128, E_INPUT);
        let intent = JoinIntent {
            domain: b"fractalmind.host-invite.v1", invite_id: object::id(invite), org_id: object::id(org),
            coordinator_binding: object::id(binding), binding_version: binding.version,
            host_address, host_public_key, encryption_public_key, proof_expires_at_ms,
        };
        assert!(ed25519::ed25519_verify(&proof_signature, &invite.proof_public_key, &bcs::to_bytes(&intent)), E_PROOF);
        let idx = index(org, ctx);
        assert!(!table::contains(&idx.active_hosts, host_address), E_CONFLICT);
        let mut membership = HostMembership {
            id: object::new(ctx), org_id: object::id(org), host_address, host_public_key,
            encryption_public_key, name, coordinator_binding: object::id(binding),
            version: 1, revoked: false, expires_at_ms: now + invite.membership_ttl_ms,
            joined_at_ms: now, source_invite: object::id(invite), observation_capability: object::id_from_address(@0x0),
        };
        let mut cap = remote_authority::new_capability(org, identity::human_address(issuer), host_address,
            2, node_identifier(host_address), string::utf8(b""), observation_actions(), string::utf8(b"observation"),
            10000, string::utf8(b""), 0, now + invite.capability_ttl_ms, clock, ctx);
        membership.observation_capability = object::id(&cap);
        df::add(remote_authority::capability_uid_mut(&mut cap), AuthorityBindingKey {}, AuthorityBinding {
            membership_id: object::id(&membership), membership_version: 1, managed_agent: option::none(), managed_agent_version: 0,
            human_id: object::id(issuer), device_grant: option::none(), device_grant_version: 0,
            human_generation: 0, required_action: identity::read_action(),
        });
        let member_id = object::id(&membership);
        table::add(&mut index(org, ctx).active_hosts, host_address, member_id);
        vector::push_back(&mut index(org, ctx).memberships, member_id);
        invite.uses = 1;
        event::emit(HostJoined { org_id: object::id(org), invite_id: object::id(invite), membership_id: member_id, host_address, capability_id: object::id(&cap) });
        remote_authority::share_capability(cap);
        transfer::share_object(membership);
    }

    public fun revoke_membership(org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, member: &mut HostMembership, clock: &Clock, ctx: &mut TxContext) {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert!(member.org_id == object::id(org) && !member.revoked, E_SCOPE);
        member.revoked = true;
        member.version = member.version + 1;
        let idx = index(org, ctx);
        if (table::contains(&idx.active_hosts, member.host_address)) {
            assert!(*table::borrow(&idx.active_hosts, member.host_address) == object::id(member), E_CONFLICT);
            table::remove(&mut idx.active_hosts, member.host_address);
        };
        event::emit(MembershipRevoked { org_id: object::id(org), membership_id: object::id(member), version: member.version });
    }

    public fun assert_binding(org: &Organization, binding: &CoordinatorBinding) {
        assert!(organization::is_active(org) && binding.org_id == object::id(org), E_SCOPE);
        assert!(!binding.revoked, E_REVOKED);
    }
    public fun assert_member(org: &Organization, member: &HostMembership, binding: &CoordinatorBinding, clock: &Clock) {
        assert_binding(org, binding);
        assert!(member.org_id == object::id(org) && member.coordinator_binding == object::id(binding), E_SCOPE);
        assert!(!member.revoked, E_REVOKED);
        assert!(clock::timestamp_ms(clock) < member.expires_at_ms, E_EXPIRED);
        assert!(*table::borrow(&read_index(org).active_hosts, member.host_address) == object::id(member), E_SCOPE);
    }

    public fun import_agent(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership,
        binding: &CoordinatorBinding, instance_id: String, runtime: String, workspace_hash: vector<u8>,
        control_confirmed: bool, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert_member(org, member, binding, clock);
        assert!(string::length(&instance_id) > 0 && string::length(&instance_id) <= 128 && vector::length(&workspace_hash) == 32, E_INPUT);
        assert!(runtime == string::utf8(b"tmux-observe") || runtime == string::utf8(b"bounded-process-v1"), E_INPUT);
        if (control_confirmed) assert!(runtime == string::utf8(b"bounded-process-v1"), E_INPUT);
        let key = InstanceKey { host_address: member.host_address, instance_id };
        let org_id = object::id(org);
        let idx = index(org, ctx);
        if (table::contains(&idx.instances, key)) {
            let old = table::borrow(&idx.instances, key);
            assert!(!old.revoked && old.membership_id == object::id(member) && old.runtime == runtime
                && old.workspace_hash == workspace_hash && old.control_confirmed == control_confirmed, E_CONFLICT);
            event::emit(AgentImported { org_id, membership_id: object::id(member), record_id: old.record_id, instance_id, duplicate: true });
            return old.record_id
        };
        let record = ManagedAgent {
            id: object::new(ctx), org_id: object::id(org), membership_id: object::id(member), host_address: member.host_address,
            instance_id, runtime, workspace_hash, control_confirmed, confirmed_by_human: object::id(human),
            confirmed_by_device: tx_context::sender(ctx), version: 1, revoked: false, imported_at_ms: clock::timestamp_ms(clock),
        };
        let record_id = object::id(&record);
        table::add(&mut index(org, ctx).instances, key, InstancePointer { record_id, membership_id: object::id(member), runtime, workspace_hash, control_confirmed, revoked: false });
        event::emit(AgentImported { org_id: object::id(org), membership_id: object::id(member), record_id, instance_id, duplicate: false });
        transfer::share_object(record);
        record_id
    }

    public fun revoke_agent(org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, record: &mut ManagedAgent, clock: &Clock, ctx: &mut TxContext) {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert!(record.org_id == object::id(org) && !record.revoked, E_SCOPE);
        record.revoked = true;
        record.version = record.version + 1;
        let key = InstanceKey { host_address: record.host_address, instance_id: record.instance_id };
        table::borrow_mut(&mut index(org, ctx).instances, key).revoked = true;
    }

    /// Explicit re-authorization retains the instance ID, advances its version,
    /// and invalidates all previously issued capabilities. Repeated discovery
    /// alone must never silently restore a revoked instance or change its scope.
    public fun rebind_agent(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, record: &mut ManagedAgent,
        runtime: String, workspace_hash: vector<u8>, control_confirmed: bool,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        assert_member(org, member, binding, clock);
        assert!(record.org_id == object::id(org) && record.host_address == member.host_address, E_SCOPE);
        assert!(vector::length(&workspace_hash) == 32, E_INPUT);
        assert!(runtime == string::utf8(b"tmux-observe") || runtime == string::utf8(b"bounded-process-v1"), E_INPUT);
        if (control_confirmed) assert!(runtime == string::utf8(b"bounded-process-v1"), E_INPUT);
        let key = InstanceKey { host_address: member.host_address, instance_id: record.instance_id };
        let confirmed_device = tx_context::sender(ctx);
        let pointer = table::borrow_mut(&mut index(org, ctx).instances, key);
        assert!(pointer.record_id == object::id(record), E_CONFLICT);
        record.membership_id = object::id(member);
        record.runtime = runtime;
        record.workspace_hash = workspace_hash;
        record.control_confirmed = control_confirmed;
        record.confirmed_by_human = object::id(human);
        record.confirmed_by_device = confirmed_device;
        record.version = record.version + 1;
        record.revoked = false;
        record.imported_at_ms = clock::timestamp_ms(clock);
        pointer.membership_id = object::id(member);
        pointer.runtime = runtime;
        pointer.workspace_hash = workspace_hash;
        pointer.control_confirmed = control_confirmed;
        pointer.revoked = false;
        event::emit(AgentImported { org_id: object::id(org), membership_id: object::id(member), record_id: object::id(record), instance_id: record.instance_id, duplicate: false });
    }

    /// One device obtains its own exact Host capability. It cannot silently
    /// issue execution authority to another device or an unregistered instance.
    public fun issue_device_capability(
        org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding,
        actions: vector<String>, scope: String, max_uses: u64, budget_asset: String, max_budget: u64,
        expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert_member(org, member, binding, clock);
        assert!(max_uses > 0 && max_uses <= 10000, E_INPUT);
        let required_action = classify_host_actions(&actions);
        identity::assert_can(human, grant, org, required_action, clock, ctx);
        assert!(expires_at_ms <= member.expires_at_ms && expires_at_ms <= identity::grant_expiry(grant), E_EXPIRED);
        let mut cap = remote_authority::new_capability(org, identity::human_address(human), tx_context::sender(ctx),
            2, node_identifier(member.host_address), string::utf8(b""), actions, scope, max_uses, budget_asset, max_budget, expires_at_ms, clock, ctx);
        attach_device_authority(&mut cap, human, grant, member, option::none(), 0, required_action);
        remote_authority::share_capability(cap);
    }
    public fun issue_agent_capability(
        org: &Organization, human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership,
        binding: &CoordinatorBinding, managed: &ManagedAgent, actions: vector<String>, scope: String,
        max_uses: u64, budget_asset: String, max_budget: u64, expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert_member(org, member, binding, clock);
        assert_managed(org, member, managed, false);
        assert!(max_uses > 0 && max_uses <= 10000, E_INPUT);
        let required_action = classify_agent_actions(&actions);
        identity::assert_can(human, grant, org, required_action, clock, ctx);
        if (required_action == identity::operate_action()) assert_managed(org, member, managed, true);
        assert!(expires_at_ms <= member.expires_at_ms && expires_at_ms <= identity::grant_expiry(grant), E_EXPIRED);
        let mut cap = remote_authority::new_capability(org, identity::human_address(human), tx_context::sender(ctx),
            3, node_identifier(member.host_address), managed.instance_id, actions, scope, max_uses, budget_asset, max_budget, expires_at_ms, clock, ctx);
        attach_device_authority(&mut cap, human, grant, member, option::some(object::id(managed)), managed.version, required_action);
        remote_authority::share_capability(cap);
    }
    fun attach_device_authority(cap: &mut RemoteCapability, human: &HumanIdentity, grant: &DeviceGrant, member: &HostMembership, managed: Option<ID>, managed_version: u64, required_action: u8) {
        df::add(remote_authority::capability_uid_mut(cap), AuthorityBindingKey {}, AuthorityBinding {
            membership_id: object::id(member), membership_version: member.version, managed_agent: managed, managed_agent_version: managed_version,
            human_id: object::id(human), device_grant: option::some(object::id(grant)), device_grant_version: identity::grant_version(grant),
            human_generation: identity::generation(human), required_action,
        });
    }
    public fun assert_managed(org: &Organization, member: &HostMembership, managed: &ManagedAgent, require_control: bool) {
        assert!(managed.org_id == object::id(org) && managed.membership_id == object::id(member) && managed.host_address == member.host_address, E_SCOPE);
        assert!(!managed.revoked, E_REVOKED);
        if (require_control) assert!(managed.control_confirmed && managed.runtime == string::utf8(b"bounded-process-v1"), E_INPUT);
    }
    fun classify_host_actions(actions: &vector<String>): u8 {
        let mut i = 0u64;
        assert!(vector::length(actions) > 0, E_INPUT);
        while (i < vector::length(actions)) {
            assert!(vector::contains(&observation_actions(), &actions[i]), E_INPUT);
            i = i + 1;
        };
        identity::read_action()
    }
    fun classify_agent_actions(actions: &vector<String>): u8 {
        let mut required = identity::read_action();
        let mut i = 0u64;
        assert!(vector::length(actions) > 0, E_INPUT);
        while (i < vector::length(actions)) {
            let action = actions[i];
            if (action == string::utf8(b"start") || action == string::utf8(b"stop") || action == string::utf8(b"assign") || action == string::utf8(b"direct.message")) {
                required = identity::operate_action();
            } else assert!(vector::contains(&observation_actions(), &action), E_INPUT);
            i = i + 1;
        };
        required
    }
    fun observation_actions(): vector<String> { vector[string::utf8(b"inventory"), string::utf8(b"status"), string::utf8(b"monitor"), string::utf8(b"logs"), string::utf8(b"health"), string::utf8(b"availability")] }
    fun node_identifier(host_address: address): String {
        let mut bytes = b"0x";
        let mut suffix = *string::as_bytes(&address::to_string(host_address));
        let mut i = 0u64;
        while (i < vector::length(&suffix)) {
            let byte = suffix[i];
            if (byte >= 65 && byte <= 70) *vector::borrow_mut(&mut suffix, i) = byte + 32;
            i = i + 1;
        };
        vector::append(&mut bytes, suffix);
        string::utf8(bytes)
    }
    public fun membership_host_address(member: &HostMembership): address { member.host_address }
    public fun membership_version(member: &HostMembership): u64 { member.version }
    public fun observation_capability(member: &HostMembership): ID { member.observation_capability }
    public fun managed_instance(managed: &ManagedAgent): String { managed.instance_id }
    public fun binding_version(binding: &CoordinatorBinding): u64 { binding.version }

    public(package) fun authority_binding(cap: &RemoteCapability): AuthorityBinding {
        *df::borrow(remote_authority::capability_uid(cap), AuthorityBindingKey {})
    }
    /// Host-signed starts check the recorded delegate explicitly, granting
    /// the Host none of the device's unrelated permissions.
    public(package) fun assert_device_authority(
        org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding,
        cap: &RemoteCapability, clock: &Clock,
    ) {
        assert_member(org, member, binding, clock);
        let auth = authority_binding(cap);
        assert!(remote_authority::org_id(cap) == object::id(org)
            && remote_authority::node_id(cap) == node_identifier(member.host_address)
            && option::is_none(&remote_authority::parent_id(cap)), E_SCOPE);
        assert!(auth.membership_id == object::id(member) && auth.membership_version == member.version, E_REVOKED);
        assert!(auth.human_id == object::id(human) && auth.device_grant == option::some(object::id(grant)), E_SCOPE);
        assert!(auth.device_grant_version == identity::grant_version(grant)
            && auth.human_generation == identity::generation(human), E_REVOKED);
        identity::assert_can_for_device(human, grant, org, auth.required_action, clock, remote_authority::delegate(cap));
    }
    public(package) fun assert_agent_authority(
        org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &ManagedAgent,
        cap: &RemoteCapability, clock: &Clock,
    ) {
        assert_device_authority(org, human, grant, member, binding, cap, clock);
        let auth = authority_binding(cap);
        assert!(auth.managed_agent == option::some(object::id(managed))
            && auth.managed_agent_version == managed.version, E_REVOKED);
        assert!(remote_authority::target_kind(cap) == remote_authority::target_agent()
            && remote_authority::agent_id(cap) == managed.instance_id, E_SCOPE);
        assert_managed(org, member, managed, auth.required_action == identity::operate_action());
    }
    public(package) fun assert_host_authority(
        org: &Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding,
        cap: &RemoteCapability, clock: &Clock,
    ) {
        assert_device_authority(org, human, grant, member, binding, cap, clock);
        let auth = authority_binding(cap);
        assert!(option::is_none(&auth.managed_agent) && auth.required_action == identity::read_action()
            && remote_authority::target_kind(cap) == remote_authority::target_node(), E_SCOPE);
    }
}
