# Deployment Patterns

## Docker Multi-Stage Build

```dockerfile
# Build stage
FROM golang:1.23-alpine AS builder
RUN apk add --no-cache ca-certificates
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# Runtime stage
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
RUN addgroup -g 65532 -S nonroot && \
    adduser -S -D -H -u 65532 -G nonroot nonroot
COPY --from=builder /out/api /app/api
COPY --from=builder /src/migrations /app/migrations
ENV SERVER_PORT=8080
ENV MIGRATIONS_PATH=/app/migrations
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/api"]
```

Key practices:
- Non-root user (UID 65532) for security
- `ca-certificates` for HTTPS client calls
- `wget` for health check probe
- `-trimpath -ldflags="-s -w"` for smaller binary
- `CGO_ENABLED=0` for static linking (no glibc dependency)
- Migrations bundled in image for startup auto-apply

## Docker Compose (EC2 Production)

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: wallet_db
    volumes:
      - mysql_data:/var/lib/mysql
    logging:
      driver: json-file
      options:
        max-size: "1024m"
        max-file: "3"
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -p$$MYSQL_ROOT_PASSWORD"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    logging:
      driver: json-file
      options:
        max-size: "256m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  api:
    image: ${DOCKER_IMAGE}
    depends_on:
      mysql: { condition: service_healthy }
      redis: { condition: service_healthy }
    env_file: .env
    ports:
      - "8080:8080"
    logging:
      driver: json-file
      options:
        max-size: "1024m"
        max-file: "3"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/health"]
      interval: 10s
      timeout: 3s
      retries: 10

volumes:
  mysql_data:
```

### Log Rotation (Critical!)

**Production lesson**: Without log rotation, service logs can fill disk within days under heavy sponsorship traffic (~5K+ txs/day).

Always set `json-file` logging driver with `max-size` and `max-file` on ALL containers:
```yaml
logging:
  driver: json-file
  options:
    max-size: "1024m"  # 1GB per log file
    max-file: "3"      # Keep 3 rotated files
```

This caps total log disk usage at ~3GB per container.

## CI/CD Workflow

```yaml
name: Deploy Web3 Service
on:
  workflow_dispatch:
    inputs:
      deployment_env:
        type: choice
        options: [test, live]
      image_tag:
        description: "Docker image tag"
        default: "latest"
      sponsorship_mode:
        type: choice
        options: [erc4337, bep414]
        default: erc4337

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build and push Docker image
        run: |
          docker build -t $REGISTRY/$IMAGE:$TAG apps/api/
          docker push $REGISTRY/$IMAGE:$TAG

      - name: Deploy to EC2
        env:
          SSH_KEY: ${{ secrets.EC2_SSH_KEY }}
          SSH_HOST: ${{ secrets.EC2_HOST }}
          SSH_USER: ${{ secrets.EC2_USER }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/key
          chmod 600 ~/.ssh/key
          SSH_OPTS="-i ~/.ssh/key -o StrictHostKeyChecking=no"

          # Pull new image
          ssh $SSH_OPTS $SSH_USER@$SSH_HOST \
            "docker pull $REGISTRY/$IMAGE:$TAG"

          # Stop old, start new
          ssh $SSH_OPTS $SSH_USER@$SSH_HOST \
            "cd $DEPLOY_DIR && docker compose down api && docker compose up -d api"

      - name: Health check
        run: |
          for i in $(seq 1 30); do
            STATUS=$(curl -sf https://$API_URL/health | jq -r '.status') || true
            if [ "$STATUS" = "healthy" ]; then
              echo "Health check PASS"
              exit 0
            fi
            sleep 5
          done
          echo "Health check FAIL"
          exit 1
```

## SSH Diagnostic Workflow

For ad-hoc DB queries and troubleshooting:

```yaml
name: Diagnose Gas Sponsorship
on:
  workflow_dispatch:
    inputs:
      deployment_env:
        type: choice
        options: [test, live]
      query_date:
        description: "Date (YYYY-MM-DD, blank=today)"
        type: string

jobs:
  diagnose:
    runs-on: ubuntu-latest
    steps:
      - name: Setup SSH
        env:
          SSH_KEY: ${{ secrets.EC2_SSH_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/key
          chmod 600 ~/.ssh/key

      - name: Query DB
        run: |
          MYSQL_CMD="docker exec app-mysql-1 mysql -uroot -p\$MYSQL_ROOT_PASSWORD -N wallet_db"
          ssh -i ~/.ssh/key $USER@$HOST "$MYSQL_CMD -e \"
            SELECT date, SUM(count) as total_txs, COUNT(DISTINCT user_id) as unique_users
            FROM sponsored_transactions_tracker
            WHERE date >= '$START_DATE'
            GROUP BY date ORDER BY date;
          \""
```

Pattern: SSH into EC2 → exec into MySQL container → run diagnostic SQL.

**Key tables for diagnostics:**
- `sponsored_transactions_tracker` — daily per-user counters (aggregated)
- `signed_transactions` — individual transaction records with gas_mode, provider, status
- `gas_sponsorship_policies` — active sponsorship rules

## Environment Variables

```bash
# Service
ENV=production
SERVER_PORT=8080
VERSION=abc1234

# Database
DATABASE_DSN=root:pass@tcp(mysql:3306)/wallet_db?parseTime=true&charset=utf8mb4
MIGRATIONS_PATH=/app/migrations

# Redis
REDIS_ADDR=redis:6379
REDIS_PASSWORD=

# Security
JWT_SECRET_KEY=<32-byte-hex>
ENCRYPTION_MASTER_KEY=<32-byte-hex>

# Blockchain
CHAIN_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
EXPECTED_CHAIN_ID=1
COLLATERAL_TOKEN_ADDRESS=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Sponsorship
PAYMASTER_MODE=erc4337
PAYMASTER_CROSS_MODE_FALLBACK=true
ERC4337_ENTRY_POINT=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
ERC4337_PROVIDERS_0_NAME=alchemy-primary
ERC4337_PROVIDERS_0_BUNDLER_URL=https://eth-mainnet.g.alchemy.com/v2/KEY
ERC4337_PROVIDERS_0_PAYMASTER_URL=https://eth-mainnet.g.alchemy.com/v2/KEY

# Background jobs
OP_STATUS_RESOLVER_INTERVAL=10s
OP_STATUS_RESOLVER_BATCH_SIZE=100
OP_STATUS_RESOLVER_UNRESOLVED_TIMEOUT=30m
```
