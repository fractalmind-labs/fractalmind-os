package nodecommand

import (
	"context"
	"testing"
)

func TestOkrObservationSnapshotRetainsVerifiedHistoricalMeasurement(t *testing.T) {
	f, okr, budget, binding := contractFixture(t)
	sample := uint64(1)
	okr.Metrics[0].Current = []uint64{sample}
	okr.Metrics[0].Sampled = 99
	okr.Metrics[0].Run = []moveAddress{addressNumber(24)}
	okr.Metrics[0].Evidence = []moveAddress{addressNumber(25)}
	okr.Metrics[0].Verified = true
	okr.NextKR = 1
	saveContractFixture(t, f, okr, budget, binding)
	run := ChainExecution{Contract: &ExecutionContractAuthority{ID: okr.ID.String(), AgreementVersion: 1, KRIndex: 0}, Target: Target{OrganizationID: okr.Org.String()}}
	state, err := f.resolver.ReadOkrObservationState(context.Background(), run)
	if err != nil || state.Current == nil || *state.Current != 1 || !state.Verified || state.KRIndex != 1 || state.RunID != addressNumber(24).String() {
		t.Fatalf("historical measurement: %+v %v", state, err)
	}
	// Replanning may remove an old KR. That makes a historical measurement
	// superseded rather than making the successful Run unreadable.
	okr.Agreement = 2
	saveContractFixture(t, f, okr, budget, binding)
	run.Contract.KRIndex = 1
	state, err = f.resolver.ReadOkrObservationState(context.Background(), run)
	if err != nil || state.AgreementVersion != 2 || state.Current != nil {
		t.Fatal("removed historical KR was not retained as superseded")
	}
	object := f.objects[okr.ID.String()]
	object.Shared = false
	f.objects[object.ID] = object
	if _, err = f.resolver.ReadOkrObservationState(context.Background(), run); err == nil {
		t.Fatal("non-shared source accepted")
	}
}
