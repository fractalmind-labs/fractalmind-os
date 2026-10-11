#[test_only]
module fractalmind_protocol::agent_manager_runtime_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use std::string;
    use fractalmind_protocol::identity_tests;
    use fractalmind_protocol::identity::{HumanIdentity, DeviceGrant};
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};

    fun bytes(n: u8): vector<u8> { let mut out = vector[]; let mut i = 0; while (i < 32) { vector::push_back(&mut out, n); i = i + 1; }; out }
    fun setup(): Scenario {
        let mut s = identity_tests::setup();
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let mut c = ts::take_shared<Clock>(&s);
        clock::set_for_testing(&mut c, 1);
        host::create_coordinator_binding(&mut org, &human, &grant, bytes(9), string::utf8(b"https://unit.invalid"), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let c = ts::take_shared<Clock>(&s); let binding = ts::take_shared<CoordinatorBinding>(&s);
        host::admitted_member_for_testing(&mut org, &binding, bytes(5), &c, ts::ctx(&mut s));
        ts::return_shared(binding); ts::return_shared(c); ts::return_shared(org); ts::next_tx(&mut s, @0xA);
        s
    }
    fun import(s: &mut Scenario, runtime: vector<u8>, control: bool) {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s); let c = ts::take_shared<Clock>(s);
        let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s);
        host::import_agent(&mut org, &human, &grant, &member, &binding, string::utf8(b"tmux-fixture"), string::utf8(runtime), bytes(7), control, &c, ts::ctx(s));
        ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(s, @0xA);
    }

    #[test]
    fun agent_manager_agents_are_imported_with_control() {
        let mut s = setup();
        import(&mut s, b"agent-manager-v1", true);
        let org = ts::take_shared<Organization>(&s); let member = ts::take_shared<HostMembership>(&s); let managed = ts::take_shared<ManagedAgent>(&s);
        assert!(host::managed_runtime(&managed) == string::utf8(b"agent-manager-v1"), 0);
        // Everything that requires control (OKRs, direct messages, operate capabilities) checks this.
        host::assert_managed(&org, &member, &managed, true);
        assert!(host::runtime_controllable(&string::utf8(b"agent-manager-v1")) && host::runtime_controllable(&string::utf8(b"bounded-process-v1")), 1);
        assert!(!host::runtime_controllable(&string::utf8(b"tmux-observe")) && host::runtime_known(&string::utf8(b"tmux-observe")), 2);
        ts::return_shared(managed); ts::return_shared(member); ts::return_shared(org);
        ts::end(s);
    }
    #[test]
    fun agent_manager_agents_may_also_be_observe_only() {
        let mut s = setup();
        import(&mut s, b"agent-manager-v1", false);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9211, location = fractalmind_protocol::host)]
    fun a_bounded_process_still_needs_the_handover_for_control() {
        let mut s = setup();
        import(&mut s, b"bounded-process-v1", true);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9211, location = fractalmind_protocol::host)]
    fun a_tmux_observation_never_gets_control() {
        let mut s = setup();
        import(&mut s, b"tmux-observe", true);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9201, location = fractalmind_protocol::host)]
    fun unknown_runtimes_are_rejected() {
        let mut s = setup();
        import(&mut s, b"shell-v1", false);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9201, location = fractalmind_protocol::host)]
    fun an_observe_only_agent_manager_record_cannot_be_controlled() {
        let mut s = setup();
        import(&mut s, b"agent-manager-v1", false);
        let org = ts::take_shared<Organization>(&s); let member = ts::take_shared<HostMembership>(&s); let managed = ts::take_shared<ManagedAgent>(&s);
        host::assert_managed(&org, &member, &managed, true);
        ts::return_shared(managed); ts::return_shared(member); ts::return_shared(org);
        ts::end(s);
    }
}
