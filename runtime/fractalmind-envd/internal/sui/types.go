package sui

// PeerInfo represents a peer node discovered from SUI events.
type PeerInfo struct {
	Address         string
	OrgID           string
	WireGuardPubKey []byte
	Endpoints       []string
	Hostname        string
	Status          uint8

	// Relay extension fields (from relay_info module events)
	IsRelay       bool
	RelayAddr     string
	Region        string
	ISP           string
	RelayCapacity uint64
	UptimeScore   uint64
}

const (
	PeerStatusOnline  uint8 = 0
	PeerStatusOffline uint8 = 1
)

// PolicyInput describes a bounded action policy to create on-chain.
type PolicyInput struct {
	AgentAddress  string
	AllowedAction string
	TargetScope   string
	MaxUses       uint64
	ExpiresAtMS   uint64
	MaxGasBudget  uint64
}

// ActionEvidence describes one policy-bound action execution to record.
type ActionEvidence struct {
	PolicyID    string
	ActionKind  string
	TargetScope string
	IntentHash  []byte
	ResultHash  []byte
	GasBudget   uint64
}
