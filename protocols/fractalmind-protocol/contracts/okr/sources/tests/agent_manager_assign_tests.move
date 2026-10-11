#[test_only]
module fractalmind_okr::agent_manager_assign_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use std::string;
    use fractalmind_protocol::identity_tests;
    use fractalmind_protocol::identity::{HumanIdentity, DeviceGrant};
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_okr::okr::{Self, Okr};

    fun bytes(n: u8): vector<u8> { let mut out = vector[]; let mut i = 0; while (i < 32) { vector::push_back(&mut out, n); i = i + 1; }; out }
    fun body(): vector<u8> { let mut out = b"FME1"; vector::append(&mut out, bytes(0)); out }
    fun setup(runtime: vector<u8>, control: bool): Scenario {
        let mut s = identity_tests::setup();
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let mut c = ts::take_shared<Clock>(&s);
        clock::set_for_testing(&mut c, 1);
        host::create_coordinator_binding(&mut org, &human, &grant, bytes(9), string::utf8(b"https://unit.invalid"), &c, ts::ctx(&mut s));
        let _ = okr::create_draft(&mut org, &human, &grant, string::utf8(b"goal"), 0, 10000, vector[0], vector[3], vector[1], vector[1000], 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let c = ts::take_shared<Clock>(&s); let binding = ts::take_shared<CoordinatorBinding>(&s);
        host::admitted_member_for_testing(&mut org, &binding, bytes(5), &c, ts::ctx(&mut s));
        ts::return_shared(binding); ts::return_shared(c); ts::return_shared(org); ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let binding = ts::take_shared<CoordinatorBinding>(&s); let member = ts::take_shared<HostMembership>(&s);
        host::import_agent(&mut org, &human, &grant, &member, &binding, string::utf8(b"tmux-fixture"), string::utf8(runtime), bytes(7), control, &c, ts::ctx(&mut s));
        ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::next_tx(&mut s, @0xA);
        s
    }
    fun assign(s: &mut Scenario, workspace: vector<u8>, expires: u64) {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s); let c = ts::take_shared<Clock>(s);
        let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let mut goal = ts::take_shared<Okr>(s);
        okr::assign_agent_manager(&mut goal, &mut org, &human, &grant, &member, &binding, &managed, 1, workspace, bytes(8),
            string::utf8(b"TOOL_CALLS"), 50, expires, 0, 1, body(), &c, ts::ctx(s));
        assert!(okr::state(&goal) == 1 && okr::agreement_version(&goal) == 1, 0);
        assert!(okr::managed_agent(&goal) == std::option::some(sui::object::id(&managed)), 1);
        ts::return_shared(goal); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(s, @0xA);
    }

    #[test]
    fun an_agent_manager_agent_takes_the_okr_without_a_handover() {
        let mut s = setup(b"agent-manager-v1", true);
        assign(&mut s, bytes(7), 5000);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9201, location = fractalmind_protocol::host)]
    fun an_observe_only_import_cannot_take_an_okr() {
        let mut s = setup(b"agent-manager-v1", false);
        assign(&mut s, bytes(7), 5000);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9410, location = fractalmind_okr::okr)]
    fun a_tmux_observation_cannot_take_an_okr() {
        let mut s = setup(b"tmux-observe", false);
        assign(&mut s, bytes(7), 5000);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9405, location = fractalmind_okr::okr)]
    fun the_workspace_must_be_the_agents_home() {
        let mut s = setup(b"agent-manager-v1", true);
        assign(&mut s, bytes(6), 5000);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9401, location = fractalmind_okr::okr)]
    fun the_agreement_cannot_outlive_the_goal() {
        let mut s = setup(b"agent-manager-v1", true);
        assign(&mut s, bytes(7), 20000);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9410, location = fractalmind_okr::okr)]
    fun no_command_capability_is_issued_for_it() {
        let mut s = setup(b"agent-manager-v1", true);
        assign(&mut s, bytes(7), 5000);
        let org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let binding = ts::take_shared<CoordinatorBinding>(&s); let member = ts::take_shared<HostMembership>(&s); let managed = ts::take_shared<ManagedAgent>(&s); let goal = ts::take_shared<Okr>(&s);
        okr::issue_capability(&goal, &org, &human, &grant, &member, &binding, &managed, 2, 1, &c, ts::ctx(&mut s));
        ts::return_shared(goal); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::end(s);
    }
}
