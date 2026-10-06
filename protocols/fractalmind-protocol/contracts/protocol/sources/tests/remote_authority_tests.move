#[test_only]
module fractalmind_protocol::remote_authority_tests {
    use sui::clock::{Self, Clock};
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
        let mut fm_clock = ts::take_shared<Clock>(scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(scenario).epoch_timestamp_ms());
        authority::create_capability_with_clock(
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
            &fm_clock,
            ts::ctx(scenario),
        );
        ts::return_shared(fm_clock);
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
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
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
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        let child_id = authority::delegate_capability_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        assert!(authority::uses_delegated(&root) == 2, 0);
        assert!(authority::budget_delegated(&root) == 30, 1);
        ts::return_shared(root);
        ts::return_shared(org);
        ts::next_tx(&mut scenario, CHILD_DELEGATE);
        let parent = ts::take_shared_by_id<RemoteCapability>(&scenario, root_id);
        let child = ts::take_shared_by_id<RemoteCapability>(&scenario, child_id);
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::assert_delegated_authorized_with_clock(
            &parent,
            &child,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_agent(),
            &string::utf8(b"node-1"),
            &string::utf8(b"agent-1"),
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
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
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::assert_authorized_with_clock(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_node(),
            &string::utf8(b"node-2"),
            &string::utf8(b""),
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8304, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_scope_mismatch() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::assert_authorized_with_clock(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"view"),
            authority::target_node(),
            &string::utf8(b"node-1"),
            &string::utf8(b""),
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8307, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_expired_capability() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::assert_authorized_with_clock(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_node(),
            &string::utf8(b"node-1"),
            &string::utf8(b""),
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8308, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_max_use_exhaustion() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8306, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_revoked_capability() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::assert_authorized_with_clock(
            &capability,
            &string::utf8(b"status"),
            &string::utf8(b"lifecycle"),
            authority::target_node(),
            &string::utf8(b"node-1"),
            &string::utf8(b""),
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8311, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_conflicting_authority_claim() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    fun test_exact_authority_claim_retry_is_idempotent() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        assert!(authority::uses_claimed(&capability) == 1, 0);
        ts::return_shared(capability);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 8318, location = fractalmind_protocol::remote_authority)]
    fun test_exact_fingerprint_rejects_budget_mismatch() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8317, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_idempotency_key_conflict() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    #[test]
    #[expected_failure(abort_code = 8311, location = fractalmind_protocol::remote_authority)]
    fun test_rejects_nonce_replay() {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
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
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        ts::return_shared(capability);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, capability_id);
        let mut fm_clock = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut fm_clock, ts::ctx(&mut scenario).epoch_timestamp_ms());
        authority::claim_authority_use_with_clock(
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
            &fm_clock,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(fm_clock);
        abort 0
    }

    fun check_millisecond_authority(now_ms: u64, legacy: bool, delegation: bool) {
        let mut scenario = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut scenario)));
        setup_org(&mut scenario);
        let cap_id = create_root(&mut scenario, authority::target_organization(), b"", b"", 3, b"", 0, 1000);
        ts::next_tx(&mut scenario, DELEGATE);
        let mut capability = ts::take_shared_by_id<RemoteCapability>(&scenario, cap_id);
        let mut clock_obj = ts::take_shared<Clock>(&scenario);
        clock::set_for_testing(&mut clock_obj, now_ms);
        // The epoch remains at zero: only Clock can enforce this boundary.
        assert!(ts::ctx(&mut scenario).epoch_timestamp_ms() == 0, 900);
        if (legacy) {
            authority::assert_authorized(&capability, &string::utf8(b"status"), &string::utf8(b"lifecycle"), authority::target_node(), &string::utf8(b"node-1"), &string::utf8(b""), ts::ctx(&mut scenario));
        } else if (delegation) {
            let org = ts::take_shared<Organization>(&scenario);
            let _id = authority::delegate_capability_with_clock(&mut capability, &org, CHILD_DELEGATE, authority::target_node(), string::utf8(b"node-1"), string::utf8(b""), vector[string::utf8(b"status")], string::utf8(b"lifecycle"), 1, string::utf8(b""), 0, 2000, &clock_obj, ts::ctx(&mut scenario));
            ts::return_shared(org);
        } else {
            authority::assert_authorized_with_clock(&capability, &string::utf8(b"status"), &string::utf8(b"lifecycle"), authority::target_node(), &string::utf8(b"node-1"), &string::utf8(b""), &clock_obj, ts::ctx(&mut scenario));
        };
        ts::return_shared(capability);
        ts::return_shared(clock_obj);
        ts::end(scenario);
    }

    #[test]
    fun test_clock_one_ms_before_expiry() { check_millisecond_authority(999, false, false); }

    #[test]
    #[expected_failure(abort_code = 8307, location = fractalmind_protocol::remote_authority)]
    fun test_clock_exact_expiry() { check_millisecond_authority(1000, false, false); }

    #[test]
    #[expected_failure(abort_code = 8307, location = fractalmind_protocol::remote_authority)]
    fun test_clock_one_ms_after_expiry() { check_millisecond_authority(1001, false, false); }

    #[test]
    #[expected_failure(abort_code = 8399, location = fractalmind_protocol::remote_authority)]
    fun test_legacy_validation_cannot_bypass_clock() { check_millisecond_authority(999, true, false); }

    #[test]
    #[expected_failure(abort_code = 8307, location = fractalmind_protocol::remote_authority)]
    fun test_expired_parent_cannot_delegate_within_epoch() { check_millisecond_authority(1000, false, true); }

    fun budget_scenario(): (ts::Scenario, ID) {
        let mut s = ts::begin(ADMIN);
        clock::share_for_testing(clock::create_for_testing(ts::ctx(&mut s)));
        setup_org(&mut s);
        let cap_id = create_root(&mut s, authority::target_node(), b"node-1", b"", 10, b"MIST", 100, 1000);
        ts::next_tx(&mut s, DELEGATE);
        (s, cap_id)
    }
    fun reserve_budget(s: &mut ts::Scenario, cap: &mut RemoteCapability, c: &Clock, token: u8, amount: u64) {
        authority::claim_bound_use(cap, string::utf8(b"deploy"), string::utf8(b"lifecycle"), authority::target_node(),
            string::utf8(b"node-1"), string::utf8(b""), string::utf8(vector[token]), string::utf8(vector[token]),
            string::utf8(vector[token]), string::utf8(b"MIST"), amount, hash(token), c, ts::ctx(s));
    }
    fun assert_budget(cap: &RemoteCapability, expected_spent: u64, expected_reserved: u64, code: u64) {
        let (spent, reserved) = authority::bound_budget(cap);
        assert!(spent == expected_spent && reserved == expected_reserved, code);
    }
    #[test]
    fun test_budget_spent_reserved_cancel_and_exact_retries() {
        let (mut s, cap_id) = budget_scenario();
        let mut cap = ts::take_shared_by_id<RemoteCapability>(&s, cap_id);
        let c = ts::take_shared<Clock>(&s);
        reserve_budget(&mut s, &mut cap, &c, 97, 40);
        reserve_budget(&mut s, &mut cap, &c, 97, 40);
        assert_budget(&cap, 0, 40, 1);
        assert!(authority::uses_claimed(&cap) == 1, 1);
        reserve_budget(&mut s, &mut cap, &c, 98, 60);
        assert_budget(&cap, 0, 100, 2);
        authority::settle_bound_budget(&mut cap, hash(97), 7);
        authority::settle_bound_budget(&mut cap, hash(97), 7);
        assert_budget(&cap, 7, 60, 3);
        assert!(authority::budget_claimed(&cap) == 67, 3);
        reserve_budget(&mut s, &mut cap, &c, 99, 30);
        authority::settle_bound_budget(&mut cap, hash(98), 0);
        assert_budget(&cap, 7, 30, 4);
        assert!(authority::budget_claimed(&cap) == 37, 4);
        reserve_budget(&mut s, &mut cap, &c, 97, 40);
        assert_budget(&cap, 7, 30, 5);
        assert!(authority::uses_claimed(&cap) == 3, 5);
        ts::return_shared(cap); ts::return_shared(c); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 8309, location = fractalmind_protocol::remote_authority)]
    fun test_pending_reservations_count_toward_budget_limit() {
        let (mut s, cap_id) = budget_scenario();
        let mut cap = ts::take_shared_by_id<RemoteCapability>(&s, cap_id);
        let c = ts::take_shared<Clock>(&s);
        reserve_budget(&mut s, &mut cap, &c, 97, 60); reserve_budget(&mut s, &mut cap, &c, 98, 41);
        ts::return_shared(cap); ts::return_shared(c); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 8319, location = fractalmind_protocol::remote_authority)]
    fun test_spent_cannot_exceed_reserved_amount() {
        let (mut s, cap_id) = budget_scenario();
        let mut cap = ts::take_shared_by_id<RemoteCapability>(&s, cap_id);
        let c = ts::take_shared<Clock>(&s);
        reserve_budget(&mut s, &mut cap, &c, 97, 40); authority::settle_bound_budget(&mut cap, hash(97), 41);
        ts::return_shared(cap); ts::return_shared(c); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 8319, location = fractalmind_protocol::remote_authority)]
    fun test_settlement_cannot_change_an_already_settled_cost() {
        let (mut s, cap_id) = budget_scenario();
        let mut cap = ts::take_shared_by_id<RemoteCapability>(&s, cap_id);
        let c = ts::take_shared<Clock>(&s);
        reserve_budget(&mut s, &mut cap, &c, 97, 40); authority::settle_bound_budget(&mut cap, hash(97), 7);
        authority::settle_bound_budget(&mut cap, hash(97), 8);
        ts::return_shared(cap); ts::return_shared(c); ts::end(s);
    }
}
