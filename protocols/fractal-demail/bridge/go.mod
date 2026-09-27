module github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/bridge

go 1.24

replace github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/client-go => ../client-go

require github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/client-go v0.0.0-00010101000000-000000000000

require (
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/gas-station-adapter v0.0.0-00010101000000-000000000000
	golang.org/x/crypto v0.39.0 // indirect
	golang.org/x/sys v0.33.0 // indirect
)

replace github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/gas-station-adapter => ../gas-station-adapter
