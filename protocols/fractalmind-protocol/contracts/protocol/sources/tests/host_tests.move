#[test_only]
module fractalmind_protocol::host_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use std::string;
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::host::{Self, CoordinatorBinding, HostInvite};
    use fractalmind_protocol::identity_tests;

    const DESKTOP: address = @0xA;
    fun key(n: u8): vector<u8> {
        let mut bytes = vector[]; let mut i = 0u64;
        while (i < 32) { vector::push_back(&mut bytes, n); i = i + 1; };
        bytes
    }
    fun setup(): Scenario {
        let mut s = identity_tests::setup();
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        host::create_coordinator_binding(&mut org, &human, &grant, key(9), string::utf8(b"https://entry.example.invalid"), &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, DESKTOP);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let binding = ts::take_shared<CoordinatorBinding>(&s);
        host::create_invite(&mut org, &human, &grant, &binding, key(7), 1000, 86400000, 3600000, &c, ts::ctx(&mut s));
        ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, identity::signing_address(&key(5)));
        s
    }
    fun attempt(s: &mut Scenario, now: u64) {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s);
        let grant = ts::take_shared<DeviceGrant>(s); let mut c = ts::take_shared<Clock>(s);
        let binding = ts::take_shared<CoordinatorBinding>(s); let mut invite = ts::take_shared<HostInvite>(s);
        clock::set_for_testing(&mut c, now);
        // An invalid proof must be reached before expiry, but must never be
        // considered at or after expiry. Positive signatures use real-chain SDK.
        host::redeem_invite(&mut org, &mut invite, &binding, &human, &grant, key(5), key(6), string::utf8(b"Host"), 1000, vector[], &c, ts::ctx(s));
        ts::return_shared(invite); ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
    }
    #[test]
    #[expected_failure(abort_code = 9205, location = fractalmind_protocol::host)]
    fun one_ms_before_expiry_reaches_proof_verification() {
        let mut s = setup(); attempt(&mut s, 999); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9202, location = fractalmind_protocol::host)]
    fun exactly_at_expiry_rejected_in_same_epoch() {
        let mut s = setup(); attempt(&mut s, 1000); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9202, location = fractalmind_protocol::host)]
    fun one_ms_after_expiry_rejected_in_same_epoch() {
        let mut s = setup(); attempt(&mut s, 1001); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9203, location = fractalmind_protocol::host)]
    fun revoked_binding_invalidates_pending_invite() {
        let mut s = setup(); ts::next_tx(&mut s, DESKTOP);
        let org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let mut binding = ts::take_shared<CoordinatorBinding>(&s);
        host::revoke_coordinator_binding(&org, &human, &grant, &mut binding, &c, ts::ctx(&mut s));
        ts::return_shared(binding); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, identity::signing_address(&key(5))); attempt(&mut s, 999); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9206, location = fractalmind_protocol::host)]
    fun changed_issuer_grant_version_invalidates_invite() {
        let mut s = setup(); ts::next_tx(&mut s, DESKTOP);
        let human = ts::take_shared<HumanIdentity>(&s); let mut grant = ts::take_shared<DeviceGrant>(&s);
        let c = ts::take_shared<Clock>(&s);
        identity::update_root_device_keys(&human, &mut grant, 1, b"new keys", &c, ts::ctx(&mut s));
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human);
        ts::next_tx(&mut s, identity::signing_address(&key(5))); attempt(&mut s, 999); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9203, location = fractalmind_protocol::host)]
    fun revoked_invite_rejected_before_proof() {
        let mut s = setup(); ts::next_tx(&mut s, DESKTOP);
        let org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let mut invite = ts::take_shared<HostInvite>(&s);
        host::revoke_invite(&org, &human, &grant, &mut invite, &c, ts::ctx(&mut s));
        ts::return_shared(invite); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org);
        ts::next_tx(&mut s, identity::signing_address(&key(5))); attempt(&mut s, 999); ts::end(s);
    }
}
