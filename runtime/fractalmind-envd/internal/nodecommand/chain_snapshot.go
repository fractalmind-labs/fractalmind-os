package nodecommand

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ErrChainSnapshotChanged means a fresh read raced with a chain write. It is
// unknown authority, never a successful check or evidence of revocation.
var ErrChainSnapshotChanged = errors.New("chain snapshot changed during read")

// A batch is a fresh read, not a cache or an atomic snapshot. Implementations
// return the exact requested order or an error; the resolver still compares
// every dependency's version and the transaction checks authority atomically.
type ChainObjectBatchReader interface {
	ReadChainObjects(context.Context, []string) ([]ChainObject, error)
}

// Only independent, already identified dependencies are prefetched. Each
// value is decoded/validated through object(), field() or immutable(), then
// reread by versionPin before return. This cache belongs to one resolution and
// never survives that call. Optional fields must not enter a required batch.
func (r *chainRead) prefetchObjects(ctx context.Context, ids []string) error {
	batch, ok := r.resolver.reader.(ChainObjectBatchReader)
	if !ok {
		return nil
	}
	unique := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if _, cached := r.objects[id]; !seen[id] && !cached {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return nil
	}
	objects, err := batch.ReadChainObjects(ctx, unique)
	if err != nil {
		return err
	}
	if len(objects) != len(unique) {
		return fmt.Errorf("incomplete chain dependency batch")
	}
	if r.objects == nil {
		r.objects = make(map[string]ChainObject, len(unique))
	}
	for i, id := range unique {
		if objects[i].ID != id {
			return fmt.Errorf("wrong chain dependency batch identity")
		}
		r.objects[id] = objects[i]
	}
	return nil
}

type chainFieldRef struct {
	parent string
	tag    []byte
	key    []byte
}

// Derive fields with the same per-datatype origins as field(). Prefetching
// does not validate a value or add it to the authority proof; the normal typed
// decoder must still consume it before the final fresh version recheck.
func (r *chainRead) prefetchDependencies(ctx context.Context, objects []string, fields ...chainFieldRef) error {
	if _, ok := r.resolver.reader.(ChainObjectBatchReader); !ok {
		return nil
	}
	ids := append([]string(nil), objects...)
	for _, field := range fields {
		tag, err := r.resolver.resolveTypeTag(ctx, field.tag)
		if err != nil {
			return err
		}
		id, err := dynamicFieldID(field.parent, tag, field.key)
		if err != nil {
			return err
		}
		ids = append(ids, id)
	}
	return r.prefetchObjects(ctx, ids)
}

func (r *chainRead) readObject(ctx context.Context, id string) (ChainObject, error) {
	if object, ok := r.objects[id]; ok {
		return object, nil
	}
	object, err := r.resolver.reader.ReadChainObject(ctx, id)
	if err != nil {
		return ChainObject{}, err
	}
	if r.objects == nil {
		r.objects = make(map[string]ChainObject)
	}
	r.objects[id] = object
	return object, nil
}

func (r *chainRead) versionPin(ctx context.Context, changed error) (string, error) {
	ids := make([]string, 0, len(r.versions))
	for id := range r.versions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var objects []ChainObject
	if batch, ok := r.resolver.reader.(ChainObjectBatchReader); ok {
		var err error
		objects, err = batch.ReadChainObjects(ctx, ids)
		if err != nil {
			return "", err
		}
		if len(objects) != len(ids) {
			return "", fmt.Errorf("incomplete chain dependency batch")
		}
	} else {
		for _, id := range ids {
			object, err := r.resolver.reader.ReadChainObject(ctx, id)
			if err != nil {
				return "", err
			}
			objects = append(objects, object)
		}
	}
	var stamp strings.Builder
	for i, id := range ids {
		object := objects[i]
		if object.ID != id || object.Version != r.versions[id] {
			return "", changed
		}
		fmt.Fprintf(&stamp, "%s:%d;", id, object.Version)
	}
	return hashBytes([]byte(stamp.String())), nil
}
