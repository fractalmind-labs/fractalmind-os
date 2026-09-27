module github.com/fractalmind-labs/fractalmind-os/runtime/fractalbot

go 1.25.6

require (
	github.com/bwmarrin/discordgo v0.29.0
	github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/client-go v0.0.0-00010101000000-000000000000
	github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/gas-station-adapter v0.0.0-00010101000000-000000000000
	github.com/gorilla/websocket v1.5.3
	github.com/larksuite/oapi-sdk-go/v3 v3.5.3
	github.com/robfig/cron/v3 v3.0.1
	github.com/slack-go/slack v0.17.3
	golang.org/x/time v0.15.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	golang.org/x/crypto v0.39.0 // indirect
	golang.org/x/sys v0.33.0 // indirect
)

replace (
	github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/client-go => ../../protocols/fractal-demail/client-go
	github.com/fractalmind-labs/fractalmind-os/protocols/fractal-demail/gas-station-adapter => ../../protocols/fractal-demail/gas-station-adapter
)
