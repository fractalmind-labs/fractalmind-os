# Development

## Setup

```bash
git clone https://github.com/fractalmind-labs/fractalmind-os.git
cd fractalmind-os/runtime/fractalbot
go mod download
cp config.example.yaml config.yaml
```

Edit `config.yaml`: channels, agents and schedules. [`config.example.yaml`](../config.example.yaml) is annotated and [Configuration](config-v2.md) is the full reference. Store secrets with `fractalbot secret set <name>` and run `fractalbot config check`.

```bash
go run ./cmd/fractalbot --config ./config.yaml
```

## Local Telegram demo

For a polling-based Telegram-to-agent-manager demo:

```yaml
version: 2
channels:
  telegram:
    main:
      botToken: secret:telegram-main
      adminId: 123456789
      allowedUsers: [123456789]
agents:
  coder:
    workspace: /absolute/path/to/oh-my-code
    runtime: agentManager
    channels: [telegram.main]
```

```bash
go run ./cmd/fractalbot --config ./config.yaml secret set telegram-main
go run ./cmd/fractalbot --config ./config.yaml config check
```

Start the gateway:

```bash
go run ./cmd/fractalbot --config ./config.yaml
```

In a Telegram DM, use `/whoami` to confirm your user ID, `/ping` to verify the channel, then send a normal task.

## Build and test

```bash
make build
make test
make vet
```

Equivalent focused commands:

```bash
go build -o fractalbot ./cmd/fractalbot
go test ./...
go test -v -race ./...
go vet ./...
```

Cross-platform builds are available through `make build-all`.

## WebSocket smoke test

Create a minimal config with no enabled channel:

```yaml
gateway:
  port: 18789
  bind: 127.0.0.1
channels:
  telegram:
    enabled: false
agents:
  workspace: ./workspace
  maxConcurrent: 1
```

Start the gateway in one terminal and the echo client in another:

```bash
go run ./cmd/fractalbot --config ./config.yaml
go run ./cmd/ws-echo-client --url ws://127.0.0.1:18789/ws
```

The client should receive a JSON `echo` event.

## Project structure

```text
fractalbot/
├── cmd/
│   ├── fractalbot/          # CLI and gateway entry point
│   └── ws-echo-client/      # WebSocket smoke-test client
├── internal/
│   ├── agent/               # Agent routers and desktop delivery
│   ├── bus/                 # In-process message bus
│   ├── channels/            # Channel adapters and workers
│   ├── config/              # YAML configuration
│   └── gateway/             # HTTP and WebSocket server
├── pkg/protocol/            # Shared protocol types
├── docs/                    # Operator and design documentation
├── config.example.yaml
└── Makefile
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for coding and pull request guidelines.
