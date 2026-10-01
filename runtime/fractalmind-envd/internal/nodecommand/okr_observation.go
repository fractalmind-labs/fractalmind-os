package nodecommand

import (
	"context"
	"fmt"
)

// OkrObservationState is a read-only snapshot for publishing a completed
// native measurement. It grants neither execution nor KR verification.
type OkrObservationState struct {
	ID, OrganizationID, MembershipID, BindingID, ManagedAgentID string
	State                                                       uint8
	Version, AgreementVersion, KRIndex                          uint64
	Baseline, Target, MaxAgeMS, SampledAtMS                     uint64
	Current                                                     *uint64
	RunID, EvidenceID                                           string
	Verified                                                    bool
}

func (s *ChainAuthorityResolver) ReadOkrObservationState(ctx context.Context, run ChainExecution) (OkrObservationState, error) {
	var out OkrObservationState
	if run.Contract == nil {
		return out, fmt.Errorf("OKR-bound Run required")
	}
	r := &chainRead{resolver: s, versions: map[string]uint64{}}
	var okr moveOkr
	if err := r.object(ctx, run.Contract.ID, "okr::Okr", &okr); err != nil {
		return out, err
	}
	if okr.Org.String() != run.Target.OrganizationID || len(okr.Metrics) < 1 || len(okr.Metrics) > 3 || okr.State > 4 || okr.Version == 0 || len(okr.Managed) != 1 || len(okr.Membership) != 1 || uint64(run.Contract.KRIndex) >= 3 {
		return out, fmt.Errorf("invalid observation OKR scope or layout")
	}
	// Historical results may belong to a replaced assignment. They remain
	// readable, but this snapshot cannot authorize a new observation for them.
	out = OkrObservationState{ID: okr.ID.String(), OrganizationID: okr.Org.String(), State: okr.State, Version: okr.Version, AgreementVersion: okr.Agreement, KRIndex: okr.NextKR, MembershipID: okr.Membership[0].String(), ManagedAgentID: okr.Managed[0].String()}
	var member moveMembership
	if err := r.object(ctx, out.MembershipID, "host::HostMembership", &member); err != nil {
		return out, err
	}
	if member.Org != okr.Org {
		return out, fmt.Errorf("observation membership scope mismatch")
	}
	out.BindingID = member.Binding.String()
	var metric moveOkrMetric
	if uint64(run.Contract.KRIndex) < uint64(len(okr.Metrics)) {
		metric = okr.Metrics[uint64(run.Contract.KRIndex)]
	} else if okr.Agreement == uint64(run.Contract.AgreementVersion) {
		return out, fmt.Errorf("current agreement is missing the command KR")
	}
	if len(metric.Current) > 1 || len(metric.Run) > 1 || len(metric.Evidence) > 1 {
		return out, fmt.Errorf("invalid metric option layout")
	}
	out.Baseline, out.Target, out.MaxAgeMS, out.SampledAtMS, out.Verified = metric.Baseline, metric.Target, metric.MaxAge, metric.Sampled, metric.Verified
	if len(metric.Current) == 1 {
		value := metric.Current[0]
		out.Current = &value
	}
	if len(metric.Run) == 1 {
		out.RunID = metric.Run[0].String()
	}
	if len(metric.Evidence) == 1 {
		out.EvidenceID = metric.Evidence[0].String()
	}
	for id, version := range r.versions {
		object, err := s.reader.ReadChainObject(ctx, id)
		if err != nil {
			return out, err
		}
		if object.ID != id || object.Version != version {
			return out, reject(CodeAuthorityStale, "observation state changed during read", nil)
		}
	}
	return out, nil
}
