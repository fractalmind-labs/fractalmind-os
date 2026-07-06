package wsauth

// Control-channel handshake message types. These ride the existing
// ws.Message envelope (Type + Payload) that the coordinator<->worker channel
// already uses, so no new transport is introduced.
//
// Flow (worker dials coordinator /ws):
//
//	worker -> coordinator : MsgAuthInit      {client_nonce}
//	coordinator -> worker : MsgAuthChallenge {server_nonce, proof-over-client_nonce}
//	worker -> coordinator : MsgAuthResponse  {proof-over-server_nonce}
//	coordinator -> worker : MsgAuthOK        {}   (or MsgAuthError on failure)
//
// The coordinator proving first (over the worker-issued nonce) lets the worker
// abort before disclosing anything if it is talking to an impostor gateway,
// closing the MITM/DNS-spoof path that previously yielded RCE.
const (
	MsgAuthInit      = "auth_init"
	MsgAuthChallenge = "auth_challenge"
	MsgAuthResponse  = "auth_response"
	MsgAuthOK        = "auth_ok"
	MsgAuthError     = "auth_error"
)

// InitPayload carries the worker-issued challenge nonce.
type InitPayload struct {
	ClientNonce string `json:"client_nonce"`
}

// ChallengePayload carries the coordinator's own challenge nonce plus its proof
// over the worker-issued nonce.
type ChallengePayload struct {
	ServerNonce string `json:"server_nonce"`
	Proof       Proof  `json:"proof"`
}

// ResponsePayload carries the worker's proof over the coordinator-issued nonce.
type ResponsePayload struct {
	Proof Proof `json:"proof"`
}

// ErrorPayload carries a human-readable auth failure reason.
type ErrorPayload struct {
	Reason string `json:"reason"`
}
