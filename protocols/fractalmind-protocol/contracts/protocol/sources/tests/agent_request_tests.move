#[test_only]
module fractalmind_protocol::agent_request_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::Clock;
    use std::string;
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::identity_tests;
    use fractalmind_protocol::organization::{Organization, ProtocolRegistry};
    use fractalmind_protocol::product_record::{Self, EncryptedRecord};

    fun body(): vector<u8> {
        let mut out = b"FME1"; let mut i = 0;
        while (i < 32) { vector::push_back(&mut out, 0); i = i + 1; }; out
    }
    fun save(s: &mut Scenario, kind: u8, logical_id: vector<u8>, revision: u64): sui::object::ID {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s);
        let grant = ts::take_shared_by_id<DeviceGrant>(s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(s);
        let id = product_record::save_agent_request(&mut org, &human, &grant, kind, string::utf8(logical_id), revision, 1, body(), &c, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); id
    }
    #[test]
    fun operate_agent_files_an_attributed_approval_request() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]);
        let id = save(&mut s, 3, b"agent-request:archive:one", 0); ts::next_tx(&mut s, identity_tests::agent_operator_address());
        let human = ts::take_shared<HumanIdentity>(&s); let agent_id = identity::grants(&human)[1];
        let record = ts::take_immutable_by_id<EncryptedRecord>(&s, id);
        assert!(product_record::record_grant_id(&record) == agent_id, 0);
        ts::return_immutable(record); ts::return_shared(human); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9001, location = fractalmind_protocol::identity)]
    fun read_only_agent_cannot_file_an_approval_request() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action()]); let _ = save(&mut s, 3, b"agent-request:pause:one", 0); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9101, location = fractalmind_protocol::product_record)]
    fun ordinary_device_cannot_use_agent_request_writer() {
        let mut s = identity_tests::setup();
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let _ = product_record::save_agent_request(&mut org, &human, &grant, 3, string::utf8(b"agent-request:ordinary"), 0, 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9101, location = fractalmind_protocol::product_record)]
    fun agent_request_rejects_wrong_kind() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]); let _ = save(&mut s, 1, b"agent-request:wrong-kind", 0); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9101, location = fractalmind_protocol::product_record)]
    fun agent_request_rejects_wrong_prefix_and_cannot_overwrite_human_record() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]);
        ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s); let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]); let c = ts::take_shared<Clock>(&s);
        product_record::save(&mut org, &human, &root, 3, string::utf8(b"human-approval"), 0, 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(root); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, identity_tests::agent_operator_address()); let _ = save(&mut s, 3, b"human-approval", 1); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9004, location = fractalmind_protocol::identity)]
    fun agent_request_rejects_another_organization() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]);
        ts::next_tx(&mut s, @0xA);
        let mut protocol = ts::take_shared<ProtocolRegistry>(&s); let mut human = ts::take_shared<HumanIdentity>(&s); let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]); let c = ts::take_shared<Clock>(&s);
        identity::create_organization(&mut protocol, &mut human, &root, string::utf8(b"Second org"), string::utf8(b""), &c, ts::ctx(&mut s));
        let other_id = identity::organizations(&human)[1]; ts::return_shared(c); ts::return_shared(root); ts::return_shared(human); ts::return_shared(protocol);
        ts::next_tx(&mut s, identity_tests::agent_operator_address());
        let mut other = ts::take_shared_by_id<Organization>(&s, other_id); let human = ts::take_shared<HumanIdentity>(&s); let grant = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        let _ = product_record::save_agent_request(&mut other, &human, &grant, 3, string::utf8(b"agent-request:other"), 0, 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(other); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9003, location = fractalmind_protocol::identity)]
    fun revoked_agent_cannot_file_an_approval_request() {
        let mut s = identity_tests::agent_operator(vector[identity::read_action(), identity::operate_action()]);
        ts::next_tx(&mut s, @0xA);
        let human = ts::take_shared<HumanIdentity>(&s); let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]); let mut agent = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        identity::revoke_device(&human, &root, &mut agent, &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(agent); ts::return_shared(root); ts::return_shared(human);
        ts::next_tx(&mut s, identity_tests::agent_operator_address()); let _ = save(&mut s, 3, b"agent-request:revoked", 0); ts::end(s);
    }
}
