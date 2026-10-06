package hostjoin

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mr-tron/base58"
)

func recordFixture() Record {
	id := "0x" + strings.Repeat("0", 63) + "1"
	return Record{Format: 1, Chain: base58.Encode(make([]byte, 32)), Sender: id, Digest: base58.Encode([]byte(strings.Repeat("x", 32))), GasBudget: 10000000, GasPrice: 1000, PackageID: id, TypesPackageID: id, OrganizationID: id, InviteID: id}
}
func TestHostJoinJournalDurableOriginalOnlyAndExclusive(t *testing.T) {
	r := recordFixture()
	root := t.TempDir()
	j, err := OpenJournal(context.Background(), root, r.Chain, r.Sender)
	if err != nil {
		t.Fatal(err)
	}
	if err = j.WriteNew(r); err != nil {
		t.Fatal(err)
	}
	if err = j.WriteNew(r); err == nil {
		t.Fatal("pending transaction replaced")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if second, err := OpenJournal(ctx, root, r.Chain, r.Sender); err == nil {
		second.Close()
		t.Fatal("concurrent operation acquired namespace")
	}
	info, err := os.Stat(filepath.Join(j.dir, "pending.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0077 != 0 {
		t.Fatal("journal is accessible to other users")
	}
	j.Close()
	restored, err := OpenJournal(context.Background(), root, r.Chain, r.Sender)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	saved, err := restored.Read()
	if err != nil || saved == nil || *saved != r {
		t.Fatal("original digest lost across restart")
	}
	if err = restored.Archive("wrong"); err == nil {
		t.Fatal("wrong original archived")
	}
	if err = restored.Archive(r.Digest); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(restored.dir, r.Digest+".json")); err != nil {
		t.Fatal("archived original lost")
	}
}
func TestHostJoinJournalFailsClosedForInvalidMetadata(t *testing.T) {
	for _, mode := range []string{"foreign sender", "foreign chain", "malformed", "secret property", "trailing"} {
		t.Run(mode, func(t *testing.T) {
			r := recordFixture()
			j, err := OpenJournal(context.Background(), t.TempDir(), r.Chain, r.Sender)
			if err != nil {
				t.Fatal(err)
			}
			defer j.Close()
			if err = j.WriteNew(r); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(j.dir, "pending.json")
			data, _ := os.ReadFile(path)
			switch mode {
			case "foreign sender":
				data = []byte(strings.Replace(string(data), `"sender":"`+r.Sender+`"`, `"sender":"0x`+strings.Repeat("9", 64)+`"`, 1))
			case "foreign chain":
				data = []byte(strings.Replace(string(data), r.Chain, "other", 1))
			case "malformed":
				data = []byte("{")
			case "secret property":
				data = append(append([]byte{}, data[:len(data)-1]...), []byte(`,"invitation":"must-not-be-accepted"}`)...)
			case "trailing":
				data = append(data, []byte("{}")...)
			}
			if err = os.WriteFile(path, data, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err = j.Read(); err == nil {
				t.Fatal("invalid metadata accepted")
			}
			if err = j.WriteNew(r); err == nil {
				t.Fatal("invalid original silently replaced")
			}
		})
	}
}
