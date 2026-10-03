package nodecommand

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

type originFixture struct {
	*chainFixture
	values      map[string]string
	reads       int
	unavailable bool
}

func (f *originFixture) ReadChainTypeOrigins(_ context.Context, _ string) (map[string]string, error) {
	f.reads++
	if f.unavailable {
		return nil, errors.New("package unavailable")
	}
	return f.values, nil
}

func upgradedAuthorityFixture(t *testing.T) *originFixture {
	f := newChainFixture(t)
	old := f.resolver.packageID
	middle, current := addressNumber(0x43).String(), addressNumber(0x44).String()
	values := map[string]string{
		"organization::Organization": old, "organization::ProtocolRegistry": old,
		"remote_authority::RemoteCapability": old,
		"host::HostMembership":               middle, "host::CoordinatorBinding": middle, "host::ManagedAgent": middle,
		"identity::HumanIdentity": middle, "identity::DeviceGrant": middle, "identity::OrgRole": current,
		"host::AuthorityBindingKey": current, "host::AuthorityBinding": middle,
		"host::HostIndexBinding": current, "host::HostIndex": middle,
		"remote_authority::ExecutionContractKey": current, "remote_authority::ExecutionContractBinding": middle,
		"execution_extension::FieldKey": middle,
	}
	// These are independent fixture writes at their declared introducing version.
	// Keep existing RemoteCapability/Organization unchanged and recreate only the
	// fields whose key origin actually moved. Their parent objects stay original.
	for id, obj := range f.objects {
		if obj.Shared {
			kind := strings.TrimPrefix(obj.Type, old+"::")
			obj.Type = values[kind] + "::" + kind
			f.objects[id] = obj
		}
	}
	f.saveField(t, f.cap.ID, structKeyTag(current, "host", "AuthorityBindingKey"), []byte{0}, current+"::host::AuthorityBindingKey", middle+"::host::AuthorityBinding", f.auth)
	f.saveField(t, f.org.ID, structKeyTag(current, "host", "HostIndexBinding"), []byte{0}, current+"::host::HostIndexBinding", middle+"::host::HostIndex", f.index)
	f.saveField(t, f.human.Roles.ID, structKeyTag("0x2", "object", "ID"), f.org.ID[:], "0x2::object::ID", current+"::identity::OrgRole", f.role)
	origins := &originFixture{chainFixture: f, values: values}
	resolver, err := NewChainAuthorityResolverForPackage(origins, current, old)
	if err != nil {
		t.Fatal(err)
	}
	resolver.now = f.resolver.now
	f.resolver = resolver
	return origins
}

func TestMixedOriginsPreserveOldCapabilityAndDeriveNewFields(t *testing.T) {
	f := upgradedAuthorityFixture(t)
	for i := 0; i < 2; i++ {
		state, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()})
		if err != nil {
			t.Fatal(err)
		}
		if state.Target.OrganizationID != f.org.ID.String() || state.AuthorizedSigners[0] != f.grant.Device.String() {
			t.Fatal("authority changed")
		}
	}
	if f.reads != 1 {
		t.Fatal("immutable table not cached", f.reads)
	}
	obj := f.objects[f.member.ID.String()]
	obj.Type = f.resolver.packageID + "::host::HostMembership"
	f.objects[obj.ID] = obj
	if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
		t.Fatal("substituted type origin accepted")
	}
}

func TestOriginFailureDoesNotGuessOrCacheUsableAuthority(t *testing.T) {
	for _, mode := range []string{"unavailable", "foreign", "missing"} {
		t.Run(mode, func(t *testing.T) {
			f := upgradedAuthorityFixture(t)
			switch mode {
			case "unavailable":
				f.unavailable = true
			case "foreign":
				f.values["organization::Organization"] = addressNumber(99).String()
			case "missing":
				delete(f.values, "host::AuthorityBindingKey")
			}
			if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err == nil {
				t.Fatal("guessed authority on missing metadata")
			}
			if mode != "missing" && f.resolver.origins.values != nil {
				t.Fatal("failed metadata became cached authority")
			}
			if mode == "unavailable" {
				f.unavailable = false
				if _, err := f.resolver.Resolve(context.Background(), CapabilityRef{ID: f.cap.ID.String()}); err != nil {
					t.Fatal(err)
				}
				if f.reads != 2 {
					t.Fatal("explicit retry did not re-read original immutable package")
				}
			}
		})
	}
}

func TestMixedGenericTypeTagRetainsExtensionWitness(t *testing.T) {
	f := upgradedAuthorityFixture(t)
	ext := addressNumber(0x60).String()
	input := extensionFieldTag(f.resolver.packageID, ext)
	actual, err := f.resolver.resolveTypeTag(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	expected := extensionFieldTag(addressNumber(0x43).String(), ext)
	if !bytes.Equal(actual, expected) {
		t.Fatal("generic key or separate witness origin changed")
	}
	typeName, err := f.resolver.resolveType(context.Background(), f.resolver.packageID+"::execution_extension::FieldKey<"+ext+"::direct_agent::Witness>")
	if err != nil || typeName != addressNumber(0x43).String()+"::execution_extension::FieldKey<"+ext+"::direct_agent::Witness>" {
		t.Fatal(typeName, err)
	}
	for _, bad := range [][]byte{{7}, append(input, 0), {11}, {6}} {
		if _, err := f.resolver.resolveTypeTag(context.Background(), bad); err == nil {
			t.Fatal("malformed key TypeTag accepted")
		}
	}
}
