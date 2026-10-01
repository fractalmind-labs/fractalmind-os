package nodecommand

import (
	"context"
	"encoding/binary"
	"testing"
)

func TestChainClockValidatesSourceOwnershipUIDAndTimestamp(t *testing.T) {
	f := newChainFixture(t)
	id := addressNumber(6)
	content := append([]byte(nil), id[:]...)
	content = binary.LittleEndian.AppendUint64(content, 123456789)
	base := ChainObject{ID: id.String(), Type: "0x2::clock::Clock", Shared: true, Version: 1, Content: content}
	f.objects[id.String()] = base
	stamp, err := f.resolver.ChainTime(context.Background())
	if err != nil || stamp != 123456789 {
		t.Fatalf("clock: %d %v", stamp, err)
	}
	for _, test := range []struct {
		name   string
		change func(*ChainObject)
	}{
		{"wrong UID", func(o *ChainObject) { o.Content = append([]byte(nil), o.Content...); o.Content[31] = 7 }},
		{"wrong type", func(o *ChainObject) { o.Type = "0x3::clock::Clock" }},
		{"owned", func(o *ChainObject) { o.Shared = false }},
		{"wrong owner", func(o *ChainObject) { o.OwnerID = "0x1" }},
		{"immutable", func(o *ChainObject) { o.Immutable = true }},
		{"wrong version", func(o *ChainObject) { o.Version = 0 }},
		{"no time", func(o *ChainObject) {
			o.Content = append([]byte(nil), o.Content...)
			binary.LittleEndian.PutUint64(o.Content[32:], 0)
		}},
		{"overflow", func(o *ChainObject) {
			o.Content = append([]byte(nil), o.Content...)
			binary.LittleEndian.PutUint64(o.Content[32:], ^uint64(0))
		}},
		{"trailing bytes", func(o *ChainObject) { o.Content = append(append([]byte(nil), o.Content...), 0) }},
	} {
		t.Run(test.name, func(t *testing.T) {
			object := base
			test.change(&object)
			f.objects[id.String()] = object
			if _, err := f.resolver.ChainTime(context.Background()); err == nil {
				t.Fatal("malformed clock accepted")
			}
		})
	}
}
