package nodecommand

import (
	"context"
	"encoding/binary"
	"errors"
	"reflect"
	"testing"
)

type snapshotBatchProbe struct {
	ids        []string
	objects    []ChainObject
	err        error
	single     int
	batchCalls int
}

type handoverClockProbe struct {
	*chainFixture
	clockReads int
	advance    int64
}

func (p *handoverClockProbe) ReadChainObject(ctx context.Context, id string) (ChainObject, error) {
	object, err := p.chainFixture.ReadChainObject(ctx, id)
	if id == addressNumber(6).String() && err == nil {
		p.clockReads++
		if p.clockReads > 1 {
			object.Content = append([]byte(nil), object.Content...)
			binary.LittleEndian.PutUint64(object.Content[32:], uint64(1700000000000+p.advance))
		}
	}
	return object, err
}

func TestHandoverFinalClockRecheckRejectsExpiryDuringNetworkReads(t *testing.T) {
	for _, advance := range []int64{1000, 31000} {
		f, command, run, proposal, _ := handoverChainFixture(t)
		probe := &handoverClockProbe{chainFixture: f, advance: advance}
		f.resolver.reader = probe
		result, err := f.resolver.InspectHandover(context.Background(), command, run, proposal)
		if probe.clockReads != 2 {
			t.Fatal("missing final chain clock read")
		}
		if advance == 1000 && (err != nil || result.ClockMS != 1700000001000) {
			t.Fatalf("fresh review did not retain final clock: %+v %v", result, err)
		}
		if advance == 31000 && err == nil {
			t.Fatal("review expiring during dependency reads was accepted")
		}
	}
}

func (p *snapshotBatchProbe) ReadChainObject(context.Context, string) (ChainObject, error) {
	p.single++
	return ChainObject{}, errors.New("individual fallback forbidden")
}
func (p *snapshotBatchProbe) ReadChainObjects(_ context.Context, ids []string) ([]ChainObject, error) {
	p.ids = append([]string(nil), ids...)
	p.batchCalls++
	return p.objects, p.err
}

func TestSnapshotBatchPreservesExactDependencyPin(t *testing.T) {
	probe := &snapshotBatchProbe{objects: []ChainObject{{ID: "a", Version: 3}, {ID: "b", Version: 4}}}
	r := &chainRead{resolver: &ChainAuthorityResolver{reader: probe}, versions: map[string]uint64{"b": 4, "a": 3}}
	pin, err := r.versionPin(context.Background(), errors.New("changed"))
	if err != nil || pin != hashBytes([]byte("a:3;b:4;")) || !reflect.DeepEqual(probe.ids, []string{"a", "b"}) || probe.batchCalls != 1 || probe.single != 0 {
		t.Fatalf("dependency pin or batch coverage changed: %q %+v %v", pin, probe, err)
	}
}

func TestSnapshotBatchRejectsChangedOrIncompleteDependenciesWithoutFallback(t *testing.T) {
	changed := errors.New("authority changed")
	for _, name := range []string{"missing", "reordered", "duplicate", "version", "unavailable"} {
		t.Run(name, func(t *testing.T) {
			probe := &snapshotBatchProbe{objects: []ChainObject{{ID: "a", Version: 3}, {ID: "b", Version: 4}}}
			switch name {
			case "missing":
				probe.objects = probe.objects[:1]
			case "reordered":
				probe.objects[0], probe.objects[1] = probe.objects[1], probe.objects[0]
			case "duplicate":
				probe.objects[1] = probe.objects[0]
			case "version":
				probe.objects[1].Version++
			case "unavailable":
				probe.err = errors.New("RPC unavailable")
			}
			r := &chainRead{resolver: &ChainAuthorityResolver{reader: probe}, versions: map[string]uint64{"a": 3, "b": 4}}
			pin, err := r.versionPin(context.Background(), changed)
			if err == nil || pin != "" || probe.single != 0 || probe.batchCalls != 1 {
				t.Fatalf("failed batch admitted or individually retried: %q %+v %v", pin, probe, err)
			}
			if name == "version" && !errors.Is(err, changed) {
				t.Fatal("lost authority-change rejection")
			}
		})
	}
}

type authorityBatchFixture struct {
	*chainFixture
	batches int
}

func (p *authorityBatchFixture) ReadChainObjects(ctx context.Context, ids []string) ([]ChainObject, error) {
	p.batches++
	objects := make([]ChainObject, 0, len(ids))
	for _, id := range ids {
		object, err := p.chainFixture.ReadChainObject(ctx, id)
		if err != nil {
			return nil, err
		}
		objects = append(objects, object)
	}
	return objects, nil
}

func TestBatchedAuthorityRetainsSerialProofAndDetectsRevocationRace(t *testing.T) {
	serial := newChainFixture(t)
	want, err := serial.resolver.Resolve(context.Background(), CapabilityRef{ID: serial.cap.ID.String(), RevocationVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	batched := newChainFixture(t)
	probe := &authorityBatchFixture{chainFixture: batched}
	batched.resolver.reader = probe
	got, err := batched.resolver.Resolve(context.Background(), CapabilityRef{ID: batched.cap.ID.String(), RevocationVersion: 1})
	if err != nil || !reflect.DeepEqual(got, want) || probe.batches != 2 {
		t.Fatalf("authority proof changed: %v, batches %d", err, probe.batches)
	}
	// Reuse the same resolver, but mutate the granted device after its first
	// snapshot. No prefetched state may survive the original call or its recheck.
	batched.reads = make(map[string]int)
	batched.changeOnRead = batched.grant.ID.String()
	_, err = batched.resolver.Resolve(context.Background(), CapabilityRef{ID: batched.cap.ID.String(), RevocationVersion: 1})
	if CodeOf(err) != CodeAuthorityStale {
		t.Fatalf("changed device authority admitted: %v", err)
	}
}
