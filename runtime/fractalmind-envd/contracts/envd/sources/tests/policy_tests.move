#[test_only]
module fractalmind_envd::policy_tests {
    use sui::test_scenario::{Self as ts};
    use std::string;

    use fractalmind_protocol::organization::{Self, Organization};
    use fractalmind_protocol::agent::{Self, AgentCertificate};
    use fractalmind_envd::policy::{Self, AgentPolicy};

    const ADMIN: address = @0xA;
    const AGENT1: address = @0x1;

    fun setup_org_with_agent(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let mut registry = organization::create_test_registry(ts::ctx(scenario));
            organization::create_organization(
                &mut registry,
                string::utf8(b"PolicyOrg"),
                string::utf8(b"org for policy tests"),
                ts::ctx(scenario),
            );
            organization::destroy_test_registry(registry);
        };

        ts::next_tx(scenario, AGENT1);
        {
            let mut org = ts::take_shared<Organization>(scenario);
            agent::register_agent(&mut org, std::vector::empty(), ts::ctx(scenario));
            ts::return_shared(org);
        };
    }

    #[test]
    fun test_create_policy_and_execute_action() {
        let mut scenario = ts::begin(ADMIN);
        setup_org_with_agent(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let org = ts::take_shared<Organization>(&scenario);
            policy::create_policy(
                &org,
                AGENT1,
                string::utf8(b"shell_exec"),
                string::utf8(b"host:worker-1"),
                2,
                1_000_000,
                10_000_000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(org);
        };

        ts::next_tx(&mut scenario, AGENT1);
        {
            let cert = ts::take_from_sender<AgentCertificate>(&scenario);
            let org = ts::take_shared<Organization>(&scenario);
            let mut policy_obj = ts::take_shared<AgentPolicy>(&scenario);

            policy::execute_action(
                &mut policy_obj,
                &org,
                &cert,
                string::utf8(b"shell_exec"),
                string::utf8(b"host:worker-1"),
                b"01234567890123456789012345678901",
                b"abcdefghijabcdefghijabcdefghijab",
                1000,
                ts::ctx(&mut scenario),
            );

            assert!(policy::policy_agent(&policy_obj) == AGENT1, 0);
            assert!(policy::policy_owner(&policy_obj) == ADMIN, 1);
            assert!(policy::policy_allowed_action(&policy_obj) == string::utf8(b"shell_exec"), 2);
            assert!(policy::policy_target_scope(&policy_obj) == string::utf8(b"host:worker-1"), 3);
            assert!(policy::policy_uses_consumed(&policy_obj) == 1, 4);
            assert!(!policy::policy_revoked(&policy_obj), 5);

            ts::return_shared(org);
            ts::return_shared(policy_obj);
            ts::return_to_sender(&scenario, cert);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_revoke_policy() {
        let mut scenario = ts::begin(ADMIN);
        setup_org_with_agent(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let org = ts::take_shared<Organization>(&scenario);
            policy::create_policy(
                &org,
                AGENT1,
                string::utf8(b"shell_exec"),
                string::utf8(b"host:worker-1"),
                1,
                1_000_000,
                10_000_000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(org);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let org = ts::take_shared<Organization>(&scenario);
            let mut policy_obj = ts::take_shared<AgentPolicy>(&scenario);
            policy::revoke_policy(&mut policy_obj, &org, ts::ctx(&mut scenario));
            assert!(policy::policy_revoked(&policy_obj), 0);
            ts::return_shared(org);
            ts::return_shared(policy_obj);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 8207, location = fractalmind_envd::policy)]
    fun test_execute_action_rejects_wrong_action_kind() {
        let mut scenario = ts::begin(ADMIN);
        setup_org_with_agent(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let org = ts::take_shared<Organization>(&scenario);
            policy::create_policy(
                &org,
                AGENT1,
                string::utf8(b"shell_exec"),
                string::utf8(b"host:worker-1"),
                1,
                1_000_000,
                10_000_000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(org);
        };

        ts::next_tx(&mut scenario, AGENT1);
        {
            let cert = ts::take_from_sender<AgentCertificate>(&scenario);
            let org = ts::take_shared<Organization>(&scenario);
            let mut policy_obj = ts::take_shared<AgentPolicy>(&scenario);
            policy::execute_action(
                &mut policy_obj,
                &org,
                &cert,
                string::utf8(b"restart_agent"),
                string::utf8(b"host:worker-1"),
                b"01234567890123456789012345678901",
                b"abcdefghijabcdefghijabcdefghijab",
                1000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(org);
            ts::return_shared(policy_obj);
            ts::return_to_sender(&scenario, cert);
        };

        ts::end(scenario);
    }
}
