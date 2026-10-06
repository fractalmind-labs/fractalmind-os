/// BENCHMARK ONLY. Copied into an isolated zero-address localnet package by
/// prepare-localnet-package.py. Never part of the deployed protocol package.
/// Compare a mutable dynamic-field body with indexed immutable revisions.
module fractalmind_protocol::storage_candidate {
    use sui::object::{Self, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use std::string::String;
    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    public struct InlineKey has copy, drop, store { kind: u8, logical_id: String }
    public struct InlineBody has store, drop {
        revision: u64, key_version: u64, created_at_ms: u64,
        writer_human: ID, writer_device: address, encrypted_body: vector<u8>,
    }
    public fun save_inline(
        org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        kind: u8, logical_id: String, expected_revision: u64, key_version: u64,
        encrypted_body: vector<u8>, clock: &Clock, ctx: &TxContext,
    ) {
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        let key = InlineKey { kind, logical_id };
        let next = InlineBody { revision: expected_revision + 1, key_version, created_at_ms: clock::timestamp_ms(clock), writer_human: object::id(human), writer_device: tx_context::sender(ctx), encrypted_body };
        if (df::exists_(organization::borrow_uid(org), key)) {
            let old: &mut InlineBody = df::borrow_mut(organization::borrow_uid_mut(org), key);
            assert!(old.revision == expected_revision, 9102);
            *old = next;
        } else {
            assert!(expected_revision == 0, 9102);
            df::add(organization::borrow_uid_mut(org), key, next);
        };
    }
}
