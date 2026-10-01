/// Persistent encrypted product bodies. Business status and authorization
/// remain in their dedicated contracts; a saved body alone grants no action.
/// Organization-local index + immutable revisions allow cache-free rebuilding.
module fractalmind_protocol::product_record {
    use sui::object::{Self, ID, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use sui::dynamic_field as df;
    use sui::table::{Self, Table};
    use sui::event;
    use std::string::{Self, String};
    use std::option::{Self, Option};
    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant, RecoveryRecord};

    const E_INPUT: u64 = 9101;
    const E_VERSION: u64 = 9102;
    const MAX_BODY: u64 = 65536;
    // Fixed v0.2.0 kinds: OKR, contract, approval, evidence, checkpoint,
    // direct message, key backup. No generic Memory/storage platform API.
    public struct IndexBinding has copy, drop, store {}
    public struct RecordKey has copy, drop, store { kind: u8, logical_id: String }
    public struct RecordPointer has copy, drop, store { record_id: ID, revision: u64, key_version: u64 }
    public struct RecordIndex has store { key_version: u64, records: Table<RecordKey, RecordPointer> }
    public struct EncryptedRecord has key {
        id: UID,
        organization_id: ID,
        kind: u8,
        logical_id: String,
        revision: u64,
        key_version: u64,
        previous: Option<ID>,
        writer_human: ID,
        writer_device: address,
        grant_id: ID,
        grant_version: u64,
        created_at_ms: u64,
        // FME1 org key / FME2 command result key: AES-256-GCM encrypted bytes.
        encrypted_body: vector<u8>,
    }
    public struct RecordSaved has copy, drop {
        organization_id: ID, kind: u8, logical_id: String, record_id: ID,
        revision: u64, key_version: u64, created_at_ms: u64,
    }

    public fun save(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        kind: u8, logical_id: String, expected_revision: u64, key_version: u64,
        encrypted_body: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        // Only authorized administrators can directly author canonical bodies.
        // Runtime evidence/messages will use action-specific package writers.
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        save_authorized(org, object::id(human), object::id(grant), identity::grant_version(grant),
            kind, logical_id, expected_revision, key_version, encrypted_body, clock, ctx);
    }

    public(package) fun save_authorized(
        org: &mut Organization, human_id: ID, grant_id: ID, grant_version: u64,
        kind: u8, logical_id: String, expected_revision: u64, key_version: u64,
        encrypted_body: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ): ID {
        assert!(kind >= 1 && kind <= 7 && key_version > 0, E_INPUT);
        assert!(string::length(&logical_id) > 0 && string::length(&logical_id) <= 128, E_INPUT);
        let size = vector::length(&encrypted_body);
        assert!(size >= 32 && size <= MAX_BODY, E_INPUT);
        assert!(encrypted_body[0] == 70 && encrypted_body[1] == 77 && encrypted_body[2] == 69
            && (encrypted_body[3] == 49 || (kind == 5 && encrypted_body[3] == 50)), E_INPUT);
        let organization_id = object::id(org);
        if (!df::exists_(organization::borrow_uid(org), IndexBinding {})) {
            df::add(organization::borrow_uid_mut(org), IndexBinding {}, RecordIndex { key_version: 1, records: table::new(ctx) });
        };
        let index: &mut RecordIndex = df::borrow_mut(organization::borrow_uid_mut(org), IndexBinding {});
        assert!(key_version == index.key_version, E_VERSION);
        let key = RecordKey { kind, logical_id };
        let mut previous = option::none();
        if (table::contains(&index.records, key)) {
            let pointer = table::borrow(&index.records, key);
            assert!(pointer.revision == expected_revision && key_version >= pointer.key_version, E_VERSION);
            previous = option::some(pointer.record_id);
        } else assert!(expected_revision == 0, E_VERSION);
        let revision = expected_revision + 1;
        let created_at_ms = clock::timestamp_ms(clock);
        let record = EncryptedRecord {
            id: object::new(ctx), organization_id, kind, logical_id, revision,
            key_version, previous, writer_human: human_id, writer_device: tx_context::sender(ctx),
            grant_id, grant_version, created_at_ms, encrypted_body,
        };
        let record_id = object::id(&record);
        if (table::contains(&index.records, key)) {
            *table::borrow_mut(&mut index.records, key) = RecordPointer { record_id, revision, key_version };
        } else table::add(&mut index.records, key, RecordPointer { record_id, revision, key_version });
        event::emit(RecordSaved { organization_id, kind, logical_id, record_id, revision, key_version, created_at_ms });
        transfer::freeze_object(record);
        record_id
    }

    public fun current(org: &Organization, kind: u8, logical_id: String): RecordPointer {
        let index: &RecordIndex = df::borrow(organization::borrow_uid(org), IndexBinding {});
        *table::borrow(&index.records, RecordKey { kind, logical_id })
    }
    public fun key_version(org: &Organization): u64 {
        if (!df::exists_(organization::borrow_uid(org), IndexBinding {})) return 1;
        let index: &RecordIndex = df::borrow(organization::borrow_uid(org), IndexBinding {});
        index.key_version
    }
    /// Include with revocation and key-envelope updates in the same PTB.
    /// All later record writes must use the new key generation.
    public fun rotate_key(org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant, expected_key_version: u64, clock: &Clock, ctx: &mut TxContext) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        rotate_authorized(org, expected_key_version, ctx);
    }
    /// Call before recover_identity within the same PTB. Owned organizations
    /// rotate without any surviving device. Other owners must rotate member
    /// organizations using their own grants; recovery cannot escalate roles.
    public fun rotate_key_for_recovery(org: &mut Organization, human: &HumanIdentity, record: &RecoveryRecord, expected_key_version: u64, ctx: &mut TxContext) {
        identity::assert_recovery_signer(human, record, ctx);
        assert!(organization::is_active(org) && organization::admin(org) == identity::human_address(human), E_INPUT);
        rotate_authorized(org, expected_key_version, ctx);
    }
    fun rotate_authorized(org: &mut Organization, expected_key_version: u64, ctx: &mut TxContext) {
        if (!df::exists_(organization::borrow_uid(org), IndexBinding {})) {
            df::add(organization::borrow_uid_mut(org), IndexBinding {}, RecordIndex { key_version: 1, records: table::new(ctx) });
        };
        let index: &mut RecordIndex = df::borrow_mut(organization::borrow_uid_mut(org), IndexBinding {});
        assert!(index.key_version == expected_key_version, E_VERSION);
        index.key_version = index.key_version + 1;
    }
    public fun record_organization(record: &EncryptedRecord): ID { record.organization_id }
    public fun record_revision(record: &EncryptedRecord): u64 { record.revision }
    public fun record_body(record: &EncryptedRecord): vector<u8> { record.encrypted_body }
}
