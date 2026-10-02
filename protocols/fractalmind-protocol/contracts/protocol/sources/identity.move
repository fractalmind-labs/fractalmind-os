/// Stable Human identity, bounded device grants, and single-use recovery.
/// Recovery authority is a Sui Ed25519 signer derived locally from the code.
/// The code itself is never an argument. A signed recovery transaction proves
/// possession; gas may be paid by the recovering device using sponsorship.
module fractalmind_protocol::identity {
    use sui::object::{Self, ID, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::dynamic_field as df;
    use sui::hash;
    use sui::address;
    use sui::event;
    use std::option::{Self, Option};
    use std::string::{Self, String};
    use fractalmind_protocol::organization::{Self, ProtocolRegistry, Organization, OrgAdminCap};

    const E_PERMISSION: u64 = 9001;
    const E_EXPIRED: u64 = 9002;
    const E_REVOKED: u64 = 9003;
    const E_SCOPE: u64 = 9004;
    const E_RECOVERY_USED: u64 = 9005;
    const E_INPUT: u64 = 9006;
    const E_REGISTRY: u64 = 9007;
    const READ: u8 = 1;
    const OPERATE: u8 = 2;
    const APPROVE: u8 = 3;
    const MANAGE_HOSTS: u8 = 4;
    const WEEK: u64 = 604800000;
    const MAX_TTL: u64 = 31536000000;
    const MAX_BACKUP: u64 = 65536;

    public struct RegistryBinding has copy, drop, store {}
    public struct IdentityRegistry has key {
        id: UID,
        protocol_registry: ID,
        // Entries remain after consumption so a used code cannot be reused.
        recoveries: Table<address, RecoveryLocation>,
        devices: Table<address, vector<ID>>,
    }
    public struct RecoveryLocation has copy, drop, store {
        human_id: ID,
        record_id: ID,
        version: u64,
    }
    public struct HumanIdentity has key {
        id: UID,
        registry_id: ID,
        network: String,
        generation: u64,
        recovery_version: u64,
        recovery_record: ID,
        recovery_address: address,
        // Caps never escape this module. Action-specific wrappers borrow them.
        admin_caps: Table<ID, OrgAdminCap>,
        roles: Table<ID, OrgRole>,
        organizations: vector<ID>,
        grants: vector<ID>,
    }
    public struct OrgRole has copy, drop, store {
        owner_human: ID,
        admin: bool,
        active: bool,
        version: u64,
    }
    public struct DeviceGrant has key {
        id: UID,
        human_id: ID,
        device: address,
        org_scope: Option<ID>,
        actions: vector<u8>,
        expires_at_ms: u64,
        revoked: bool,
        version: u64,
        generation: u64,
        encryption_public_key: vector<u8>,
        encrypted_keys: vector<u8>,
    }
    public struct RecoveryRecord has key {
        id: UID,
        human_id: ID,
        registry_id: ID,
        format_version: u8,
        network: String,
        version: u64,
        active: bool,
        recovery_address: address,
        signing_public_key: vector<u8>,
        encryption_public_key: vector<u8>,
        encrypted_backup: vector<u8>,
        backup_version: u64,
    }
    public struct IdentityCreated has copy, drop { human_id: ID, recovery_record: ID, device_grant: ID }
    public struct DeviceGranted has copy, drop { human_id: ID, grant_id: ID, device: address, generation: u64 }
    public struct DeviceRevoked has copy, drop { human_id: ID, grant_id: ID, version: u64 }
    public struct IdentityRecovered has copy, drop { human_id: ID, old_record: ID, new_record: ID, generation: u64 }
    public struct RecoveryCodeReplaced has copy, drop { human_id: ID, old_record: ID, new_record: ID, version: u64 }
    public struct OrganizationBound has copy, drop { human_id: ID, org_id: ID }

    /// Also works after an upgrade, whose bootstrap init is not rerun.
    public fun initialize_registry(protocol: &mut ProtocolRegistry, ctx: &mut TxContext) {
        assert!(!df::exists_(organization::registry_uid(protocol), RegistryBinding {}), E_REGISTRY);
        let registry = IdentityRegistry {
            id: object::new(ctx), protocol_registry: object::id(protocol),
            recoveries: table::new(ctx), devices: table::new(ctx),
        };
        df::add(organization::registry_uid_mut(protocol), RegistryBinding {}, object::id(&registry));
        transfer::share_object(registry);
    }

    public fun create_identity(
        registry: &mut IdentityRegistry, network: String,
        recovery_signing_key: vector<u8>, recovery_encryption_key: vector<u8>,
        encrypted_backup: vector<u8>, device: address, device_encryption_key: vector<u8>,
        encrypted_device_keys: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        check_network(&network);
        let recovery_address = signing_address(&recovery_signing_key);
        assert!(tx_context::sender(ctx) == recovery_address, E_PERMISSION);
        assert!(!table::contains(&registry.recoveries, recovery_address), E_RECOVERY_USED);
        assert!(!table::contains(&registry.devices, recovery_address), E_INPUT);
        check_encryption_key(&recovery_encryption_key);
        check_backup(&encrypted_backup);
        let mut human = HumanIdentity {
            id: object::new(ctx), registry_id: object::id(registry), network,
            generation: 1, recovery_version: 1,
            recovery_record: object::id_from_address(@0x0), recovery_address,
            admin_caps: table::new(ctx), roles: table::new(ctx),
            organizations: vector[], grants: vector[],
        };
        let record = new_recovery_record(&human, recovery_signing_key, recovery_encryption_key, encrypted_backup, ctx);
        human.recovery_record = object::id(&record);
        table::add(&mut registry.recoveries, recovery_address, RecoveryLocation {
            human_id: object::id(&human), record_id: object::id(&record), version: 1,
        });
        let grant_id = new_grant(registry, &mut human, device, option::none(), all_actions(),
            clock::timestamp_ms(clock) + 30 * 86400000, device_encryption_key, encrypted_device_keys, ctx);
        event::emit(IdentityCreated { human_id: object::id(&human), recovery_record: object::id(&record), device_grant: grant_id });
        transfer::share_object(record);
        transfer::share_object(human);
    }

    /// New devices get the current organization, seven days, and read only.
    public fun add_read_device(
        registry: &mut IdentityRegistry, human: &mut HumanIdentity, authorizer: &DeviceGrant,
        org: &Organization, device: address, encryption_key: vector<u8>, encrypted_keys: vector<u8>,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        if (option::is_none(&authorizer.org_scope)) {
            assert_root(human, authorizer, clock, ctx);
            assert_can(human, authorizer, org, READ, clock, ctx);
        } else assert_can(human, authorizer, org, APPROVE, clock, ctx);
        new_grant(registry, human, device, option::some(object::id(org)), vector[READ],
            clock::timestamp_ms(clock) + WEEK, encryption_key, encrypted_keys, ctx);
    }

    public fun change_device_permissions(
        human: &HumanIdentity, authorizer: &DeviceGrant, target: &mut DeviceGrant,
        org: &Organization, actions: vector<u8>, expires_at_ms: u64, clock: &Clock, ctx: &TxContext,
    ) {
        assert_can(human, authorizer, org, APPROVE, clock, ctx);
        assert!(target.human_id == object::id(human) && target.generation == human.generation && !target.revoked, E_REVOKED);
        assert!(target.org_scope == option::some(object::id(org)), E_SCOPE);
        check_actions(&actions);
        check_expiry(expires_at_ms, clock);
        target.actions = actions;
        target.expires_at_ms = expires_at_ms;
        target.version = target.version + 1;
    }

    public fun revoke_device(human: &HumanIdentity, authorizer: &DeviceGrant, target: &mut DeviceGrant, clock: &Clock, ctx: &TxContext) {
        assert_grant(human, authorizer, APPROVE, clock, ctx);
        assert!(target.human_id == object::id(human) && !target.revoked, E_REVOKED);
        // An organization-scoped device cannot revoke a root or other-org grant.
        if (option::is_some(&authorizer.org_scope)) {
            assert!(authorizer.org_scope == target.org_scope, E_SCOPE);
            let role = table::borrow(&human.roles, *option::borrow(&authorizer.org_scope));
            assert!(role.active && role.admin, E_PERMISSION);
        };
        target.revoked = true;
        target.version = target.version + 1;
        event::emit(DeviceRevoked { human_id: object::id(human), grant_id: object::id(target), version: target.version });
    }

    /// Explicit addition of a root device is separate from the default flow.
    public fun add_root_device(
        registry: &mut IdentityRegistry, human: &mut HumanIdentity, authorizer: &DeviceGrant,
        device: address, encryption_key: vector<u8>, encrypted_keys: vector<u8>,
        expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert_root(human, authorizer, clock, ctx);
        check_expiry(expires_at_ms, clock);
        new_grant(registry, human, device, option::none(), all_actions(), expires_at_ms, encryption_key, encrypted_keys, ctx);
    }

    public fun update_recovery_backup(
        human: &HumanIdentity, authorizer: &DeviceGrant, record: &mut RecoveryRecord,
        expected_backup_version: u64, encrypted_backup: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        assert_root(human, authorizer, clock, ctx);
        assert_current_recovery(human, record);
        assert!(record.backup_version == expected_backup_version, E_INPUT);
        check_backup(&encrypted_backup);
        record.encrypted_backup = encrypted_backup;
        record.backup_version = record.backup_version + 1;
    }

    public fun update_device_keys(
        human: &HumanIdentity, authorizer: &DeviceGrant, target: &mut DeviceGrant,
        org: &Organization, expected_version: u64, encrypted_keys: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        assert_can(human, authorizer, org, APPROVE, clock, ctx);
        assert!(target.human_id == object::id(human) && target.generation == human.generation && !target.revoked, E_REVOKED);
        if (option::is_some(&target.org_scope)) assert!(target.org_scope == option::some(object::id(org)), E_SCOPE);
        // Only a root grant can publish a whole-identity root keyring.
        if (option::is_none(&target.org_scope)) assert_root(human, authorizer, clock, ctx);
        assert!(target.version == expected_version, E_INPUT);
        check_backup(&encrypted_keys);
        target.encrypted_keys = encrypted_keys;
        target.version = target.version + 1;
    }

    public fun update_root_device_keys(human: &HumanIdentity, grant: &mut DeviceGrant, expected_version: u64, encrypted_keys: vector<u8>, clock: &Clock, ctx: &TxContext) {
        assert_root(human, grant, clock, ctx);
        assert!(grant.version == expected_version, E_INPUT);
        check_backup(&encrypted_keys);
        grant.encrypted_keys = encrypted_keys;
        grant.version = grant.version + 1;
    }

    /// Run first in the recovery PTB, before any organization key rotation.
    /// A backup/directory update after quotation must reject the whole PTB;
    /// otherwise a stale encrypted keyring could replace newer history.
    public fun assert_recovery_snapshot(
        human: &HumanIdentity, record: &RecoveryRecord,
        expected_generation: u64, expected_backup_version: u64,
        expected_organizations: vector<address>, ctx: &TxContext,
    ) {
        assert_recovery_signer(human, record, ctx);
        assert!(human.generation == expected_generation
            && record.backup_version == expected_backup_version, E_INPUT);
        assert!(vector::length(&human.organizations) == vector::length(&expected_organizations), E_INPUT);
        let mut i = 0;
        while (i < vector::length(&expected_organizations)) {
            assert!(object::id_to_address(&human.organizations[i]) == expected_organizations[i], E_INPUT);
            i = i + 1;
        };
    }

    /// One shared Human mutation serializes concurrent recoveries. No loop over
    /// devices: changing the generation invalidates every previous grant.
    public fun recover_identity(
        registry: &mut IdentityRegistry, human: &mut HumanIdentity, old: &mut RecoveryRecord,
        next_signing_key: vector<u8>, next_encryption_key: vector<u8>, next_backup: vector<u8>,
        device: address, device_encryption_key: vector<u8>, encrypted_device_keys: vector<u8>,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        assert_current_recovery(human, old);
        assert!(tx_context::sender(ctx) == old.recovery_address, E_PERMISSION);
        rotate_recovery(registry, human, old, next_signing_key, next_encryption_key, next_backup, ctx);
        event::emit(IdentityRecovered { human_id: object::id(human), old_record: object::id(old), new_record: human.recovery_record, generation: human.generation });
        new_grant(registry, human, device, option::none(), all_actions(),
            clock::timestamp_ms(clock) + 30 * 86400000, device_encryption_key, encrypted_device_keys, ctx);
    }

    public fun replace_recovery_code(
        registry: &mut IdentityRegistry, human: &mut HumanIdentity, grant: &DeviceGrant, old: &mut RecoveryRecord,
        next_signing_key: vector<u8>, next_encryption_key: vector<u8>, next_backup: vector<u8>,
        clock: &Clock, ctx: &mut TxContext,
    ) {
        assert_root(human, grant, clock, ctx);
        assert_current_recovery(human, old);
        // Rotating the code alone must preserve existing device grants.
        let generation = human.generation;
        rotate_recovery(registry, human, old, next_signing_key, next_encryption_key, next_backup, ctx);
        human.generation = generation;
        event::emit(RecoveryCodeReplaced { human_id: object::id(human), old_record: object::id(old), new_record: human.recovery_record, version: human.recovery_version });
    }

    fun rotate_recovery(
        registry: &mut IdentityRegistry, human: &mut HumanIdentity, old: &mut RecoveryRecord,
        signing_key: vector<u8>, encryption_key: vector<u8>, backup: vector<u8>, ctx: &mut TxContext,
    ) {
        assert!(human.registry_id == object::id(registry), E_REGISTRY);
        let next_address = signing_address(&signing_key);
        assert!(!table::contains(&registry.recoveries, next_address), E_RECOVERY_USED);
        assert!(!table::contains(&registry.devices, next_address), E_INPUT);
        check_encryption_key(&encryption_key);
        check_backup(&backup);
        old.active = false;
        human.generation = human.generation + 1;
        human.recovery_version = human.recovery_version + 1;
        human.recovery_address = next_address;
        let record = new_recovery_record(human, signing_key, encryption_key, backup, ctx);
        human.recovery_record = object::id(&record);
        table::add(&mut registry.recoveries, next_address, RecoveryLocation {
            human_id: object::id(human), record_id: object::id(&record), version: human.recovery_version,
        });
        transfer::share_object(record);
    }

    fun new_recovery_record(human: &HumanIdentity, signing_key: vector<u8>, encryption_key: vector<u8>, backup: vector<u8>, ctx: &mut TxContext): RecoveryRecord {
        RecoveryRecord {
            id: object::new(ctx), human_id: object::id(human), registry_id: human.registry_id,
            format_version: 1, network: human.network, version: human.recovery_version,
            active: true, recovery_address: human.recovery_address,
            signing_public_key: signing_key, encryption_public_key: encryption_key,
            encrypted_backup: backup, backup_version: 1,
        }
    }

    fun new_grant(
        registry: &mut IdentityRegistry, human: &mut HumanIdentity, device: address, scope: Option<ID>,
        actions: vector<u8>, expires_at_ms: u64, encryption_key: vector<u8>, encrypted_keys: vector<u8>, ctx: &mut TxContext,
    ): ID {
        assert!(human.registry_id == object::id(registry) && device != @0x0, E_REGISTRY);
        assert!(!table::contains(&registry.recoveries, device), E_INPUT);
        check_encryption_key(&encryption_key);
        check_backup(&encrypted_keys);
        let grant = DeviceGrant {
            id: object::new(ctx), human_id: object::id(human), device, org_scope: scope, actions,
            expires_at_ms, revoked: false, version: 1, generation: human.generation,
            encryption_public_key: encryption_key, encrypted_keys,
        };
        let grant_id = object::id(&grant);
        vector::push_back(&mut human.grants, grant_id);
        if (!table::contains(&registry.devices, device)) table::add(&mut registry.devices, device, vector[]);
        vector::push_back(table::borrow_mut(&mut registry.devices, device), grant_id);
        event::emit(DeviceGranted { human_id: object::id(human), grant_id, device, generation: human.generation });
        transfer::share_object(grant);
        grant_id
    }

    public fun create_organization(
        registry: &mut ProtocolRegistry, human: &mut HumanIdentity, grant: &DeviceGrant,
        name: String, description: String, clock: &Clock, ctx: &mut TxContext,
    ) {
        assert_root(human, grant, clock, ctx);
        let (org, cap) = organization::new_organization(registry, name, description, human_address(human), ctx);
        attach_org(human, &org, cap);
        organization::share_organization(org);
    }

    public fun migrate_organization(human: &mut HumanIdentity, grant: &DeviceGrant, org: &mut Organization, cap: OrgAdminCap, clock: &Clock, ctx: &TxContext) {
        assert_root(human, grant, clock, ctx);
        organization::bind_human_admin(&cap, org, human_address(human), ctx);
        attach_org(human, org, cap);
    }

    public fun update_organization_description(human: &HumanIdentity, grant: &DeviceGrant, org: &mut Organization, description: String, clock: &Clock, ctx: &TxContext) {
        assert_can(human, grant, org, APPROVE, clock, ctx);
        organization::update_description(admin_cap(human, object::id(org)), org, description);
    }

    fun attach_org(human: &mut HumanIdentity, org: &Organization, cap: OrgAdminCap) {
        let org_id = object::id(org);
        let human_id = object::id(human);
        table::add(&mut human.admin_caps, org_id, cap);
        table::add(&mut human.roles, org_id, OrgRole { owner_human: human_id, admin: true, active: true, version: 1 });
        vector::push_back(&mut human.organizations, org_id);
        event::emit(OrganizationBound { human_id: object::id(human), org_id });
    }

    public fun set_member(
        owner: &HumanIdentity, grant: &DeviceGrant, org: &Organization, member: &mut HumanIdentity,
        active: bool, clock: &Clock, ctx: &TxContext,
    ) {
        assert_can(owner, grant, org, APPROVE, clock, ctx);
        assert!(organization::admin(org) == human_address(owner), E_PERMISSION);
        assert!(object::id(owner) != object::id(member), E_INPUT);
        let org_id = object::id(org);
        if (table::contains(&member.roles, org_id)) {
            let role = table::borrow_mut(&mut member.roles, org_id);
            role.owner_human = object::id(owner);
            role.admin = false;
            role.active = active;
            role.version = role.version + 1;
        } else {
            table::add(&mut member.roles, org_id, OrgRole { owner_human: object::id(owner), admin: false, active, version: 1 });
            vector::push_back(&mut member.organizations, org_id);
        };
    }

    public fun assert_can(human: &HumanIdentity, grant: &DeviceGrant, org: &Organization, action: u8, clock: &Clock, ctx: &TxContext) {
        assert_can_for_device(human, grant, org, action, clock, tx_context::sender(ctx));
    }

    // Checking a recorded issuer does not authorize the current transaction.
    // Used only by invitations/authority bindings with a pinned issuer device.
    public fun assert_can_for_device(human: &HumanIdentity, grant: &DeviceGrant, org: &Organization, action: u8, clock: &Clock, device: address) {
        assert_grant_for_device(human, grant, action, clock, device);
        let org_id = object::id(org);
        assert!(organization::is_active(org), E_PERMISSION);
        if (option::is_some(&grant.org_scope)) assert!(*option::borrow(&grant.org_scope) == org_id, E_SCOPE);
        assert!(table::contains(&human.roles, org_id), E_PERMISSION);
        let role = table::borrow(&human.roles, org_id);
        assert!(role.active && organization::admin(org) == object::id_to_address(&role.owner_human), E_PERMISSION);
        if (action == APPROVE || action == MANAGE_HOSTS) assert!(role.admin, E_PERMISSION);
    }

    public fun assert_grant(human: &HumanIdentity, grant: &DeviceGrant, action: u8, clock: &Clock, ctx: &TxContext) {
        assert_grant_for_device(human, grant, action, clock, tx_context::sender(ctx));
    }
    fun assert_grant_for_device(human: &HumanIdentity, grant: &DeviceGrant, action: u8, clock: &Clock, device: address) {
        assert!(grant.human_id == object::id(human) && grant.device == device, E_PERMISSION);
        assert!(!grant.revoked && grant.generation == human.generation, E_REVOKED);
        assert!(clock::timestamp_ms(clock) < grant.expires_at_ms, E_EXPIRED);
        assert!(vector::contains(&grant.actions, &action), E_PERMISSION);
    }

    fun assert_root(human: &HumanIdentity, grant: &DeviceGrant, clock: &Clock, ctx: &TxContext) {
        assert_grant(human, grant, APPROVE, clock, ctx);
        assert!(option::is_none(&grant.org_scope), E_SCOPE);
    }

    fun assert_current_recovery(human: &HumanIdentity, record: &RecoveryRecord) {
        assert!(record.active && record.human_id == object::id(human)
            && record.registry_id == human.registry_id && record.version == human.recovery_version
            && object::id(record) == human.recovery_record, E_RECOVERY_USED);
    }
    public fun assert_recovery_signer(human: &HumanIdentity, record: &RecoveryRecord, ctx: &TxContext) {
        assert_current_recovery(human, record);
        assert!(tx_context::sender(ctx) == record.recovery_address, E_PERMISSION);
    }
    fun check_network(network: &String) {
        assert!(*network == string::utf8(b"localnet") || *network == string::utf8(b"devnet")
            || *network == string::utf8(b"testnet") || *network == string::utf8(b"mainnet"), E_INPUT);
    }
    fun check_encryption_key(key: &vector<u8>) { assert!(vector::length(key) == 32, E_INPUT); }
    fun check_backup(backup: &vector<u8>) { assert!(vector::length(backup) <= MAX_BACKUP, E_INPUT); }
    fun check_expiry(expires: u64, clock: &Clock) {
        let now = clock::timestamp_ms(clock);
        assert!(expires > now && expires - now <= MAX_TTL, E_EXPIRED);
    }
    fun check_actions(actions: &vector<u8>) {
        assert!(vector::length(actions) > 0 && vector::length(actions) <= 4, E_INPUT);
        let mut i = 0;
        while (i < vector::length(actions)) {
            let action = actions[i];
            assert!(action >= READ && action <= MANAGE_HOSTS, E_INPUT);
            let mut j = 0;
            while (j < i) { assert!(actions[j] != action, E_INPUT); j = j + 1; };
            i = i + 1;
        };
    }
    public fun signing_address(public_key: &vector<u8>): address {
        assert!(vector::length(public_key) == 32, E_INPUT);
        let mut bytes = vector[0u8];
        vector::append(&mut bytes, *public_key);
        address::from_bytes(hash::blake2b256(&bytes))
    }
    fun all_actions(): vector<u8> { vector[READ, OPERATE, APPROVE, MANAGE_HOSTS] }

    // Package-only cap access requires the caller to enforce a specific action.
    public(package) fun admin_cap(human: &HumanIdentity, org_id: ID): &OrgAdminCap { table::borrow(&human.admin_caps, org_id) }
    public fun human_address(human: &HumanIdentity): address { object::id_to_address(&object::id(human)) }
    public fun generation(human: &HumanIdentity): u64 { human.generation }
    public fun organizations(human: &HumanIdentity): vector<ID> { human.organizations }
    public fun grants(human: &HumanIdentity): vector<ID> { human.grants }
    public fun recovery_record(human: &HumanIdentity): ID { human.recovery_record }
    public fun recovery_location(registry: &IdentityRegistry, recovery_address: address): RecoveryLocation { *table::borrow(&registry.recoveries, recovery_address) }
    public fun device_address(grant: &DeviceGrant): address { grant.device }
    public fun grant_version(grant: &DeviceGrant): u64 { grant.version }
    public fun grant_expiry(grant: &DeviceGrant): u64 { grant.expires_at_ms }
    public fun grant_actions(grant: &DeviceGrant): vector<u8> { grant.actions }
    public fun grant_scope(grant: &DeviceGrant): Option<ID> { grant.org_scope }
    public fun read_action(): u8 { READ }
    public fun operate_action(): u8 { OPERATE }
    public fun approve_action(): u8 { APPROVE }
    public fun manage_hosts_action(): u8 { MANAGE_HOSTS }
    public fun bound_registry(protocol: &ProtocolRegistry): ID { *df::borrow(organization::registry_uid(protocol), RegistryBinding {}) }
}
