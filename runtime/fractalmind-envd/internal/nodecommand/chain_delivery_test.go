package nodecommand

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"testing"
)

func deliveryFixture(t *testing.T, state uint8) (*chainFixture, HostConnection, string, string) {
	f, fingerprint, _ := executionFixture(t, state, moveBoundBudgetClaim{Reserved: 20, Settled: state == 2 || state == 3 || state == 5})
	pkg := f.resolver.packageID
	queue := moveHostCommandQueue{Commands: moveTable{ID: addressNumber(35), Size: 1}}
	qid := f.saveField(t, f.org.ID, structKeyTag(pkg, "node_execution", "HostCommandQueueKey"), f.member.Host[:], pkg+"::node_execution::HostCommandQueueKey", pkg+"::node_execution::HostCommandQueue", queue)
	hash, _ := hex.DecodeString(fingerprint)
	f.saveField(t, queue.Commands.ID, []byte{2}, make([]byte, 8), "u64", pkg+"::node_execution::QueuedCommandPointer", moveQueuedCommandPointer{Execution: addressNumber(11), Capability: f.cap.ID, Membership: f.member.ID, IntentHash: hash})
	body := append([]byte("FME3"), make([]byte, 40)...)
	digest := sha256.Sum256(body)
	did := f.saveField(t, addressNumber(11), structKeyTag(pkg, "node_execution", "CommandDeliveryKey"), []byte{0}, pkg+"::node_execution::CommandDeliveryKey", pkg+"::node_execution::CommandDelivery", moveCommandDelivery{KeyVersion: 1, EncryptedCommand: body, BodyHash: digest[:], QueuedAt: 1700000000000})
	return f, HostConnection{OrganizationID: f.org.ID.String(), HostAddress: f.member.Host.String(), MembershipID: f.member.ID.String()}, qid, did
}
func TestChainQueueReadsOnlyOriginalQueuedRunAndBoundsPages(t *testing.T) {
	for _, state := range []uint8{0, 1, 2, 3, 4, 5} {
		t.Run(string(rune('0'+state)), func(t *testing.T) {
			f, c, _, _ := deliveryFixture(t, state)
			rows, next, more, err := f.resolver.ReadHostCommandQueuePage(context.Background(), c, 0, 1)
			if err != nil || next != 1 || more {
				t.Fatalf("next %d more %t err %v", next, more, err)
			}
			if state == 0 {
				if len(rows) != 1 || rows[0].Run.State != 0 || rows[0].Run.ID != addressNumber(11).String() {
					t.Fatalf("wrong original %+v", rows)
				}
			} else if len(rows) != 0 {
				t.Fatal("running/unknown/terminal replayed")
			}
		})
	}
	f, c, _, _ := deliveryFixture(t, 0)
	c.MembershipID = addressNumber(99).String()
	rows, _, _, err := f.resolver.ReadHostCommandQueuePage(context.Background(), c, 0, 1)
	if err != nil || len(rows) != 0 {
		t.Fatal("historical member became a current delivery")
	}
	for _, limit := range []uint64{0, 65} {
		if _, _, _, err = f.resolver.ReadHostCommandQueuePage(context.Background(), c, 0, limit); err == nil {
			t.Fatal("unbounded page")
		}
	}
	if _, _, _, err = f.resolver.ReadHostCommandQueuePage(context.Background(), c, 2, 1); err == nil {
		t.Fatal("cursor exceeds source")
	}
}
func TestChainQueueUnknownAndSubstitutedSourcesNeverBecomeDelivery(t *testing.T) {
	for _, mode := range []string{"hash", "owner", "type", "missing body", "changed queue", "rpc"} {
		t.Run(mode, func(t *testing.T) {
			f, c, qid, did := deliveryFixture(t, 0)
			object := f.objects[did]
			switch mode {
			case "hash":
				object.Content[len(object.Content)-10] ^= 1
			case "owner":
				object.OwnerID = f.org.ID.String()
			case "type":
				object.Type = "0x2::object::ID"
			case "missing body":
				delete(f.objects, did)
			case "changed queue":
				f.changeOnRead = qid
			case "rpc":
				f.fail = true
			}
			if mode != "missing body" {
				f.objects[did] = object
			}
			if rows, _, _, err := f.resolver.ReadHostCommandQueuePage(context.Background(), c, 0, 1); err == nil || len(rows) != 0 {
				t.Fatalf("invalid source yielded %+v %v", rows, err)
			}
		})
	}
}
func TestChainQueueIsSequentialAndAbsentDirectoryDoesNotExecute(t *testing.T) {
	f, c, _, _ := deliveryFixture(t, 0)
	pkg := f.resolver.packageID
	q := moveHostCommandQueue{Commands: moveTable{ID: addressNumber(35), Size: 2}}
	f.saveField(t, f.org.ID, structKeyTag(pkg, "node_execution", "HostCommandQueueKey"), f.member.Host[:], pkg+"::node_execution::HostCommandQueueKey", pkg+"::node_execution::HostCommandQueue", q)
	hash, _ := hex.DecodeString(fingerprintForTest())
	key := make([]byte, 8)
	binary.LittleEndian.PutUint64(key, 1)
	f.saveField(t, q.Commands.ID, []byte{2}, key, "u64", pkg+"::node_execution::QueuedCommandPointer", moveQueuedCommandPointer{Execution: addressNumber(11), Capability: f.cap.ID, Membership: f.member.ID, IntentHash: hash})
	if _, next, more, err := f.resolver.ReadHostCommandQueuePage(context.Background(), c, 0, 1); err != nil || next != 1 || !more {
		t.Fatal("page lost next cursor", err)
	}
	if _, next, more, err := f.resolver.ReadHostCommandQueuePage(context.Background(), c, 1, 1); err != nil || next != 2 || more {
		t.Fatal("page did not reach end", err)
	}
	empty := newChainFixture(t)
	if rows, next, more, err := empty.resolver.ReadHostCommandQueuePage(context.Background(), c, 0, 1); err != nil || len(rows) != 0 || next != 0 || more {
		t.Fatal("absent queue became delivery", err)
	}
}
func fingerprintForTest() string {
	return "abababababababababababababababababababababababababababababababab"
}
