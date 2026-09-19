#[test_only]
module fractalmind_protocol::remote_authority_tests {
    use std::option;
    use std::string;
    use sui::test_scenario::{Self as ts};

    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::remote_authority::{Self as authority, RemoteCapability};

    const ADMIN: address = @0xA;
    const DELEGATE: address = @0xB;
    const CHILD_DELEGATE: address = @0xC;

    fun setup_org(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        let mut registry = organization::create_test_registry(ts::ctx(scenario));
        organization::create_organization(
            &mut registry,
            string::utf8(b"AuthorityOrg"),
            string::utf8(b"remote authority tests"),
            ts::ctx(scenario),
        );
        organization::destroy_test_registry(registry);
    }

    fun create_root(
        scenario: &mut ts::Scenario,
        target_kind: u8,
        node_id: vector<u8>,
        agent_id: vector<u8>,
        max_uses: u64,
        budget_asset: vector<u8>,
        max_budget: u64,
        expires_at_ms: u64,
    ): ID {
        ts::next_tx(scenario, ADMIN);
        let org = ts::take_shared<Organization>(scenario);
        authority::create_capability(
            &org,
            DELEGATE,
            target_kind,
            string::utf8(node_id),
            string::utf8(agent_id),
            vector[string::utf8(b"deploy"), string::utf8(b"status")],
            string::utf8(b"lifecycle"),
            max_uses,
            string::utf8(budget_asset),
            max_budget,
            expires_at_ms,
            ts::ctx(scenario),
        );
        ts::return_shared(org);
        ts::next_tx(scenario, ADMIN);
        option::destroy_some(ts::most_recent_id_shared<RemoteCapability>())
    }

    fun hash(byte: u8): vector<u8> {
        vector[
            byte, byte, byte, byte, byte, byte, byte, byte,
            byte, byte, byte, byte, byte, byte, byte, byte,
            byte, byte, byte, byte, byte, byte, byte, byte,
            byte, byte, byte, byte, byte, byte, byte, byte,
        ]
    }

    #[test]
    fun test_create_and_claim_authority_use() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            2,
            b"MIST",
            100,
            1_000,
        );

        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"deploy"),
            string::utf8(b"lifecycle"),
            authority::target_agent(),
            string::utf8(b"node-1"),
            string::utf8(b"agent-1"),
            string::utf8(b"cmd-1"),
            string::utf8(b"nonce-1"),
            string::utf8(b"idem-1"),
            string::utf8(b"MIST"),
            40,
            hash(1),
            ts::ctx(&mut scenario),
        );
        assert!(authority::uses_claimed(&capability) == 1, 0);
        assert!(authority::budget_claimed(&capability) == 40, 1);
        assert!(authority::has_authority_claim(&capability, hash(1)), 2);
        assert!(authority::authority_claim_matches(
            &capability,
            &string::utf8(b"deploy"),
            &string::utf8(b"lifecycle"),
            authority::target_agent(),
            &string::utf8(b"node-1"),
            &string::utf8(b"agent-1"),
            &string::utf8(b"cmd-1"),
            &string::utf8(b"nonce-1"),
            &string::utf8(b"idem-1"),
            &string::utf8(b"MIST"),
            40,
            &hash(1),
        ), 6);
        let reference = authority::reference(&capability);
        assert!(authority::reference_id(&reference) == capability_id, 3);
        assert!(authority::reference_revocation_version(&reference) == 1, 4);
        assert!(authority::reference_reservation_scope(&reference) == authority::reservation_authority(), 5);
        ts::return_shared(capability);
        ts::end(scenario);
    }

    #[test]
    fun test_delegate_node_subset_and_validate_parent_checkpoint() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let root_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            4,
            b"MIST",
            100,
            1_000,
        );

        ts::next_tx(&mut scenario, ADMIN);
        let org = ts::take_shared<Organization>(&scenario);
        let mut root = ts::take_shared_by_id<RemoteCapability>(&scenario, root_id);
        let child_id = authority::delegate_capability(
            &mut root,
            &org,
            CHILD_DELEGATE,
            authority::target_agent(),
            string::utf8(b"node-1"),
            string::utf8(b"agent-1"),
            vector[string::utf8(b"status")],
            string::utf8(b"lifecycle"),
            2,
            string::utf8(b"MIST"),
            30,
            900,
            ts::ctx(&mut scenario),
        );
        assert!(authority::uses_delegated(&root) == 2, 0);
        assert!(authority::budget_delegated(&root) == 30, 1);
        ts::return_shared(root);
        ts::return_shared(org);
        ts::next_tx(&mut scenario, CHILD_DELEGATE);
        let parent = ts::take_shared_by_id<RemoteCapability>(&scenario, root_id);
        let child = ts::take_shared_by_id<RemoteCapability>(&scenario, child_id);
        authority::assert_delegated_authorized(
            &parent,
            &child,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_agent(),
            &string::utf8(b"node-1"),
            &string::utf8(b"agent-1"),
            ts::ctx(&mut scenario),
        );
        assert!(authority::parent_id(&child) == option::some(root_id), 2);
        assert!(authority::reservation_scope(&child) == authority::reservation_node(), 3);
        ts::return_shared(child);
        ts::return_shared(parent);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 8303, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_target_mismatch() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_node(),
            b"node-1",
            b"",
            1,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::assert_authorized(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_node(),
            &string::utf8(b"node-2"),
            &string::utf8(b""),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8304, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_scope_mismatch() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_node(),
            b"node-1",
            b"",
            1,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::assert_authorized(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"view"),
            authority::target_node(),
            &string::utf8(b"node-1"),
            &string::utf8(b""),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8307, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_expired_capability() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_node(),
            b"node-1",
            b"",
            1,
            b"",
            0,
            10,
        );
        ts::later_epoch(&mut scenario, 11, DELEGATE);
        let capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::assert_authorized(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_node(),
            &string::utf8(b"node-1"),
            &string::utf8(b""),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8308, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_max_use_exhaustion() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            1,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-2"),
            string::utf8(b"nonce-2"),
            string::utf8(b"idem-2"),
            string::utf8(b""),
            0,
            hash(2),
            ts::ctx(&mut scenario),
        );
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-3"),
            string::utf8(b"nonce-3"),
            string::utf8(b"idem-3"),
            string::utf8(b""),
            0,
            hash(3),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8306, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_revoked_capability() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_node(),
            b"node-1",
            b"",
            1,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, ADMIN);
        let org = ts::take_shared<Organization>(&scenario);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::revoke_capability(&mut capability, &org, ts::ctx(&mut scenario));
        ts::return_shared(capability);
        ts::return_shared(org);
        ts::next_tx(&mut scenario, DELEGATE);
        let capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::assert_authorized(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_node(),
            &string::utf8(b"node-1"),
            &string::utf8(b""),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8311, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_conflicting_authority_claim() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            2,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-4"),
            string::utf8(b"nonce-4"),
            string::utf8(b"idem-4"),
            string::utf8(b""),
            0,
            hash(4),
            ts::ctx(&mut scenario),
        );
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-4"),
            string::utf8(b"nonce-5"),
            string::utf8(b"idem-5"),
            string::utf8(b""),
            0,
            hash(5),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    fun test_exact_authority_claim_retry_is_idempotent() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            1,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-retry"),
            string::utf8(b"nonce-retry"),
            string::utf8(b"idem-retry"),
            string::utf8(b""),
            0,
            hash(6),
            ts::ctx(&mut scenario),
        );
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-retry"),
            string::utf8(b"nonce-retry"),
            string::utf8(b"idem-retry"),
            string::utf8(b""),
            0,
            hash(6),
            ts::ctx(&mut scenario),
        );
        assert!(authority::uses_claimed(&capability) == 1, 0);
        ts::return_shared(capability);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 8318, location = fractalmind_protocol::remote_authority)]
    fun test_exact_fingerprint_rejects_budget_mismatch() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            2,
            b"MIST",
            100,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"deploy"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-budget"),
            string::utf8(b"nonce-budget"),
            string::utf8(b"idem-budget"),
            string::utf8(b"MIST"),
            40,
            hash(11),
            ts::ctx(&mut scenario),
        );
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"deploy"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-budget"),
            string::utf8(b"nonce-budget"),
            string::utf8(b"idem-budget"),
            string::utf8(b""),
            0,
            hash(11),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8317, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_idempotency_key_conflict() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            2,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-idem-1"),
            string::utf8(b"nonce-idem-1"),
            string::utf8(b"idem-shared"),
            string::utf8(b""),
            0,
            hash(7),
            ts::ctx(&mut scenario),
        );
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-idem-2"),
            string::utf8(b"nonce-idem-2"),
            string::utf8(b"idem-shared"),
            string::utf8(b""),
            0,
            hash(8),
            ts::ctx(&mut scenario),
        );
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8311, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_nonce_replay() {
        let mut scenario = ts::begin(ADMIN);
        setup_org(&mut scenario);
        let capability_id = create_root(
            &mut scenario,
            authority::target_organization(),
            b"",
            b"",
            2,
            b"",
            0,
            1_000,
        );
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-nonce-1"),
            string::utf8(b"nonce-shared"),
            string::utf8(b"idem-nonce-1"),
            string::utf8(b""),
            0,
            hash(9),
            ts::ctx(&mut scenario),
        );
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        authority::claim_authority_use(
            &mut capability,
            string::utf8(b"status"),
            string::utf8(b"lifecycle"),
            authority::target_node(),
            string::utf8(b"node-1"),
            string::utf8(b""),
            string::utf8(b"cmd-nonce-2"),
            string::utf8(b"nonce-shared"),
            string::utf8(b"idem-nonce-2"),
            string::utf8(b""),
            0,
            hash(10),
            ts::ctx(&mut scenario),
        );
        abort 0
    }
}
