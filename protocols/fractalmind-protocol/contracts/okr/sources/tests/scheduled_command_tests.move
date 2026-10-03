#[test_only]
module fractalmind_okr::scheduled_command_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use std::string;
    use fractalmind_protocol::identity_tests;
    use fractalmind_protocol::identity::{Self, HumanIdentity, DeviceGrant};
    use fractalmind_protocol::organization::Organization;
    use fractalmind_protocol::host::{Self, HostMembership, CoordinatorBinding, ManagedAgent};
    use fractalmind_protocol::remote_authority::RemoteCapability;
    use fractalmind_protocol::node_execution::{Self as execution, CommandExecution};
    use fractalmind_okr::okr::{Self, Okr};

    fun bytes(n:u8):vector<u8>{let mut out=vector[];let mut i=0;while(i < 32){vector::push_back(&mut out,n);i=i+1;};out}
    fun body():vector<u8>{let mut out=b"FME1";vector::append(&mut out,bytes(0));out}
    fun setup():Scenario {
        let mut s=identity_tests::setup();
        let mut org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let mut c=ts::take_shared<Clock>(&s);clock::set_for_testing(&mut c,1);
        host::create_coordinator_binding(&mut org,&human,&grant,bytes(9),string::utf8(b"https://unit.invalid"),&c,ts::ctx(&mut s));
        let _=okr::create_draft(&mut org,&human,&grant,string::utf8(b"schedule"),0,10000,vector[0,0],vector[1,1],vector[1,1],vector[1000,1000],1,body(),&c,ts::ctx(&mut s));
        ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let mut org=ts::take_shared<Organization>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);
        // Signature/adoption fixtures only; real admission is a localnet gate.
        host::admitted_member_for_testing(&mut org,&binding,bytes(5),&c,ts::ctx(&mut s));
        ts::return_shared(binding);ts::return_shared(c);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let mut org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);let member=ts::take_shared<HostMembership>(&s);
        host::import_agent(&mut org,&human,&grant,&member,&binding,string::utf8(b"native-fixture"),string::utf8(b"bounded-process-v1"),bytes(7),false,&c,ts::ctx(&mut s));
        ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let mut org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);let member=ts::take_shared<HostMembership>(&s);let mut managed=ts::take_shared<ManagedAgent>(&s);let mut goal=ts::take_shared<Okr>(&s);
        host::confirm_reviewed_control_for_testing(&mut org,&human,&grant,&member,&binding,&mut managed,1,bytes(7),&c,ts::ctx(&mut s));
        okr::activate_reviewed_for_testing(&mut goal,&mut org,&human,&grant,&member,&binding,&managed,1,bytes(7),bytes(8),string::utf8(b"TOOL_CALLS"),5,5000,0,1,body(),&c,ts::ctx(&mut s));
        okr::record_handover_policy(&mut goal,3,bytes(2),bytes(3),sui::object::id_from_address(@0x123));
        ts::return_shared(goal);ts::return_shared(managed);ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);
        let org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);let member=ts::take_shared<HostMembership>(&s);let managed=ts::take_shared<ManagedAgent>(&s);let goal=ts::take_shared<Okr>(&s);
        okr::issue_capability(&goal,&org,&human,&grant,&member,&binding,&managed,2,1,&c,ts::ctx(&mut s));
        ts::return_shared(goal);ts::return_shared(managed);ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::next_tx(&mut s,@0xA);s
    }
    fun prepare(s:&mut Scenario,scheduled:bool,index:u64,amount:u64) {
        let mut org=ts::take_shared<Organization>(s);let human=ts::take_shared<HumanIdentity>(s);let grant=ts::take_shared<DeviceGrant>(s);let c=ts::take_shared<Clock>(s);let binding=ts::take_shared<CoordinatorBinding>(s);let member=ts::take_shared<HostMembership>(s);let managed=ts::take_shared<ManagedAgent>(s);let mut cap=ts::take_shared<RemoteCapability>(s);let mut goal=ts::take_shared<Okr>(s);
        let mut wrapped=b"FMW1";vector::append(&mut wrapped,bytes(0));vector::append(&mut wrapped,bytes(0));vector::append(&mut wrapped,b"FME1");let mut i=0;while(i < 60){vector::push_back(&mut wrapped,0);i=i+1;};
        execution::grant_result_key(&mut cap,&org,&human,&grant,&member,&binding,bytes(6),1,wrapped,&c,ts::ctx(s));
        if(scheduled) okr::prepare_scheduled_command_v2(&mut goal,&mut cap,&mut org,&human,&grant,&member,&binding,&managed,1,index,string::utf8(b"assign"),string::utf8(b"control"),string::utf8(b"future"),string::utf8(b"nonce"),string::utf8(b"future"),string::utf8(b"TOOL_CALLS"),amount,bytes(6),1,500,&c,ts::ctx(s))
        else okr::prepare_command_v2(&mut goal,&mut cap,&mut org,&human,&grant,&member,&binding,&managed,1,index,string::utf8(b"assign"),string::utf8(b"control"),string::utf8(b"future"),string::utf8(b"nonce"),string::utf8(b"future"),string::utf8(b"TOOL_CALLS"),amount,bytes(6),1,500,&c,ts::ctx(s));
        assert!(okr::next_kr(&goal)==0,0);
        let(spent,reserved)=okr::budget_totals_for_testing(&goal);assert!(spent==0&&reserved==amount,1);
        ts::return_shared(goal);ts::return_shared(cap);ts::return_shared(managed);ts::return_shared(member);ts::return_shared(binding);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);
    }
    #[test]
    fun advance_reservation_is_idempotent_and_original_cancel_refunds_it() {
        let mut s=setup();prepare(&mut s,true,1,3);ts::next_tx(&mut s,@0xA);prepare(&mut s,true,1,3);ts::next_tx(&mut s,@0xA);
        let mut org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let mut cap=ts::take_shared<RemoteCapability>(&s);let mut goal=ts::take_shared<Okr>(&s);let mut run=ts::take_shared<CommandExecution>(&s);
        okr::request_stop_v2(&mut goal,&mut run,&mut cap,&mut org,&human,&grant,&c,ts::ctx(&mut s));
        let(spent,reserved)=okr::budget_totals_for_testing(&goal);assert!(spent==0&&reserved==0&&execution::state(&run)==5&&okr::next_kr(&goal)==0,2);
        ts::return_shared(run);ts::return_shared(goal);ts::return_shared(cap);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::end(s);
    }
    #[test]
    #[expected_failure(abort_code=9406,location=fractalmind_okr::okr)]
    fun ordinary_preparation_cannot_target_a_future_kr(){let mut s=setup();prepare(&mut s,false,1,3);ts::end(s);}
    #[test]
    #[expected_failure(abort_code=9406,location=fractalmind_okr::okr)]
    fun missing_future_kr_is_rejected(){let mut s=setup();prepare(&mut s,true,2,3);ts::end(s);}
    #[test]
    #[expected_failure(abort_code=9409,location=fractalmind_okr::okr)]
    fun advance_preparation_cannot_exceed_total_budget(){let mut s=setup();prepare(&mut s,true,1,6);ts::end(s);}
    #[test]
    #[expected_failure(abort_code=9409,location=fractalmind_okr::okr)]
    fun host_cannot_start_a_future_kr_before_human_advances_cursor(){
        let mut s=setup();prepare(&mut s,true,1,3);ts::next_tx(&mut s,identity::signing_address(&bytes(5)));
        let org=ts::take_shared<Organization>(&s);let human=ts::take_shared<HumanIdentity>(&s);let grant=ts::take_shared<DeviceGrant>(&s);let c=ts::take_shared<Clock>(&s);let cap=ts::take_shared<RemoteCapability>(&s);let goal=ts::take_shared<Okr>(&s);let member=ts::take_shared<HostMembership>(&s);let binding=ts::take_shared<CoordinatorBinding>(&s);let managed=ts::take_shared<ManagedAgent>(&s);let mut run=ts::take_shared<CommandExecution>(&s);
        okr::begin_command(&goal,&mut run,&cap,&org,&human,&grant,&member,&binding,&managed,bytes(1),&c,ts::ctx(&mut s));
        ts::return_shared(run);ts::return_shared(managed);ts::return_shared(binding);ts::return_shared(member);ts::return_shared(goal);ts::return_shared(cap);ts::return_shared(c);ts::return_shared(grant);ts::return_shared(human);ts::return_shared(org);ts::end(s);
    }
}
