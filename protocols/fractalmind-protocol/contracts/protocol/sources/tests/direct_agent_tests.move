#[test_only]
module fractalmind_protocol::direct_agent_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::object::{Self, ID};
    use sui::clock::{Self, Clock};
    use std::string;
    use std::option;
    use fractalmind_protocol::identity_tests;
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::remote_authority::RemoteCapability;
    use fractalmind_protocol::node_execution::{Self as execution, CommandExecution};
    use fractalmind_protocol::direct_agent::{Self as direct, StandingPermission, Message, Approval};
    use fractalmind_protocol::okr::{Self, Okr};

    fun bytes(n: u8): vector<u8> { vector[n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n, n] }
    fun body(): vector<u8> { let mut out = b"FME1"; vector::append(&mut out, bytes(0)); out }
    fun setup(control: bool): Scenario {
        let mut s = identity_tests::setup();
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let mut c = ts::take_shared<Clock>(&s);
        clock::set_for_testing(&mut c, 1);
        host::create_coordinator_binding(&mut org, &human, &grant, bytes(9), string::utf8(b"https://unit.invalid"), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let c = ts::take_shared<Clock>(&s); let binding = ts::take_shared<CoordinatorBinding>(&s);
        // This fixture establishes admitted state, not a proof of invitation
        // signatures or physical Host consent. Those require live integration.
        host::admitted_member_for_testing(&mut org, &binding, bytes(5), &c, ts::ctx(&mut s));
        ts::return_shared(binding); ts::return_shared(c); ts::return_shared(org);
        ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s);
        let c = ts::take_shared<Clock>(&s); let binding = ts::take_shared<CoordinatorBinding>(&s); let member = ts::take_shared<HostMembership>(&s);
        host::import_agent(&mut org, &human, &grant, &member, &binding, string::utf8(b"native-fixture"), string::utf8(b"bounded-process-v1"), bytes(7), false, &c, ts::ctx(&mut s));
        ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s);
        let c = ts::take_shared<Clock>(&s); let binding = ts::take_shared<CoordinatorBinding>(&s); let member = ts::take_shared<HostMembership>(&s); let mut managed = ts::take_shared<ManagedAgent>(&s);
        if (control) host::confirm_reviewed_control(&mut org, &human, &grant, &member, &binding, &mut managed, 1, bytes(7), &c, ts::ctx(&mut s));
        direct::create_permission(&mut org, &human, &grant, &member, &binding, &managed,
            vector[string::utf8(b"ask"), string::utf8(b"status"), string::utf8(b"file.read"), string::utf8(b"file.write")], bytes(8), 3, 6, 1000, 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, @0xA);
        let org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s);
        let c = ts::take_shared<Clock>(&s); let binding = ts::take_shared<CoordinatorBinding>(&s); let member = ts::take_shared<HostMembership>(&s); let managed = ts::take_shared<ManagedAgent>(&s); let permission = ts::take_shared<StandingPermission>(&s);
        direct::issue_capability(&permission, &org, &human, &grant, &member, &binding, &managed, 1, 1000, &c, ts::ctx(&mut s));
        ts::return_shared(permission); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, @0xA); s
    }
    fun message(s: &mut Scenario, token: vector<u8>, action: vector<u8>, amount: u64, boundary: u8): ID {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s);
        let c = ts::take_shared<Clock>(s); let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let mut permission = ts::take_shared<StandingPermission>(s);
        let version = direct::version(&permission);
        let id = direct::create_message(&mut permission, &mut org, &human, &grant, &member, &binding, &managed, version, string::utf8(b"conversation"), string::utf8(token), string::utf8(action), bytes(boundary), amount, bytes(9), 500, 1, body(), &c, ts::ctx(s));
        ts::return_shared(permission); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(s, @0xA); id
    }
    fun prepare(s: &mut Scenario, message_id: ID, hash: u8, approved: bool): ID {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s);
        let c = ts::take_shared<Clock>(s); let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let mut permission = ts::take_shared<StandingPermission>(s);
        let message = ts::take_immutable_by_id<Message>(s, message_id); let mut cap = ts::take_shared<RemoteCapability>(s);
        if (approved) {
            let mut approval = ts::take_shared<Approval>(s);
            direct::prepare_approved_message(&mut permission, &mut approval, &message, &mut cap, &mut org, &human, &grant, &grant, &member, &binding, &managed,
                string::utf8(vector[hash + 65]), string::utf8(vector[hash + 65]), string::utf8(vector[hash + 65]), bytes(hash), 1, 500, &c, ts::ctx(s));
            assert!(direct::approval_state(&approval) == 3, 0); ts::return_shared(approval);
        } else direct::prepare_message(&mut permission, &message, &mut cap, &mut org, &human, &grant, &member, &binding, &managed,
                string::utf8(vector[hash + 65]), string::utf8(vector[hash + 65]), string::utf8(vector[hash + 65]), bytes(hash), 1, 500, &c, ts::ctx(s));
        let id = *option::borrow(&execution::execution_id(&cap, bytes(hash)));
        ts::return_shared(cap); ts::return_immutable(message); ts::return_shared(permission); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(s, @0xA); id
    }
    fun check(s: &mut Scenario, spent: u64, reserved: u64, exception_spent: u64, exception_reserved: u64) {
        let p = ts::take_shared<StandingPermission>(s);
        let (a, b, c, d) = direct::budget_totals(&p);
        assert!(a == spent && b == reserved && c == exception_spent && d == exception_reserved, 0); ts::return_shared(p); ts::next_tx(s, @0xA);
    }
    fun update(s: &mut Scenario, limit: u64) {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s);
        let c = ts::take_shared<Clock>(s); let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let mut permission = ts::take_shared<StandingPermission>(s);
        let v = direct::version(&permission);
        direct::update_permission(&mut permission, &mut org, &human, &grant, &member, &binding, &managed, v,
            vector[string::utf8(b"file.write"), string::utf8(b"status")], bytes(8), if (limit < 3) limit else 3, limit, 1000, 1, body(), &c, ts::ctx(s));
        assert!(direct::version(&permission) == v + 1, 0);
        ts::return_shared(permission); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(s, @0xA);
    }
    fun approve(s: &mut Scenario, message_id: ID, decide: bool) {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s);
        let c = ts::take_shared<Clock>(s); let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let mut permission = ts::take_shared<StandingPermission>(s); let msg = ts::take_immutable_by_id<Message>(s, message_id);
        direct::request_approval(&mut permission, &msg, &mut org, &human, &grant, &member, &binding, &managed, 1, body(), &c, ts::ctx(s));
        ts::return_immutable(msg); ts::return_shared(permission); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(s, @0xA);
        if (decide) {
            let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s);
            let c = ts::take_shared<Clock>(s); let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let permission = ts::take_shared<StandingPermission>(s); let msg = ts::take_immutable_by_id<Message>(s, message_id); let mut approval = ts::take_shared<Approval>(s);
            direct::decide_approval(&permission, &mut approval, &msg, &mut org, &human, &grant, &member, &binding, &managed, true, 1, body(), &c, ts::ctx(s));
            direct::issue_approved_capability(&permission, &approval, &msg, &org, &human, &grant, &grant, &member, &binding, &managed, &c, ts::ctx(s));
            ts::return_shared(approval); ts::return_immutable(msg); ts::return_shared(permission); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
            ts::next_tx(s, @0xA);
        };
    }
    fun begin(s: &mut Scenario, message_id: ID, run_id: ID, approved: bool) {
        ts::next_tx(s, identity::signing_address(&bytes(5)));
        let org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s);
        let c = ts::take_shared<Clock>(s); let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let permission = ts::take_shared<StandingPermission>(s); let msg = ts::take_immutable_by_id<Message>(s, message_id); let cap = ts::take_shared<RemoteCapability>(s); let mut run = ts::take_shared_by_id<CommandExecution>(s, run_id);
        if (approved) {
            let approval = ts::take_shared<Approval>(s);
            direct::begin_approved_message(&permission, &approval, &msg, &mut run, &cap, &org, &human, &grant, &grant, &member, &binding, &managed, bytes(9), &c, ts::ctx(s));
            ts::return_shared(approval);
        } else direct::begin_message(&permission, &msg, &mut run, &cap, &org, &human, &grant, &member, &binding, &managed, bytes(9), &c, ts::ctx(s));
        ts::return_shared(run); ts::return_shared(cap); ts::return_immutable(msg); ts::return_shared(permission); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(s, @0xA);
    }
    fun finish(s: &mut Scenario, run_id: ID, state: u8, spent: u64) {
        ts::next_tx(s, identity::signing_address(&bytes(5)));
        let mut org = ts::take_shared<Organization>(s); let c = ts::take_shared<Clock>(s); let mut permission = ts::take_shared<StandingPermission>(s); let mut cap = ts::take_shared<RemoteCapability>(s); let mut run = ts::take_shared_by_id<CommandExecution>(s, run_id);
        direct::finish_message(&mut permission, &mut run, &mut cap, &mut org, state, 2, spent, 1, body(), &c, ts::ctx(s));
        ts::return_shared(run); ts::return_shared(cap); ts::return_shared(permission); ts::return_shared(c); ts::return_shared(org); ts::next_tx(s, @0xA);
    }
    fun activate(s: &mut Scenario) {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s); let c = ts::take_shared<Clock>(s);
        okr::create_draft(&mut org, &human, &grant, string::utf8(b"protected"), 0, 1000, vector[0], vector[1], vector[1], vector[100], 1, body(), &c, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::next_tx(s, @0xA);
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s); let grant = ts::take_shared<DeviceGrant>(s); let c = ts::take_shared<Clock>(s);
        let binding = ts::take_shared<CoordinatorBinding>(s); let member = ts::take_shared<HostMembership>(s); let managed = ts::take_shared<ManagedAgent>(s); let mut o = ts::take_shared<Okr>(s);
        okr::activate_reviewed(&mut o, &mut org, &human, &grant, &member, &binding, &managed, 1, bytes(7), bytes(8), string::utf8(b"TOOL_CALLS"), 6, 1000, 0, 1, body(), &c, ts::ctx(s));
        let (protected, revision, complete) = okr::direct_workspace_state(&org, object::id(&managed), host::membership_host_address(&member), bytes(7));
        assert!(protected && revision == 2 && complete, 0);
        let (protected, revision, complete) = okr::direct_workspace_state(&org, object::id_from_address(@0xF), host::membership_host_address(&member), bytes(8));
        assert!(!protected && revision == 2 && complete, 0);
        let (protected, _, complete) = okr::direct_workspace_state(&org, object::id_from_address(@0xF), host::membership_host_address(&member), bytes(7));
        assert!(protected && complete, 0);
        let (protected, _, complete) = okr::direct_workspace_state(&org, object::id_from_address(@0xF), @0xF, bytes(7));
        assert!(!protected && complete, 0);
        ts::return_shared(o); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::next_tx(s, @0xA);
    }
    #[test]
    fun duplicate_returns_original_without_another_reservation() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8);
        let r = prepare(&mut s, m, 1, false); assert!(prepare(&mut s, m, 1, false) == r, 0); check(&mut s, 0, 3, 0, 0); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9605, location = fractalmind_protocol::direct_agent)]
    fun pending_reservations_exhaust_standing_budget() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8); prepare(&mut s, m, 1, false);
        let m = message(&mut s, b"two", b"file.write", 3, 8); prepare(&mut s, m, 2, false); check(&mut s, 0, 6, 0, 0);
        let m = message(&mut s, b"three", b"file.write", 1, 8); prepare(&mut s, m, 3, false); ts::end(s);
    }
    #[test]
    fun policy_change_preserves_reservations_and_historical_spend() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8); let r = prepare(&mut s, m, 1, false);
        begin(&mut s, m, r, false); update(&mut s, 6); check(&mut s, 0, 3, 0, 0); finish(&mut s, r, 2, 2); check(&mut s, 2, 0, 0, 0);
        update(&mut s, 6); check(&mut s, 2, 0, 0, 0); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9607, location = fractalmind_protocol::direct_agent)]
    fun policy_cannot_reduce_limit_below_inflight_reservation() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8); prepare(&mut s, m, 1, false); update(&mut s, 2); ts::end(s);
    }
    #[test]
    fun unknown_result_retains_both_ledgers_and_blocks_handover() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8); let r = prepare(&mut s, m, 1, false); begin(&mut s, m, r, false); finish(&mut s, r, 4, 0); check(&mut s, 0, 3, 0, 0);
        let org = ts::take_shared<Organization>(&s); let managed = ts::take_shared<ManagedAgent>(&s);
        assert!(host::unsettled_agent_controls(&org, object::id(&managed)) == 1, 0);
        ts::return_shared(managed); ts::return_shared(org); ts::end(s);
    }
    #[test]
    fun explicit_exception_settles_separately_and_never_expands_standing_permission() {
        let mut s = setup(true); let m = message(&mut s, b"exception", b"file.write", 5, 9); approve(&mut s, m, true);
        let r = prepare(&mut s, m, 1, true); assert!(prepare(&mut s, m, 1, true) == r, 0); check(&mut s, 0, 0, 0, 5);
        begin(&mut s, m, r, true); finish(&mut s, r, 2, 4); check(&mut s, 0, 0, 4, 0); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9606, location = fractalmind_protocol::direct_agent)]
    fun approval_cannot_authorize_a_second_command() {
        let mut s = setup(true); let m = message(&mut s, b"exception", b"file.write", 5, 9); approve(&mut s, m, true); prepare(&mut s, m, 1, true); prepare(&mut s, m, 2, true); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9602, location = fractalmind_protocol::direct_agent)]
    fun replaced_policy_invalidates_a_queued_message() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8); let r = prepare(&mut s, m, 1, false); update(&mut s, 6); begin(&mut s, m, r, false); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9602, location = fractalmind_protocol::direct_agent)]
    fun replaced_policy_invalidates_prior_approval() {
        let mut s = setup(true); let m = message(&mut s, b"exception", b"file.write", 5, 9); approve(&mut s, m, true); update(&mut s, 6); prepare(&mut s, m, 1, true); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9605, location = fractalmind_protocol::direct_agent)]
    fun active_okr_protects_its_workspace_from_unapproved_writes() {
        let mut s = setup(true); activate(&mut s); let m = message(&mut s, b"one", b"file.write", 3, 8); prepare(&mut s, m, 1, false); ts::end(s);
    }
    #[test]
    fun active_okr_does_not_block_status_and_explicit_exception() {
        let mut s = setup(true); activate(&mut s); let m = message(&mut s, b"status", b"status", 0, 8); prepare(&mut s, m, 1, false);
        let m = message(&mut s, b"write", b"file.write", 3, 8); approve(&mut s, m, true); prepare(&mut s, m, 2, true); check(&mut s, 0, 0, 0, 3); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9312, location = fractalmind_protocol::node_execution)]
    fun generic_command_entry_cannot_bypass_direct_permission() {
        let mut s = setup(true);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let binding = ts::take_shared<CoordinatorBinding>(&s); let member = ts::take_shared<HostMembership>(&s); let managed = ts::take_shared<ManagedAgent>(&s); let mut cap = ts::take_shared<RemoteCapability>(&s);
        execution::prepare_agent_command_v2(&mut cap, &mut org, &human, &grant, &member, &binding, &managed, string::utf8(b"direct.message"), string::utf8(b"direct"), string::utf8(b"c"), string::utf8(b"n"), string::utf8(b"i"), string::utf8(b"TOOL_CALLS"), 3, bytes(1), 1, 500, &c, ts::ctx(&mut s));
        ts::return_shared(cap); ts::return_shared(managed); ts::return_shared(member); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9201, location = fractalmind_protocol::host)]
    fun observation_import_cannot_obtain_standing_execution_permission() { let s = setup(false); ts::end(s); }
    #[test]
    #[expected_failure(abort_code = 9608, location = fractalmind_protocol::direct_agent)]
    fun one_message_cannot_reserve_two_different_commands() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8);
        prepare(&mut s, m, 1, false); prepare(&mut s, m, 2, false); ts::end(s);
    }
    #[test]
    fun revocation_does_not_prevent_refunding_an_original_queued_run() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8); let r = prepare(&mut s, m, 1, false);
        let org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s); let mut p = ts::take_shared<StandingPermission>(&s);
        direct::revoke_permission(&mut p, &org, &human, &grant, 1, &c, ts::ctx(&mut s));
        ts::return_shared(p); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s); let mut p = ts::take_shared<StandingPermission>(&s); let mut cap = ts::take_shared<RemoteCapability>(&s); let mut run = ts::take_shared_by_id<CommandExecution>(&s, r);
        direct::request_stop(&mut p, &mut run, &mut cap, &mut org, &human, &grant, &c, ts::ctx(&mut s));
        assert!(execution::state(&run) == 5, 0); let (spent, reserved, _, _) = direct::budget_totals(&p); assert!(spent == 0 && reserved == 0, 0);
        let (_, reserved) = fractalmind_protocol::remote_authority::bound_budget(&cap); assert!(reserved == 0, 0);
        ts::return_shared(run); ts::return_shared(cap); ts::return_shared(p); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9604, location = fractalmind_protocol::direct_agent)]
    fun message_reaches_exact_clock_expiry_before_any_start() {
        let mut s = setup(true); let m = message(&mut s, b"one", b"file.write", 3, 8); let r = prepare(&mut s, m, 1, false);
        let mut c = ts::take_shared<Clock>(&s); clock::set_for_testing(&mut c, 500); ts::return_shared(c); ts::next_tx(&mut s, @0xA);
        begin(&mut s, m, r, false); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9602, location = fractalmind_protocol::direct_agent)]
    fun changed_approving_device_grant_invalidates_one_off_start() {
        let mut s = setup(true); let m = message(&mut s, b"exception", b"file.write", 5, 9); approve(&mut s, m, true); let r = prepare(&mut s, m, 1, true);
        let human = ts::take_shared<HumanIdentity>(&s); let mut grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        identity::update_root_device_keys(&human, &mut grant, 1, b"replacement keys", &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::next_tx(&mut s, @0xA);
        begin(&mut s, m, r, true); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9602, location = fractalmind_protocol::direct_agent)]
    fun changed_workspace_ownership_invalidates_prior_write_approval() {
        let mut s = setup(true); activate(&mut s); let m = message(&mut s, b"write", b"file.write", 3, 8); approve(&mut s, m, true);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s); let mut o = ts::take_shared<Okr>(&s);
        okr::pause(&mut o, &mut org, &human, &grant, 2, 1, 1, body(), &c, ts::ctx(&mut s));
        let managed = ts::take_shared<ManagedAgent>(&s); let member = ts::take_shared<HostMembership>(&s);
        let (protected, revision, complete) = okr::direct_workspace_state(&org, object::id(&managed), host::membership_host_address(&member), bytes(7));
        assert!(!protected && revision == 3 && complete, 0);
        ts::return_shared(member); ts::return_shared(managed); ts::return_shared(o); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::next_tx(&mut s, @0xA);
        prepare(&mut s, m, 1, true); ts::end(s);
    }
}
