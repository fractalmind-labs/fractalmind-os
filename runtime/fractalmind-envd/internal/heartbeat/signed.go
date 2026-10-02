package heartbeat

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/wsauth"
)

const MaxSignedBody = 256 << 10
const FreshnessMS int64 = 60_000
const MaxSequence uint64 = 1<<53 - 1

var fullID = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var noncePattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var versionPattern = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)
var chainPattern = regexp.MustCompile(`^[A-Za-z0-9]{1,64}$`)

// Scope names current chain records, not locally cached business authority.
type Scope struct {
	ChainIdentifier   string `json:"chain_identifier"`
	OrganizationID    string `json:"organization_id"`
	MembershipID      string `json:"membership_id"`
	MembershipVersion string `json:"membership_version"`
	BindingID         string `json:"binding_id"`
	BindingVersion    string `json:"binding_version"`
	HostAddress       string `json:"host_address"`
}

// Signed keeps the precise original heartbeat bytes through Coordinator relays.
// It attests an observation, never an execution or independent Agent identity.
type Signed struct {
	Scope
	Format       int    `json:"format"`
	SessionNonce string `json:"session_nonce"`
	Sequence     uint64 `json:"sequence"`
	ObservedAtMS int64  `json:"observed_at_ms"`
	ExpiresAtMS  int64  `json:"expires_at_ms"`
	Body         string `json:"body"`
	Signature    string `json:"signature"`
}

func (s Scope) valid() bool {
	if !chainPattern.MatchString(s.ChainIdentifier) || !fullID.MatchString(s.OrganizationID) || !fullID.MatchString(s.MembershipID) || !fullID.MatchString(s.BindingID) || !fullID.MatchString(s.HostAddress) {
		return false
	}
	for _, version := range []string{s.MembershipVersion, s.BindingVersion} {
		if !versionPattern.MatchString(version) {
			return false
		}
		if _, err := strconv.ParseUint(version, 10, 64); err != nil {
			return false
		}
	}
	return true
}
func signingText(s Signed, body []byte) []byte {
	hash := sha256.Sum256(body)
	return []byte(strings.Join([]string{"FM-HOST-OBSERVATION", "1", s.ChainIdentifier, s.OrganizationID, s.MembershipID, s.MembershipVersion, s.BindingID, s.BindingVersion, s.HostAddress, s.SessionNonce, strconv.FormatUint(s.Sequence, 10), strconv.FormatInt(s.ObservedAtMS, 10), strconv.FormatInt(s.ExpiresAtMS, 10), hex.EncodeToString(hash[:])}, ":"))
}

func Sign(signer wsauth.Signer, scope Scope, sessionNonce string, sequence uint64, expiresAtMS int64, payload *Payload) (Signed, error) {
	var out Signed
	if signer == nil || payload == nil || !scope.valid() || scope.HostAddress != signer.Address() || payload.HostID != scope.HostAddress || !noncePattern.MatchString(sessionNonce) || sequence == 0 || sequence > MaxSequence {
		return out, fmt.Errorf("current Host observation scope required")
	}
	observed := payload.Timestamp.UnixMilli()
	if observed < 0 || expiresAtMS <= observed || expiresAtMS-observed > FreshnessMS {
		return out, fmt.Errorf("bounded Host observation expiry required")
	}
	body, err := json.Marshal(payload)
	if err != nil || len(body) > MaxSignedBody {
		return out, fmt.Errorf("invalid Host observation body")
	}
	out = Signed{Scope: scope, Format: 1, SessionNonce: sessionNonce, Sequence: sequence, ObservedAtMS: observed, ExpiresAtMS: expiresAtMS, Body: base64.StdEncoding.EncodeToString(body)}
	out.Signature = hex.EncodeToString(signer.Sign(signingText(out, body)))
	if _, err := Verify(out, signer.PublicKeyBytes(), observed); err != nil {
		return Signed{}, err
	}
	return out, nil
}

// Verify authenticates exact bytes and freshness. Callers must additionally
// prove the current chain scope; the Coordinator also pins its handshake nonce
// and rejects duplicate/decreasing sequence numbers on each connection.
func Verify(s Signed, public []byte, now int64) (*Payload, error) {
	if s.Format != 1 || !s.Scope.valid() || len(public) != 32 || wsauth.DeriveAddress(public) != s.HostAddress || !noncePattern.MatchString(s.SessionNonce) || s.Sequence == 0 || s.Sequence > MaxSequence || s.ObservedAtMS < 0 || s.ObservedAtMS > now+5_000 || now-s.ObservedAtMS > FreshnessMS || s.ExpiresAtMS <= now || s.ExpiresAtMS <= s.ObservedAtMS || s.ExpiresAtMS-s.ObservedAtMS > FreshnessMS || len(s.Body) > base64.StdEncoding.EncodedLen(MaxSignedBody) || len(s.Signature) != 128 {
		return nil, fmt.Errorf("invalid or stale Host observation")
	}
	body, err := base64.StdEncoding.DecodeString(s.Body)
	if err != nil || len(body) > MaxSignedBody || base64.StdEncoding.EncodeToString(body) != s.Body {
		return nil, fmt.Errorf("invalid Host observation encoding")
	}
	sig, err := hex.DecodeString(s.Signature)
	if err != nil || hex.EncodeToString(sig) != s.Signature || !ed25519.Verify(public, signingText(s, body), sig) {
		return nil, fmt.Errorf("Host observation signature invalid")
	}
	var payload Payload
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&payload) != nil || decoder.Decode(new(any)) != io.EOF || payload.HostID != s.HostAddress || payload.Timestamp.UnixMilli() != s.ObservedAtMS || len(payload.Hostname) > 253 || strings.ContainsAny(payload.Hostname, "\x00\r\n") || payload.System.NumCPU < 1 || payload.System.NumCPU > 65536 || payload.System.OS == "" || len(payload.System.OS) > 32 || payload.System.Arch == "" || len(payload.System.Arch) > 32 || payload.Uptime < 0 || len(payload.Agents) > 1000 {
		return nil, fmt.Errorf("invalid Host observation payload")
	}
	for _, a := range payload.Agents {
		if a.ID == "" || len(a.ID) > 256 || a.Session == "" || len(a.Session) > 256 || (a.Status != "running" && a.Status != "dead" && a.Status != "missing") {
			return nil, fmt.Errorf("invalid observed Agent descriptor")
		}
	}
	return &payload, nil
}

func DecodeSigned(raw []byte) (Signed, error) {
	var out Signed
	if len(raw) > 512<<10 {
		return out, fmt.Errorf("Host observation envelope too large")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&out) != nil || decoder.Decode(new(any)) != io.EOF {
		return out, fmt.Errorf("invalid Host observation envelope")
	}
	return out, nil
}

func Expiry(observed time.Time, membershipExpiry uint64) int64 {
	expires := observed.UnixMilli() + FreshnessMS
	if membershipExpiry < uint64(expires) {
		return int64(membershipExpiry)
	}
	return expires
}
