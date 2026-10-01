#[test_only]
module fractalmind_protocol::identity_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use std::string;
    use std::option;
    use fractalmind_protocol::organization::{Self, ProtocolRegistry, Organization};
    use fractalmind_protocol::identity::{Self, IdentityRegistry, HumanIdentity, DeviceGrant, RecoveryRecord};

    const DESKTOP: address = @0xA;
    const PHONE: address = @0xB;
    const ATTACKER: address = @0xC;
    fun key(n: u8): vector<u8> {
        let mut out = vector[];
        let mut i = 0u64;
        while (i < 32) { vector::push_back(&mut out, n); i = i + 1; };
        out
    }
    fun recovery_address(): address { identity::signing_address(&key(1)) }
    fun setup(): Scenario {
        let mut s = ts::begin(recovery_address());
        organization::create_and_share_registry(ts::ctx(&mut s));
        let c = clock::create_for_testing(ts::ctx(&mut s));
        clock::share_for_testing(c);
        ts::next_tx(&mut s, recovery_address());
        let mut protocol = ts::take_shared<ProtocolRegistry>(&s);
        identity::initialize_registry(&mut protocol, ts::ctx(&mut s));
        ts::return_shared(protocol);
        ts::next_tx(&mut s, recovery_address());
        let mut registry = ts::take_shared<IdentityRegistry>(&s);
        let c = ts::take_shared<Clock>(&s);
        identity::create_identity(&mut registry, string::utf8(b"localnet"), key(1), key(2), b"backup", DESKTOP, key(3), b"desktop keys", &c, ts::ctx(&mut s));
        ts::return_shared(registry);
        ts::return_shared(c);
        ts::next_tx(&mut s, DESKTOP);
        let mut protocol = ts::take_shared<ProtocolRegistry>(&s);
        let mut human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s);
        let c = ts::take_shared<Clock>(&s);
        identity::create_organization(&mut protocol, &mut human, &grant, string::utf8(b"HumanOrg"), string::utf8(b"encrypted body"), &c, ts::ctx(&mut s));
        ts::return_shared(c);
        ts::return_shared(grant);
        ts::return_shared(human);
        ts::return_shared(protocol);
        ts::next_tx(&mut s, DESKTOP);
        s
    }
    fun add_phone(s: &mut Scenario) {
        let mut registry = ts::take_shared<IdentityRegistry>(s);
        let mut human = ts::take_shared<HumanIdentity>(s);
        let root = ts::take_shared_by_id<DeviceGrant>(s, identity::grants(&human)[0]);
        let org = ts::take_shared<Organization>(s);
        let c = ts::take_shared<Clock>(s);
        identity::add_read_device(&mut registry, &mut human, &root, &org, PHONE, key(4), b"phone keys", &c, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(org); ts::return_shared(root);
        ts::return_shared(human); ts::return_shared(registry);
    }
    fun recover(s: &mut Scenario) {
        let mut registry = ts::take_shared<IdentityRegistry>(s);
        let mut human = ts::take_shared<HumanIdentity>(s);
        let mut record = ts::take_shared_by_id<RecoveryRecord>(s, identity::recovery_record(&human));
        let c = ts::take_shared<Clock>(s);
        identity::recover_identity(&mut registry, &mut human, &mut record, key(5), key(6), b"new backup", PHONE, key(4), b"restored keys", &c, ts::ctx(s));
        ts::return_shared(c); ts::return_shared(record); ts::return_shared(human); ts::return_shared(registry);
    }

    #[test]
    fun default_device_scope_and_org_survive_recovery() {
        let mut s = setup();
        add_phone(&mut s);
        ts::next_tx(&mut s, PHONE);
        let human = ts::take_shared<HumanIdentity>(&s);
        let org = ts::take_shared<Organization>(&s);
        let phone = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]);
        let c = ts::take_shared<Clock>(&s);
        assert!(identity::grant_actions(&phone) == vector[identity::read_action()], 0);
        assert!(identity::grant_expiry(&phone) == 604800000, 1);
        assert!(identity::grant_scope(&phone) == option::some(organization::org_id(&org)), 2);
        identity::assert_can(&human, &phone, &org, identity::read_action(), &c, ts::ctx(&mut s));
        let stable_human = identity::human_address(&human);
        let stable_orgs = identity::organizations(&human);
        ts::return_shared(c); ts::return_shared(phone); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, recovery_address());
        recover(&mut s);
        ts::next_tx(&mut s, PHONE);
        let human = ts::take_shared<HumanIdentity>(&s);
        let org = ts::take_shared<Organization>(&s);
        let fresh = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[2]);
        let c = ts::take_shared<Clock>(&s);
        assert!(identity::human_address(&human) == stable_human, 3);
        assert!(identity::organizations(&human) == stable_orgs, 4);
        assert!(organization::admin(&org) == stable_human, 5);
        assert!(identity::generation(&human) == 2, 6);
        identity::assert_can(&human, &fresh, &org, identity::approve_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(fresh); ts::return_shared(human); ts::return_shared(org);
        ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9001, location = fractalmind_protocol::identity)]
    fun read_only_device_cannot_approve() {
        let mut s = setup(); add_phone(&mut s); ts::next_tx(&mut s, PHONE);
        let human = ts::take_shared<HumanIdentity>(&s); let org = ts::take_shared<Organization>(&s);
        let phone = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        identity::assert_can(&human, &phone, &org, identity::approve_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(phone); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9001, location = fractalmind_protocol::identity)]
    fun copied_grant_does_not_authorize_other_sender() {
        let mut s = setup(); ts::next_tx(&mut s, ATTACKER);
        let human = ts::take_shared<HumanIdentity>(&s); let org = ts::take_shared<Organization>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        identity::assert_can(&human, &grant, &org, identity::operate_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9003, location = fractalmind_protocol::identity)]
    fun old_desktop_rejected_after_recovery() {
        let mut s = setup(); ts::next_tx(&mut s, recovery_address()); recover(&mut s); ts::next_tx(&mut s, DESKTOP);
        let human = ts::take_shared<HumanIdentity>(&s); let org = ts::take_shared<Organization>(&s);
        let old = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]); let c = ts::take_shared<Clock>(&s);
        identity::assert_can(&human, &old, &org, identity::approve_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(old); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9003, location = fractalmind_protocol::identity)]
    fun independently_revoked_phone_rejected() {
        let mut s = setup(); add_phone(&mut s); ts::next_tx(&mut s, DESKTOP);
        let human = ts::take_shared<HumanIdentity>(&s);
        let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]);
        let mut phone = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        identity::revoke_device(&human, &root, &mut phone, &c, ts::ctx(&mut s));
        assert!(identity::grant_version(&phone) == 2, 0);
        identity::assert_grant(&human, &root, identity::approve_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(root); ts::return_shared(phone); ts::return_shared(human);
        ts::next_tx(&mut s, PHONE);
        let human = ts::take_shared<HumanIdentity>(&s); let phone = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let c = ts::take_shared<Clock>(&s);
        identity::assert_grant(&human, &phone, identity::read_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(phone); ts::return_shared(human); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9002, location = fractalmind_protocol::identity)]
    fun expiry_before_one_ms_and_exact_expiry() {
        let mut s = setup(); add_phone(&mut s); ts::next_tx(&mut s, PHONE);
        let human = ts::take_shared<HumanIdentity>(&s); let phone = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]); let mut c = ts::take_shared<Clock>(&s);
        clock::set_for_testing(&mut c, 604799999);
        identity::assert_grant(&human, &phone, identity::read_action(), &c, ts::ctx(&mut s));
        clock::set_for_testing(&mut c, 604800000);
        identity::assert_grant(&human, &phone, identity::read_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(phone); ts::return_shared(human); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9005, location = fractalmind_protocol::identity)]
    fun used_recovery_record_rejects_replay() {
        let mut s = setup();
        let human = ts::take_shared<HumanIdentity>(&s); let old_id = identity::recovery_record(&human); ts::return_shared(human);
        ts::next_tx(&mut s, recovery_address()); recover(&mut s);
        ts::next_tx(&mut s, recovery_address());
        let mut registry = ts::take_shared<IdentityRegistry>(&s); let mut human = ts::take_shared<HumanIdentity>(&s);
        let mut old = ts::take_shared_by_id<RecoveryRecord>(&s, old_id); let c = ts::take_shared<Clock>(&s);
        identity::recover_identity(&mut registry, &mut human, &mut old, key(7), key(8), b"replay", ATTACKER, key(9), b"replay keys", &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(old); ts::return_shared(human); ts::return_shared(registry); ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 9001, location = fractalmind_protocol::identity)]
    fun member_with_root_device_still_cannot_approve() {
        let mut s = setup();
        let owner = ts::take_shared<HumanIdentity>(&s); let owner_id = sui::object::id(&owner); ts::return_shared(owner);
        let member_recovery = identity::signing_address(&key(7));
        ts::next_tx(&mut s, member_recovery);
        let mut registry = ts::take_shared<IdentityRegistry>(&s); let c = ts::take_shared<Clock>(&s);
        identity::create_identity(&mut registry, string::utf8(b"localnet"), key(7), key(8), b"member backup", ATTACKER, key(9), b"member keys", &c, ts::ctx(&mut s));
        ts::return_shared(registry); ts::return_shared(c);
        ts::next_tx(&mut s, DESKTOP);
        let owner = ts::take_shared_by_id<HumanIdentity>(&s, owner_id);
        let mut member = ts::take_shared<HumanIdentity>(&s);
        let member_id = sui::object::id(&member);
        let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&owner)[0]);
        let org = ts::take_shared<Organization>(&s); let c = ts::take_shared<Clock>(&s);
        identity::set_member(&owner, &root, &org, &mut member, true, &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(org); ts::return_shared(root); ts::return_shared(owner); ts::return_shared(member);
        ts::next_tx(&mut s, ATTACKER);
        let member = ts::take_shared_by_id<HumanIdentity>(&s, member_id);
        let grant = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&member)[0]);
        let org = ts::take_shared<Organization>(&s); let c = ts::take_shared<Clock>(&s);
        identity::assert_can(&member, &grant, &org, identity::read_action(), &c, ts::ctx(&mut s));
        identity::assert_can(&member, &grant, &org, identity::approve_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(org); ts::return_shared(grant); ts::return_shared(member); ts::end(s);
    }

    #[test]
    #[expected_failure(abort_code = 9004, location = fractalmind_protocol::identity)]
    fun org_scoped_phone_cannot_read_another_org() {
        let mut s = setup(); add_phone(&mut s); ts::next_tx(&mut s, DESKTOP);
        let mut registry = ts::take_shared<ProtocolRegistry>(&s); let mut human = ts::take_shared<HumanIdentity>(&s);
        let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]); let c = ts::take_shared<Clock>(&s);
        identity::create_organization(&mut registry, &mut human, &root, string::utf8(b"OtherOrg"), string::utf8(b""), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(root); ts::return_shared(human); ts::return_shared(registry);
        ts::next_tx(&mut s, PHONE);
        let human = ts::take_shared<HumanIdentity>(&s); let phone = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[1]);
        let other = ts::take_shared<Organization>(&s); let c = ts::take_shared<Clock>(&s);
        identity::assert_can(&human, &phone, &other, identity::read_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(other); ts::return_shared(phone); ts::return_shared(human); ts::end(s);
    }

    #[test]
    fun replacing_code_keeps_devices_authorized() {
        let mut s = setup();
        let mut registry = ts::take_shared<IdentityRegistry>(&s); let mut human = ts::take_shared<HumanIdentity>(&s);
        let root = ts::take_shared_by_id<DeviceGrant>(&s, identity::grants(&human)[0]);
        let mut old = ts::take_shared_by_id<RecoveryRecord>(&s, identity::recovery_record(&human)); let c = ts::take_shared<Clock>(&s);
        identity::replace_recovery_code(&mut registry, &mut human, &root, &mut old, key(5), key(6), b"replacement backup", &c, ts::ctx(&mut s));
        assert!(identity::generation(&human) == 1, 0);
        identity::assert_grant(&human, &root, identity::approve_action(), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(old); ts::return_shared(root); ts::return_shared(human); ts::return_shared(registry); ts::end(s);
    }
}
