package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"reflect"
	"testing"
)

// Count transport round trips, not objects within one batch. Fault injection
// changes transport responses; all production typed decoders still run.
type directBatchProbe struct {
	*chainFixture
	singles, batches int
	faultID, fault   string
	faultSeen        bool
	fallback         bool
}

func (p *directBatchProbe) ReadChainObject(ctx context.Context, id string) (ChainObject, error) {
	p.singles++
	if p.faultSeen {
		p.fallback = true
	}
	return p.chainFixture.ReadChainObject(ctx, id)
}

func (p *directBatchProbe) ReadChainObjects(ctx context.Context, ids []string) ([]ChainObject, error) {
	p.batches++
	objects := make([]ChainObject, 0, len(ids))
	for _, id := range ids {
		object, err := p.chainFixture.ReadChainObject(ctx, id)
		if err != nil {
			return nil, err
		}
		if id == p.faultID && !p.faultSeen {
			p.faultSeen = true
			switch p.fault {
			case "missing":
				continue
			case "unavailable":
				return nil, errors.New("batch unavailable")
			case "wrong id":
				object.ID = addressNumber(254).String()
			case "owner":
				object.OwnerID = addressNumber(254).String()
			case "type":
				object.Type = "0x2::object::ID"
			case "uid":
				object.Content = append([]byte(nil), object.Content...)
				object.Content[0] ^= 1
			case "mutable":
				object.Shared, object.Immutable = true, false
			case "trailing bcs":
				object.Content = append(append([]byte(nil), object.Content...), 0)
			}
		}
		objects = append(objects, object)
	}
	if p.faultSeen && p.fault == "reordered" && len(objects) > 1 {
		objects[0], objects[1] = objects[1], objects[0]
	}
	if p.faultSeen && p.fault == "duplicate" && len(objects) > 1 {
		objects[1] = objects[0]
	}
	return objects, nil
}

func directFingerprint(t *testing.T, command NodeCommand) string {
	t.Helper()
	bytes, err := command.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(bytes)
	return hex.EncodeToString(hash[:])
}

func directApprovalFixture(t *testing.T) (*chainFixture, moveDirectPermission, moveDirectApproval, moveGrant) {
	t.Helper()
	f, p, b := directFixture(t)
	approver := moveGrant{ID: addressNumber(61), Human: f.human.ID, Device: addressNumber(62), Actions: []byte{3}, Version: 1, Generation: 1, Expiry: p.Expiry}
	approval := moveDirectApproval{ID: addressNumber(60), Org: p.Org, Permission: p.ID, PermissionVersion: 1, Message: addressNumber(40), Managed: p.Managed, ManagedVersion: 1, Action: "file.write", Boundary: p.Boundary, Amount: 3, State: 1, Expiry: p.Expiry, Device: approver.Device, Grant: []moveAddress{approver.ID}, GrantVersion: 1, Generation: 1}
	b.Approval = []moveAddress{approval.ID}
	f.cap.MaxUses, f.cap.MaxBudget = 1, 3
	f.sync(t)
	saveDirectPolicy(t, f, p, b, p.Boundary)
	saveDirectObject(t, f, approval.ID, "Approval", approval, false)
	f.saveObject(t, approver.ID, "identity::DeviceGrant", approver)
	return f, p, approval, approver
}

func TestDirectBatchRetainsSerialAuthorityAndOriginalRunWithFewerRoundTrips(t *testing.T) {
	ctx := context.Background()
	for _, name := range []string{"standing", "one-off approval", "original Run", "known original Run"} {
		t.Run(name, func(t *testing.T) {
			f, _, _, command, _, _ := directExecutionFixture(t)
			if name == "one-off approval" {
				f, _, _, _ = directApprovalFixture(t)
			}
			ref := CapabilityRef{ID: f.cap.ID.String(), RevocationVersion: 1}
			fingerprint := directFingerprint(t, command)
			var known ChainExecution
			if name == "known original Run" {
				var err error
				known, _, err = f.resolver.LookupExecution(ctx, ref.ID, fingerprint)
				if err != nil {
					t.Fatal(err)
				}
			}
			resolve := func() any {
				if name == "standing" || name == "one-off approval" {
					state, err := f.resolver.Resolve(ctx, ref)
					if err != nil {
						t.Fatal(err)
					}
					return state
				}
				var run ChainExecution
				var found bool
				var err error
				if name == "known original Run" {
					run, found, err = f.resolver.RecheckExecution(ctx, known)
				} else {
					run, found, err = f.resolver.LookupExecution(ctx, ref.ID, fingerprint)
				}
				if err != nil || !found {
					t.Fatalf("original Run unreadable: %v", err)
				}
				return run
			}
			f.reads = map[string]int{}
			want := resolve()
			serialReads := 0
			for _, count := range f.reads {
				serialReads += count
			}
			f.reads = map[string]int{}
			probe := &directBatchProbe{chainFixture: f}
			f.resolver.reader = probe
			got := resolve()
			if !reflect.DeepEqual(want, got) {
				t.Fatal("batch changed typed authority, original Run or private dependency proof")
			}
			for id, count := range f.reads {
				if count != 2 {
					t.Fatalf("dependency %s read %d times; require one decode and one fresh final read", id, count)
				}
			}
			roundTrips := probe.singles + probe.batches
			if roundTrips >= serialReads/2 || (name == "original Run" && roundTrips > 11) || (name == "known original Run" && roundTrips > 8) {
				t.Fatalf("excessive direct dependency round trips: serial=%d batch=%d (%d singles, %d batches)", serialReads, roundTrips, probe.singles, probe.batches)
			}
			t.Logf("same typed proof: serial=%d, batched=%d (%d singles + %d batches)", serialReads, roundTrips, probe.singles, probe.batches)
		})
	}
}

func TestDirectPrefetchRejectsMissingAndMalformedSourcesWithoutFallback(t *testing.T) {
	for _, fault := range []string{"missing", "unavailable", "wrong id", "reordered", "duplicate", "owner", "type", "uid", "trailing bcs", "mutable"} {
		t.Run(fault, func(t *testing.T) {
			f, _, _, command, message, _ := directExecutionFixture(t)
			core := f.resolver.packageID
			field, err := dynamicFieldID(f.cap.ID.String(), extensionFieldTag(core, f.resolver.directPackageID), appendBCSBytes(nil, []byte("permission")))
			if err != nil {
				t.Fatal(err)
			}
			if fault == "mutable" {
				field = message.ID.String()
			}
			probe := &directBatchProbe{chainFixture: f, faultID: field, fault: fault}
			f.resolver.reader = probe
			_, found, err := f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), directFingerprint(t, command))
			if err == nil || found || !probe.faultSeen || probe.fallback {
				t.Fatalf("bad prefetched dependency accepted or retried: found=%v err=%v fault=%v fallback=%v", found, err, probe.faultSeen, probe.fallback)
			}
		})
	}
}

type directOriginBatchProbe struct {
	*originFixture
	ids []string
}

func (p *directOriginBatchProbe) ReadChainObjects(ctx context.Context, ids []string) ([]ChainObject, error) {
	p.ids = append(p.ids, ids...)
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

func TestPrefetchedFieldUsesDatatypeOriginAndCannotReplaceFirstRead(t *testing.T) {
	f := upgradedAuthorityFixture(t)
	probe := &directOriginBatchProbe{originFixture: f}
	f.resolver.reader = probe
	r := &chainRead{resolver: f.resolver, versions: map[string]uint64{}}
	core := f.resolver.packageID
	field := chainFieldRef{f.cap.ID.String(), structKeyTag(core, "host", "AuthorityBindingKey"), []byte{0}}
	ctx := context.Background()
	if err := r.prefetchDependencies(ctx, nil, field); err != nil {
		t.Fatal(err)
	}
	wantID, _ := dynamicFieldID(field.parent, structKeyTag(f.values["host::AuthorityBindingKey"], "host", "AuthorityBindingKey"), field.key)
	if !reflect.DeepEqual(probe.ids, []string{wantID}) {
		t.Fatal("prefetch derived a field from the call package instead of its datatype origin")
	}
	object := f.objects[wantID]
	object.Version++
	f.objects[wantID] = object
	// A later batch in the same resolution must not overwrite the original
	// prefetched value and erase a mixed-version read before the final pin.
	if err := r.prefetchDependencies(ctx, nil, field); err != nil || len(probe.ids) != 1 {
		t.Fatalf("same-call dependency reread before final pin: %v", err)
	}
	var binding moveAuthorityBinding
	if err := r.field(ctx, field.parent, field.tag, field.key, core+"::host::AuthorityBindingKey", core+"::host::AuthorityBinding", &binding); err != nil || !reflect.DeepEqual(binding, f.auth) {
		t.Fatalf("typed field validation changed: %+v %v", binding, err)
	}
	changed := errors.New("changed")
	if _, err := r.versionPin(ctx, changed); !errors.Is(err, changed) {
		t.Fatalf("prefetch cache hid final dependency change: %v", err)
	}
}

func TestDirectBatchRechecksPermissionApprovalAndOriginalRunDependencies(t *testing.T) {
	for _, dependency := range []string{"permission", "approval", "approver grant", "role", "workspace", "Run stop", "budget claim", "message", "record"} {
		t.Run(dependency, func(t *testing.T) {
			f, p, _, command, message, _ := directExecutionFixture(t)
			core := f.resolver.packageID
			var target string
			resolveAuthority := false
			switch dependency {
			case "permission":
				target = p.ID.String()
			case "approval", "approver grant", "role", "workspace":
				var approval moveDirectApproval
				var approver moveGrant
				f, p, approval, approver = directApprovalFixture(t)
				resolveAuthority = true
				if dependency == "approval" {
					target = approval.ID.String()
				} else if dependency == "approver grant" {
					target = approver.ID.String()
				} else if dependency == "role" {
					target, _ = dynamicFieldID(f.human.Roles.ID.String(), structKeyTag("0x2", "object", "ID"), p.Org[:])
				} else {
					entries := moveActiveAssignments{Revision: 1, Agents: moveTable{ID: addressNumber(51)}, Workspaces: moveTable{ID: addressNumber(52)}}
					target = f.saveField(t, p.Org, structKeyTag(core, "execution_extension", "ActiveAssignmentsKey"), []byte{0}, core+"::execution_extension::ActiveAssignmentsKey", core+"::execution_extension::ActiveAssignments", entries)
					approval.WorkspaceRevision = 1
					saveDirectObject(t, f, approval.ID, "Approval", approval, false)
				}
			case "Run stop":
				target = addressNumber(42).String()
			case "budget claim":
				runID := addressNumber(42)
				target, _ = dynamicFieldID(p.Claims.ID.String(), structKeyTag("0x2", "object", "ID"), runID[:])
			case "message":
				target = message.ID.String()
			case "record":
				target = message.Record.String()
			}
			probe := &directBatchProbe{chainFixture: f}
			f.resolver.reader = probe
			f.changeOnRead = target
			var err error
			if resolveAuthority {
				_, err = f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
			} else {
				_, _, err = f.resolver.LookupExecution(context.Background(), f.cap.ID.String(), directFingerprint(t, command))
			}
			if CodeOf(err) != CodeAuthorityStale || f.reads[target] != 2 {
				t.Fatalf("fresh dependency change was hidden by cache: %v reads=%d", err, f.reads[target])
			}
		})
	}
}

func TestDirectBatchCacheDoesNotSurviveCallsAndOptionalWorkspaceStaysUnknown(t *testing.T) {
	f, p, b := directFixture(t)
	probe := &directBatchProbe{chainFixture: f}
	f.resolver.reader = probe
	state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
	if err != nil || state.Direct.WorkspaceProtected || state.Direct.WorkspaceRevision != 0 {
		t.Fatalf("absent optional workspace did not retain its original meaning: %+v %v", state.Direct, err)
	}
	p.Revoked = true
	saveDirectPolicy(t, f, p, b, p.Boundary)
	if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); CodeOf(err) != CodeRevoked {
		t.Fatalf("previous successful call cached current authority: %v", err)
	}
	p.Revoked = false
	saveDirectPolicy(t, f, p, b, p.Boundary)
	f.fail = true
	if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
		t.Fatal("RPC failure reused previous dependency data")
	}
}
