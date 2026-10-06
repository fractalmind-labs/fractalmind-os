#[test_only]
module fractalmind_protocol::command_delivery_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use std::string;
    use fractalmind_protocol::identity_tests;
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::remote_authority::RemoteCapability;
    use fractalmind_protocol::node_execution::{Self as execution, CommandExecution};

    fun bytes(n: u8): vector<u8> { let mut out = vector[]; let mut i = 0; while (i < 32) { vector::push_back(&mut out, n); i = i + 1; }; out }
    fun body(n: u8): vector<u8> { let mut out=b"FME3";vector::append(&mut out,bytes(n));out }
    fun setup(): Scenario {
        let mut s=identity_tests::setup();
        let mut org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let mut c=ts::take_shared<Clock>(&s);
        clock::set_for_testing(&mut c,1);
        host::create_coordinator_binding(&mut org,&human,&grant,bytes(9),string::utf8(b"https://unit.invalid"),&c,ts::ctx(&mut s));
        ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let mut org=ts::take_shared<Organization>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);
        // Admitted test state does not prove a real Host invite signature.
        host::admitted_member_for_testing(&mut org,&binding,bytes(5),&c,ts::ctx(&mut s));
        ts::return_shared(binding);ts::return_shared(c);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let mut org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);let member=ts::take_shared<HostMembership>(&s);
        host::import_agent(&mut org,&human,&grant,&member,&binding,string::utf8(b"native-fixture"),string::utf8(b"bounded-process-v1"),bytes(7),false,&c,ts::ctx(&mut s));
        ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);let member=ts::take_shared<HostMembership>(&s);let managed=ts::take_shared<ManagedAgent>(&s);
        host::issue_agent_capability(&org,&human,&grant,&member,&binding,&managed,vector[string::utf8(b"status")],string::utf8(b"observation"),1,string::utf8(b""),0,1000,&c,ts::ctx(&mut s));
        ts::return_shared(managed);ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let mut org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);let member=ts::take_shared<HostMembership>(&s);let managed=ts::take_shared<ManagedAgent>(&s);let mut cap=ts::take_shared<RemoteCapability>(&s);
        let mut wrapped = b"FMW1"; vector::append(&mut wrapped, bytes(0)); vector::append(&mut wrapped, bytes(0)); vector::append(&mut wrapped, b"FME1"); let mut i = 0; while (i < 60) { vector::push_back(&mut wrapped, 0); i = i + 1; };
        execution::grant_result_key(&mut cap,&org,&human,&grant,&member,&binding,bytes(8),1,wrapped,&c,ts::ctx(&mut s));
        execution::prepare_agent_command_v2(&mut cap,&mut org,&human,&grant,&member,&binding,&managed,string::utf8(b"status"),string::utf8(b"observation"),string::utf8(b"original"),string::utf8(b"nonce"),string::utf8(b"original"),string::utf8(b""),0,bytes(8),1,500,&c,ts::ctx(&mut s));
        ts::return_shared(cap);ts::return_shared(managed);ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);s
    }
    fun queue(s:&mut Scenario,n:u8,now:u64) {
        let mut org=ts::take_shared<Organization>(s);let human=ts::take_shared<HumanIdentity>(s);let grant=ts::take_shared<DeviceGrant>(s);let mut c=ts::take_shared<Clock>(s);clock::set_for_testing(&mut c,now);
        let binding=ts::take_shared<CoordinatorBinding>(s);let member=ts::take_shared<HostMembership>(s);let managed=ts::take_shared<ManagedAgent>(s);let cap=ts::take_shared<RemoteCapability>(s);let mut run=ts::take_shared<CommandExecution>(s);
        execution::queue_command(&mut run,&cap,&mut org,&human,&grant,&member,&binding,&managed,1,body(n),&c,ts::ctx(s));
        assert!(execution::has_command_delivery(&run) && execution::host_command_queue_size(&org,host::membership_host_address(&member))==1,0);
        ts::return_shared(run);ts::return_shared(cap);ts::return_shared(managed);ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);
    }
    #[test]
    fun preparation_does_not_send_and_exact_delivery_is_idempotent() {
        let mut s=setup();let run=ts::take_shared<CommandExecution>(&s);assert!(!execution::has_command_delivery(&run),0);ts::return_shared(run);ts::next_tx(&mut s,@0xA);
        queue(&mut s,0,1);ts::next_tx(&mut s,@0xA);queue(&mut s,0,2);ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code=9313,location=fractalmind_protocol::node_execution)]
    fun published_ciphertext_cannot_be_replaced() {let mut s=setup();queue(&mut s,0,1);ts::next_tx(&mut s,@0xA);queue(&mut s,1,2);ts::end(s);}
    #[test]
    #[expected_failure(abort_code=9303,location=fractalmind_protocol::node_execution)]
    fun original_command_exact_expiry_cannot_be_extended_by_delivery() {let mut s=setup();queue(&mut s,0,500);ts::end(s);}
    #[test]
    #[expected_failure(abort_code=9302,location=fractalmind_protocol::node_execution)]
    fun host_cannot_replace_human_delivery_authorization() {let mut s=setup();ts::next_tx(&mut s,identity::signing_address(&bytes(5)));queue(&mut s,0,1);ts::end(s);}
}
