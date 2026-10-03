package nodecommand

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
)

// ChainTypeOriginReader verifies an immutable package's raw BCS envelope,
// identity and version before returning its complete datatype origin table.
type ChainTypeOriginReader interface {
	ReadChainTypeOrigins(context.Context, string) (map[string]string, error)
}

type coreTypeOrigins struct {
	callID string
	mu     sync.Mutex
	values map[string]string
}

var moveIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var moveDatatype = regexp.MustCompile(`0x[0-9a-fA-F]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*`)

// Current call packages and original types are distinct configuration values.
// Resolve every datatype from the exact immutable call package when upgraded;
// fresh deployments retain the existing single-origin path.
func NewChainAuthorityResolverForPackage(reader ChainObjectReader, callPackageID, originalPackageID string, extensionOrigins ...string) (*ChainAuthorityResolver, error) {
	s, err := NewChainAuthorityResolver(reader, originalPackageID, extensionOrigins...)
	if err != nil {
		return nil, err
	}
	call, err := chainAddress(callPackageID)
	if err != nil {
		return nil, fmt.Errorf("current protocol package ID is required")
	}
	if call.String() != s.packageID {
		if _, ok := reader.(ChainTypeOriginReader); !ok {
			return nil, fmt.Errorf("upgraded protocol requires an immutable package type-origin reader")
		}
		s.origins = &coreTypeOrigins{callID: call.String()}
	}
	return s, nil
}

func (s *ChainAuthorityResolver) typeOrigins(ctx context.Context) (map[string]string, error) {
	if s.origins == nil {
		return nil, nil
	}
	s.origins.mu.Lock()
	defer s.origins.mu.Unlock()
	if s.origins.values != nil {
		return s.origins.values, nil
	}
	values, err := s.reader.(ChainTypeOriginReader).ReadChainTypeOrigins(ctx, s.origins.callID)
	if err != nil {
		return nil, err
	}
	verified := make(map[string]string, len(values))
	for kind, value := range values {
		parts := strings.Split(kind, "::")
		if len(parts) != 2 || !moveIdentifier.MatchString(parts[0]) || !moveIdentifier.MatchString(parts[1]) {
			return nil, fmt.Errorf("invalid core datatype origin")
		}
		addr, err := chainAddress(value)
		if err != nil || addr.String() != value {
			return nil, fmt.Errorf("noncanonical core type origin")
		}
		verified[kind] = value
	}
	if verified["organization::Organization"] != s.packageID || verified["organization::ProtocolRegistry"] != s.packageID {
		return nil, fmt.Errorf("configured original core package does not match immutable type origins")
	}
	s.origins.values = verified
	return verified, nil
}

func (s *ChainAuthorityResolver) originFor(values map[string]string, pkg, module, name string) (string, error) {
	addr, err := chainAddress(pkg)
	if err != nil {
		return "", err
	}
	// OKR/direct datatypes belong to explicitly configured extension origins.
	if values == nil || addr.String() != s.packageID || module == "okr" || module == "handover" || module == "direct_agent" {
		return pkg, nil
	}
	origin, ok := values[module+"::"+name]
	if !ok {
		return "", fmt.Errorf("immutable core package is missing type origin %s::%s", module, name)
	}
	return origin, nil
}

func (s *ChainAuthorityResolver) resolveType(ctx context.Context, value string) (string, error) {
	values, err := s.typeOrigins(ctx)
	if err != nil {
		return "", err
	}
	if values == nil {
		return value, nil
	}
	var failed error
	result := moveDatatype.ReplaceAllStringFunc(value, func(kind string) string {
		parts := strings.Split(kind, "::")
		origin, e := s.originFor(values, parts[0], parts[1], parts[2])
		if e != nil {
			failed = e
			return ""
		}
		return origin + "::" + parts[1] + "::" + parts[2]
	})
	return result, failed
}

// Remap addresses in the actual BCS TypeTag, including nested generic witnesses.
// Replacing a type string alone would still derive the wrong dynamic-field ID.
func (s *ChainAuthorityResolver) resolveTypeTag(ctx context.Context, tag []byte) ([]byte, error) {
	values, err := s.typeOrigins(ctx)
	if err != nil {
		return nil, err
	}
	if values == nil {
		return tag, nil
	}
	if len(tag) == 0 || len(tag) > 1<<20 {
		return nil, fmt.Errorf("invalid field TypeTag size")
	}
	d := bcsReader{data: tag}
	var visit func(int) ([]byte, error)
	visit = func(depth int) ([]byte, error) {
		if depth > 16 {
			return nil, fmt.Errorf("field TypeTag nesting limit")
		}
		kind, err := d.take(1)
		if err != nil || kind[0] > 10 {
			return nil, fmt.Errorf("invalid field TypeTag")
		}
		out := []byte{kind[0]}
		switch kind[0] {
		case 6:
			child, err := visit(depth + 1)
			return append(out, child...), err
		case 7:
			addr, err := d.take(32)
			if err != nil {
				return nil, err
			}
			var address moveAddress
			copy(address[:], addr)
			identifier := func() (string, error) {
				n, err := d.length()
				if err != nil {
					return "", err
				}
				b, err := d.take(n)
				if err != nil || !moveIdentifier.Match(b) {
					return "", fmt.Errorf("invalid TypeTag identifier")
				}
				return string(b), nil
			}
			module, err := identifier()
			if err != nil {
				return nil, err
			}
			name, err := identifier()
			if err != nil {
				return nil, err
			}
			origin, err := s.originFor(values, address.String(), module, name)
			if err != nil {
				return nil, err
			}
			actual, err := chainAddress(origin)
			if err != nil {
				return nil, err
			}
			out = append(out, actual[:]...)
			out = appendBCSBytes(out, []byte(module))
			out = appendBCSBytes(out, []byte(name))
			count, err := d.length()
			if err != nil || count > 32 {
				return nil, fmt.Errorf("invalid TypeTag parameters")
			}
			out = append(out, byte(count))
			for i := 0; i < count; i++ {
				child, err := visit(depth + 1)
				if err != nil {
					return nil, err
				}
				out = append(out, child...)
			}
		}
		return out, nil
	}
	out, err := visit(0)
	if err != nil {
		return nil, err
	}
	if d.offset != len(tag) {
		return nil, fmt.Errorf("trailing field TypeTag data")
	}
	return out, nil
}
