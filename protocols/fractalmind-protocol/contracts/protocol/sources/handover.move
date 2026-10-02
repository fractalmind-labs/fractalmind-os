/// Consume the exact Host acceptance in the same transaction as control and
/// OKR approval. This transaction does not dispatch or continue execution.
module fractalmind_protocol::handover {
    use std::string::{Self, String};
    use std::bcs;
    use std::hash;
    use sui::object::{Self, ID, UID};
    use sui::clock::{Self, Clock};
    use sui::tx_context::TxContext;
    use sui::dynamic_field as df;
    use sui::ed25519;
    use sui::transfer;
    use sui::event;
    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::node_execution::{Self, CommandExecution};
    use fractalmind_protocol::remote_authority::{Self as ra, RemoteCapability};
    use fractalmind_protocol::okr::{Self, Okr};

    const E_INPUT: u64 = 9501;
    const E_STALE: u64 = 9502;
    const E_VERSION: u64 = 9503;
    const E_PROOF: u64 = 9504;
    const E_USED: u64 = 9505;
    const E_SCOPE: u64 = 9506;

    public struct Proposal has copy, drop, store {
        version: u8, managed: ID, okr: ID, managed_version: u64,
        okr_version: u64, spec_revision: u64, workspace: vector<u8>, boundary: vector<u8>,
        asset: String, limit: u64, max_calls: u64, expires: u64,
        review_expires: u64, nonce: vector<u8>,
    }
    public struct Acceptance has copy, drop, store {
        version: u8, execution: ID, organization: ID, human: ID, grant: ID,
        membership: ID, binding: ID, host: address, instance: String,
        proposal_hash: vector<u8>, coverage_revision: u64, observed_at: u64,
    }
    public struct UsedReviewKey has copy, drop, store { execution: ID }
    public struct Approval has key {
        id: UID, org_id: ID, okr_id: ID, managed_agent_id: ID, review_execution_id: ID,
        review_result_id: ID, human_id: ID, grant_id: ID, host_address: address,
        proposal: Proposal, coverage_revision: u64, observed_at_ms: u64, approved_at_ms: u64,
        host_signature: vector<u8>, managed_version: u64, agreement_version: u64,
    }
    public struct Approved has copy, drop {
        approval_id: ID, org_id: ID, okr_id: ID, managed_agent_id: ID, review_execution_id: ID,
        managed_version: u64, agreement_version: u64,
    }
    public fun proposal(
        managed: ID, okr: ID, managed_version: u64, okr_version: u64, spec_revision: u64,
        workspace: vector<u8>, boundary: vector<u8>, asset: String, limit: u64, max_calls: u64,
        expires: u64, review_expires: u64, nonce: vector<u8>,
    ): Proposal {
        assert!(managed_version > 0 && okr_version > 0 && spec_revision > 0
            && vector::length(&workspace) == 32 && vector::length(&boundary) == 32 && vector::length(&nonce) == 32
            && asset == string::utf8(b"TOOL_CALLS") && limit > 0 && max_calls > 0 && max_calls <= 1000 && max_calls <= limit
            && review_expires > 0 && review_expires <= expires && expires <= 9007199254740991, E_INPUT);
        Proposal { version: 1, managed, okr, managed_version, okr_version, spec_revision,
            workspace, boundary, asset, limit, max_calls, expires, review_expires, nonce }
    }
    public fun proposal_hash(p: &Proposal): vector<u8> {
        let mut bytes = b"fractalmind.handover-proposal.v1";
        vector::append(&mut bytes, bcs::to_bytes(p)); hash::sha2_256(bytes)
    }
    public fun acceptance(
        execution: ID, organization: ID, human: ID, grant: ID, membership: ID,
        binding: ID, host: address, instance: String, proposal_hash: vector<u8>,
        coverage_revision: u64, observed_at: u64,
    ): Acceptance {
        assert!(coverage_revision > 0 && observed_at > 0 && observed_at <= 9007199254740991
            && vector::length(&proposal_hash) == 32, E_INPUT);
        Acceptance { version: 1, execution, organization, human, grant, membership, binding,
            host, instance, proposal_hash, coverage_revision, observed_at }
    }
    public fun acceptance_bytes(a: &Acceptance): vector<u8> {
        let mut bytes = b"fractalmind.handover-acceptance.v1";
        vector::append(&mut bytes, bcs::to_bytes(a)); bytes
    }
    public fun confirm_okr(
        okr: &mut Okr, org: &mut Organization, human: &HumanIdentity, grant: &DeviceGrant,
        member: &HostMembership, binding: &CoordinatorBinding, managed: &mut ManagedAgent,
        review: &CommandExecution, cap: &RemoteCapability,
        expected_managed_version: u64, expected_okr_version: u64, expected_spec_revision: u64,
        workspace: vector<u8>, boundary: vector<u8>, asset: String, limit: u64, max_calls: u64,
        expires: u64, review_expires: u64, nonce: vector<u8>,
        coverage_revision: u64, observed_at: u64, host_signature: vector<u8>,
        expected_record_revision: u64, key_version: u64, encrypted_agreement: vector<u8>,
        clock: &Clock, ctx: &mut TxContext,
    ): ID {
        // Require current device rights, never those cached in a Host proof.
        identity::assert_can(human, grant, org, identity::read_action(), clock, ctx);
        identity::assert_can(human, grant, org, identity::operate_action(), clock, ctx);
        identity::assert_can(human, grant, org, identity::approve_action(), clock, ctx);
        identity::assert_can(human, grant, org, identity::manage_hosts_action(), clock, ctx);
        host::assert_agent_authority(org, human, grant, member, binding, managed, cap, clock);
        assert!(!ra::revoked(cap) && clock::timestamp_ms(clock) < ra::expires_at_ms(cap), E_STALE);
        assert!(okr::organization_id(okr) == object::id(org) && host::managed_runtime(managed) == string::utf8(b"bounded-process-v1"), E_SCOPE);
        assert!(host::managed_version(managed) == expected_managed_version && okr::version(okr) == expected_okr_version
            && okr::spec_revision(okr) == expected_spec_revision, E_VERSION);
        host::assert_agent_execution_idle(org, object::id(managed));
        assert!(coverage_revision < 18446744073709551615
            && host::agent_execution_revision(org, object::id(managed)) == coverage_revision + 1, E_VERSION);
        let p = proposal(object::id(managed), object::id(okr), expected_managed_version, expected_okr_version,
            expected_spec_revision, workspace, boundary, asset, limit, max_calls, expires, review_expires, nonce);
        let now = clock::timestamp_ms(clock);
        assert!(observed_at <= now && now < review_expires && observed_at < review_expires
            && review_expires - observed_at <= 60000 && expires <= okr::deadline_ms(okr)
            && expires <= identity::grant_expiry(grant), E_STALE);
        node_execution::assert_handover_review(review, org, human, grant, member, managed, cap, observed_at);
        let key = UsedReviewKey { execution: object::id(review) };
        assert!(!df::exists_(organization::borrow_uid(org), key), E_USED);
        let hashed = proposal_hash(&p);
        let a = acceptance(object::id(review), object::id(org), object::id(human), object::id(grant),
            object::id(member), object::id(binding), host::membership_host_address(member), host::managed_instance(managed),
            hashed, coverage_revision, observed_at);
        assert!(ed25519::ed25519_verify(&host_signature, &host::membership_public_key(member), &acceptance_bytes(&a)), E_PROOF);
        host::confirm_reviewed_control(org, human, grant, member, binding, managed, expected_managed_version, workspace, clock, ctx);
        okr::activate_reviewed(okr, org, human, grant, member, binding, managed, expected_okr_version,
            workspace, boundary, asset, limit, expires, expected_record_revision, key_version, encrypted_agreement, clock, ctx);
        let record = Approval {
            id: object::new(ctx), org_id: object::id(org), okr_id: object::id(okr), managed_agent_id: object::id(managed),
            review_execution_id: object::id(review), review_result_id: *std::option::borrow(&node_execution::result_record(review)),
            human_id: object::id(human), grant_id: object::id(grant), host_address: host::membership_host_address(member),
            proposal: p, coverage_revision, observed_at_ms: observed_at, approved_at_ms: now, host_signature,
            managed_version: host::managed_version(managed), agreement_version: okr::agreement_version(okr),
        };
        let id = object::id(&record);
        df::add(organization::borrow_uid_mut(org), key, id);
        okr::record_handover_policy(okr, max_calls, nonce, hashed, id);
        event::emit(Approved { approval_id: id, org_id: object::id(org), okr_id: object::id(okr),
            managed_agent_id: object::id(managed), review_execution_id: object::id(review),
            managed_version: host::managed_version(managed), agreement_version: okr::agreement_version(okr) });
        transfer::share_object(record); id
    }
}
