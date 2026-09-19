#[test_only]
module fractalmind_protocol::objective_tests {
    use sui::object;
    use sui::test_scenario::{Self as ts};
    use std::string;
    use std::option;

    use fractalmind_protocol::organization::{Self, Organization, OrgAdminCap};
    use fractalmind_protocol::agent::{Self, AgentCertificate};
    use fractalmind_protocol::objective::{Self, Objective, KeyResult, KRReview};
    use fractalmind_protocol::task::{Self, Task};
    use fractalmind_protocol::agent_policy::{Self as agent_policy, AgentPolicy};

    const ADMIN: address = @0xA;
    const AGENT1: address = @0x1;

    fun hash32(): vector<u8> { b"01234567890123456789012345678901" }
    fun hash32b(): vector<u8> { b"abcdefghijabcdefghijabcdefghijab" }

    fun setup_org_agent_objective_kr(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let mut registry = organization::create_test_registry(ts::ctx(scenario));
            organization::create_organization(
                &mut registry,
                string::utf8(b"OKROrg"),
                string::utf8(b"org for objective tests"),
                ts::ctx(scenario),
            );
            organization::destroy_test_registry(registry);
        };

        ts::next_tx(scenario, AGENT1);
        {
            let mut org = ts::take_shared<Organization>(scenario);
            agent::register_agent(&mut org, vector[string::utf8(b"dev")], ts::ctx(scenario));
            ts::return_shared(org);
        };

        ts::next_tx(scenario, ADMIN);
        {
            let admin_cap = ts::take_from_sender<OrgAdminCap>(scenario);
            let org = ts::take_shared<Organization>(scenario);
            objective::create_objective(
                &admin_cap,
                &org,
                string::utf8(b"Ship Sui Overflow"),
                hash32(),
                1_000_000,
                ts::ctx(scenario),
            );
            ts::return_shared(org);
            ts::return_to_sender(scenario, admin_cap);
        };

        ts::next_tx(scenario, ADMIN);
        {
            let admin_cap = ts::take_from_sender<OrgAdminCap>(scenario);
            let mut obj = ts::take_shared<Objective>(scenario);
            objective::create_key_result(
                &admin_cap,
                &mut obj,
                string::utf8(b"Objective/KR control plane merged"),
                hash32b(),
                ts::ctx(scenario),
            );
            assert!(objective::objective_key_result_count(&obj) == 1, 0);
            ts::return_shared(obj);
            ts::return_to_sender(scenario, admin_cap);
        };
    }

    #[test]
    fun test_objective_key_result_review_lifecycle() {
        let mut scenario = ts::begin(ADMIN);
        setup_org_agent_objective_kr(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = ts::take_from_sender<OrgAdminCap>(&scenario);
            let obj = ts::take_shared<Objective>(&scenario);
            let mut kr = ts::take_shared<KeyResult>(&scenario);
            objective::accept_key_result(&admin_cap, &obj, &mut kr, hash32(), ts::ctx(&mut scenario));
            assert!(objective::key_result_status(&kr) == objective::kr_status_accepted(), 1);
            assert!(objective::key_result_review_count(&kr) == 1, 2);
            ts::return_shared(kr);
            ts::return_shared(obj);
            ts::return_to_sender(&scenario, admin_cap);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let review = ts::take_shared<KRReview>(&scenario);
            assert!(objective::kr_review_verdict(&review) == objective::kr_verdict_pass(), 3);
            ts::return_shared(review);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_task_and_policy_bind_to_key_result() {
        let mut scenario = ts::begin(ADMIN);
        setup_org_agent_objective_kr(&mut scenario);

        ts::next_tx(&mut scenario, AGENT1);
        {
            let cert = ts::take_from_sender<AgentCertificate>(&scenario);
            let mut org = ts::take_shared<Organization>(&scenario);
            let obj = ts::take_shared<Objective>(&scenario);
            let mut kr = ts::take_shared<KeyResult>(&scenario);
            let kr_id = object::id(&kr);
            task::create_task_for_key_result(
                &mut org,
                &obj,
                &mut kr,
                &cert,
                string::utf8(b"Implement OKR primitives"),
                string::utf8(b"Move + SDK implementation"),
                ts::ctx(&mut scenario),
            );
            assert!(objective::key_result_task_count(&kr) == 1, 0);
            ts::return_shared(kr);
            ts::return_shared(obj);
            ts::return_shared(org);
            ts::return_to_sender(&scenario, cert);

            ts::next_tx(&mut scenario, AGENT1);
            let task_obj = ts::take_shared<Task>(&scenario);
            assert!(option::contains(&task::task_key_result_id(&task_obj), &kr_id), 1);
            ts::return_shared(task_obj);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let org = ts::take_shared<Organization>(&scenario);
            let obj = ts::take_shared<Objective>(&scenario);
            let kr = ts::take_shared<KeyResult>(&scenario);
            let obj_id = object::id(&obj);
            let kr_id = object::id(&kr);
            agent_policy::create_policy_for_key_result(
                &org,
                &obj,
                &kr,
                AGENT1,
                string::utf8(b"execute_kr_task"),
                string::utf8(b"kr:sui-overflow"),
                1,
                1_000_000,
                10_000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(kr);
            ts::return_shared(obj);
            ts::return_shared(org);

            ts::next_tx(&mut scenario, ADMIN);
            let policy = ts::take_shared<AgentPolicy>(&scenario);
            assert!(option::contains(&agent_policy::policy_objective_id(&policy), &obj_id), 2);
            assert!(option::contains(&agent_policy::policy_key_result_id(&policy), &kr_id), 3);
            ts::return_shared(policy);
        };

        ts::end(scenario);
    }


    #[test]
    #[expected_failure(abort_code = 8305, location = fractalmind_protocol::objective)]
    fun test_closed_objective_rejects_kr_review() {
        let mut scenario = ts::begin(ADMIN);
        setup_org_agent_objective_kr(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = ts::take_from_sender<OrgAdminCap>(&scenario);
            let mut obj = ts::take_shared<Objective>(&scenario);
            objective::close_objective(&admin_cap, &mut obj, ts::ctx(&mut scenario));
            ts::return_shared(obj);
            ts::return_to_sender(&scenario, admin_cap);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = ts::take_from_sender<OrgAdminCap>(&scenario);
            let obj = ts::take_shared<Objective>(&scenario);
            let mut kr = ts::take_shared<KeyResult>(&scenario);
            objective::accept_key_result(&admin_cap, &obj, &mut kr, hash32(), ts::ctx(&mut scenario));
            ts::return_shared(kr);
            ts::return_shared(obj);
            ts::return_to_sender(&scenario, admin_cap);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 1001)]
    fun test_closed_objective_rejects_kr_bound_task() {
        let mut scenario = ts::begin(ADMIN);
        setup_org_agent_objective_kr(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = ts::take_from_sender<OrgAdminCap>(&scenario);
            let mut obj = ts::take_shared<Objective>(&scenario);
            objective::close_objective(&admin_cap, &mut obj, ts::ctx(&mut scenario));
            ts::return_shared(obj);
            ts::return_to_sender(&scenario, admin_cap);
        };

        ts::next_tx(&mut scenario, AGENT1);
        {
            let cert = ts::take_from_sender<AgentCertificate>(&scenario);
            let mut org = ts::take_shared<Organization>(&scenario);
            let obj = ts::take_shared<Objective>(&scenario);
            let mut kr = ts::take_shared<KeyResult>(&scenario);
            task::create_task_for_key_result(
                &mut org,
                &obj,
                &mut kr,
                &cert,
                string::utf8(b"late task"),
                string::utf8(b"should fail"),
                ts::ctx(&mut scenario),
            );
            ts::return_shared(kr);
            ts::return_shared(obj);
            ts::return_shared(org);
            ts::return_to_sender(&scenario, cert);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 8302, location = fractalmind_protocol::objective)]
    fun test_objective_rejects_invalid_hash() {
        let mut scenario = ts::begin(ADMIN);
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut registry = organization::create_test_registry(ts::ctx(&mut scenario));
            organization::create_organization(
                &mut registry,
                string::utf8(b"BadHashOrg"),
                string::utf8(b"bad hash org"),
                ts::ctx(&mut scenario),
            );
            organization::destroy_test_registry(registry);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let admin_cap = ts::take_from_sender<OrgAdminCap>(&scenario);
            let org = ts::take_shared<Organization>(&scenario);
            objective::create_objective(
                &admin_cap,
                &org,
                string::utf8(b"Bad hash"),
                b"short",
                1_000_000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(org);
            ts::return_to_sender(&scenario, admin_cap);
        };

        ts::end(scenario);
    }
}
