#[test_only]
module fractalmind_okr::okr_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::Clock;
    use std::string;
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::identity::{HumanIdentity, DeviceGrant};
    use fractalmind_protocol::identity_tests;
    use fractalmind_okr::okr::{Self, Okr};

    fun body(): vector<u8> {
        let mut out = b"FME1"; let mut i = 0;
        while (i < 32) { vector::push_back(&mut out, 0); i = i + 1; }; out
    }
    fun create(s: &mut Scenario, baseline: u64, target: u64, weight: u64, age: u64): sui::object::ID {
        let mut org = ts::take_shared<Organization>(s); let human = ts::take_shared<HumanIdentity>(s);
        let grant = ts::take_shared<DeviceGrant>(s); let c = ts::take_shared<Clock>(s);
        let id = okr::create_draft(&mut org, &human, &grant, string::utf8(b"test-okr"), 0, 1000,
            vector[baseline], vector[target], vector[weight], vector[age], 1, body(), &c, ts::ctx(s));
        assert!(okr::active_count(&org) == 0, 0);
        ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); id
    }
    #[test]
    fun exact_draft_retry_and_draft_spec_revision() {
        let mut s = identity_tests::setup();
        let id = create(&mut s, 10, 2, 1, 100);
        ts::next_tx(&mut s, @0xA);
        assert!(create(&mut s, 10, 2, 1, 100) == id, 1);
        ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s);
        let mut draft = ts::take_shared<Okr>(&s);
        assert!(okr::state(&draft) == 0 && okr::version(&draft) == 1, 2);
        okr::replace_spec(&mut draft, &mut org, &human, &grant, 1, 1, 2000,
            vector[0], vector[3], vector[2], vector[200], 1, body(), &c, ts::ctx(&mut s));
        assert!(okr::version(&draft) == 2 && okr::agreement_version(&draft) == 1 && okr::next_kr(&draft) == 0, 3);
        okr::archive(&mut draft, &mut org, &human, &grant, 2, &c, ts::ctx(&mut s));
        assert!(okr::state(&draft) == 4 && okr::active_count(&org) == 0, 4);
        ts::return_shared(draft); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9401, location = fractalmind_okr::okr)]
    fun equal_baseline_target_rejected() { let mut s = identity_tests::setup(); create(&mut s, 3, 3, 1, 100); ts::end(s); }
    #[test]
    #[expected_failure(abort_code = 9401, location = fractalmind_okr::okr)]
    fun zero_weight_rejected() { let mut s = identity_tests::setup(); create(&mut s, 0, 3, 0, 100); ts::end(s); }
    #[test]
    #[expected_failure(abort_code = 9401, location = fractalmind_okr::okr)]
    fun unbounded_observation_age_rejected() { let mut s = identity_tests::setup(); create(&mut s, 0, 3, 1, 2592000001); ts::end(s); }
    #[test]
    #[expected_failure(abort_code = 9402, location = fractalmind_okr::okr)]
    fun conflicting_draft_retry_rejected() {
        let mut s = identity_tests::setup(); create(&mut s, 0, 3, 1, 100);
        ts::next_tx(&mut s, @0xA); create(&mut s, 0, 2, 1, 100); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9001, location = fractalmind_protocol::identity)]
    fun copied_device_grant_cannot_create_draft() {
        let mut s = identity_tests::setup(); ts::next_tx(&mut s, @0xB); create(&mut s, 0, 3, 1, 100); ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code = 9403, location = fractalmind_okr::okr)]
    fun unactivated_draft_cannot_be_verified() {
        let mut s = identity_tests::setup(); create(&mut s, 0, 3, 1, 100); ts::next_tx(&mut s, @0xA);
        let mut org = ts::take_shared<Organization>(&s); let human = ts::take_shared<HumanIdentity>(&s);
        let grant = ts::take_shared<DeviceGrant>(&s); let c = ts::take_shared<Clock>(&s); let mut draft = ts::take_shared<Okr>(&s);
        okr::verify_kr(&mut draft, &mut org, &human, &grant, 1, 0, 0, 1, body(), &c, ts::ctx(&mut s));
        ts::return_shared(draft); ts::return_shared(c); ts::return_shared(grant); ts::return_shared(human); ts::return_shared(org); ts::end(s);
    }
}
