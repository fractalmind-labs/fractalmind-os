#[test_only]
module fractalmind_okr::agent_operator_writer_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::Clock;
    use std::string;
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::identity_tests;
    use fractalmind_protocol::organization::{Self, Organization, ProtocolRegistry};
    use fractalmind_okr::okr;

    fun body(): vector<u8> {
        let mut out = b"FME1"; let mut i = 0;
        while (i < 32) { vector::push_back(&mut out, 0); i = i + 1; }; out
    }
    fun draft(s: &mut Scenario): sui::object::ID {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s);
        let grant = ts::take_shared_by_id<DeviceGrant>(s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(s);
        let id = okr::create_draft_by_agent(&mut org, &human, &grant, string::utf8(b"agent-draft"), 0, 1000,
            vector[0], vector[2], vector[1], vector[100], 1, body(), &c, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); id
    }
    #[test]
    fun agent_operator_with_operate_creates_draft_only() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]);
        let id = draft(&mut s); ts::next_tx(&mut s, identity_tests::agent_operator_address());
        let created = ts::take_shared_by_id<okr::Okr>(&s, id); assert!(okr::state(&created) == 0, 0); ts::return_shared(created); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9001, location = fractalmind_protocol::identity)]
    fun read_only_agent_operator_cannot_create_draft() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action()]); let _ = draft(&mut s); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9411, location = fractalmind_okr::okr)]
    fun ordinary_device_cannot_use_agent_draft_writer() {
        let mut s = identity_tests::setup();
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let _ = okr::create_draft_by_agent(&mut org, &human, &grant, string::utf8(b"ordinary"), 0, 1000, vector[0], vector[2], vector[1], vector[100], 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9004, location = fractalmind_protocol::identity)]
    fun agent_operator_cannot_create_draft_in_another_organization() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]);
        ts::next_tx(&mut s, @0xA);
        let mut protocol = ts::take_shared<ProtocolRegistry>(&s); let mut human = ts::take_shared<HumanIdentity>(&s); let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]); let c = ts::take_shared<Clock>(&s);
        identity::create_organization(&mut protocol, &mut human, &root, string::utf8(b"Other agent org"), string::utf8(b""), &c, ts::ctx(&mut s));
        let other_id = identity::organizations(&human)[1];
        ts::return_shared(c); ts::return_shared(root); ts::return_shared(human); ts::return_shared(protocol);
        ts::next_tx(&mut s, identity_tests::agent_operator_address());
        let mut other = ts::take_shared_by_id<Organization>(&s, other_id); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        let _ = okr::create_draft_by_agent(&mut other, &human, &grant, string::utf8(b"other"), 0, 1000, vector[0], vector[2], vector[1], vector[100], 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(other); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9003, location = fractalmind_protocol::identity)]
    fun revoked_agent_operator_cannot_create_draft() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]);
        ts::next_tx(&mut s, @0xA);
        let human = ts::take_shared<HumanIdentity>(&s); let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]); let mut agent = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        identity::revoke_device(&human, &root, &mut agent, &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(agent); ts::return_shared(root); ts::return_shared(human);
        ts::next_tx(&mut s, identity_tests::agent_operator_address()); let _ = draft(&mut s); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9001, location = fractalmind_protocol::identity)]
    fun agent_created_draft_cannot_pass_the_activation_approval_gate() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]); let _ = draft(&mut s);
        ts::next_tx(&mut s, identity_tests::agent_operator_address());
        let org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        okr::assert_activation_approval_for_testing(&human, &grant, &org, &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
}
