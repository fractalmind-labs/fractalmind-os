# Testcontainers for Go patterns for MySQL / Redis

Primary sources:

- Quickstart: https://golang.testcontainers.org/quickstart/
- MySQL module: https://golang.testcontainers.org/modules/mysql/
- Redis module: https://golang.testcontainers.org/modules/redis/
- Networking: https://golang.testcontainers.org/features/networking/
- Garbage collector / cleanup: https://golang.testcontainers.org/features/garbage_collector/

## 1. When to use Testcontainers

Prefer Testcontainers for Go when the dependency is:

- already packaged as a normal container image
- disposable per test or per suite
- something developers should not have to install and start manually

Typical examples:

- MySQL for repository tests
- Redis for cache / queue / lock tests
- both together when testing application boot, migrations, cache invalidation, or background jobs

## 2. Use module packages, not raw generic containers, when possible

The official docs expose dedicated modules for MySQL and Redis.

Install:

```bash
go get github.com/testcontainers/testcontainers-go
go get github.com/testcontainers/testcontainers-go/modules/mysql
go get github.com/testcontainers/testcontainers-go/modules/redis
```

Why prefer the modules:

- less boilerplate
- sensible readiness defaults
- DB-specific helpers such as connection strings

## 3. Minimal MySQL example

Based on the official MySQL module docs:

```go
ctx := context.Background()
mysqlC, err := mysql.Run(ctx,
    "mysql:8.0.36",
    mysql.WithDatabase("app"),
    mysql.WithUsername("app"),
    mysql.WithPassword("secret"),
    mysql.WithScripts("testdata/schema.sql"),
)
require.NoError(t, err)
testcontainers.CleanupContainer(t, mysqlC)

dsn, err := mysqlC.ConnectionString(ctx, "parseTime=true")
require.NoError(t, err)
```

Use this for:

- schema bootstrap
- migration tests
- repository integration tests

## 4. Minimal Redis example

Based on the official Redis module docs:

```go
ctx := context.Background()
redisC, err := tcredis.Run(ctx,
    "redis:7",
)
require.NoError(t, err)
testcontainers.CleanupContainer(t, redisC)

addr, err := redisC.ConnectionString(ctx)
require.NoError(t, err)
```

If you need custom behavior, the Redis module docs include options such as config file, snapshotting, and log level.

## 5. Build a reusable TestEnv helper

Do not scatter container bootstrap across many tests. Prefer a small helper:

```go
type TestEnv struct {
    MySQL *mysql.MySQLContainer
    Redis *tcredis.RedisContainer
    DSN   string
    RedisAddr string
}

func StartTestEnv(t *testing.T) *TestEnv {
    t.Helper()
    ctx := context.Background()

    mysqlC, err := mysql.Run(ctx,
        "mysql:8.0.36",
        mysql.WithDatabase("app"),
        mysql.WithUsername("app"),
        mysql.WithPassword("secret"),
    )
    require.NoError(t, err)
    testcontainers.CleanupContainer(t, mysqlC)

    redisC, err := tcredis.Run(ctx, "redis:7")
    require.NoError(t, err)
    testcontainers.CleanupContainer(t, redisC)

    dsn, err := mysqlC.ConnectionString(ctx, "parseTime=true")
    require.NoError(t, err)

    redisAddr, err := redisC.ConnectionString(ctx)
    require.NoError(t, err)

    return &TestEnv{MySQL: mysqlC, Redis: redisC, DSN: dsn, RedisAddr: redisAddr}
}
```

This keeps the tests focused on behavior.

## 6. Cleanup rules

The official quickstart and cleanup docs show two normal patterns:

- `testcontainers.CleanupContainer(t, container)` when inside `testing.T`
- `container.Terminate(ctx)` when you manage lifecycle manually

Use cleanup immediately after successful creation.

Even though Ryuk cleans up leaked resources, still terminate containers explicitly so:

- test failures do not leave avoidable state behind
- logs are easier to reason about
- suite runtime stays predictable

Do not disable Ryuk unless your CI environment has a specific reason.

## 7. Networking for multi-container tests

If the application under test also runs in a container, attach related containers to the same custom network.

Official docs recommend using `network.New(ctx)` and `network.WithNetwork(...)`.

Pattern:

```go
nw, err := network.New(ctx)
require.NoError(t, err)
testcontainers.CleanupNetwork(t, nw)

mysqlC, err := mysql.Run(ctx,
    "mysql:8.0.36",
    network.WithNetwork([]string{"mysql"}, nw),
)
require.NoError(t, err)
testcontainers.CleanupContainer(t, mysqlC)
```

Use aliases so other containers can reach `mysql` or `redis` by stable names.

## 8. App-under-test outside Docker vs inside Docker

### App under test runs in Go on the host

Most common for repository/service tests.

Use the container's exported connection string helpers and connect from the test process directly.

### App under test runs in a container

Use a shared Docker network and internal hostnames/aliases. Avoid routing through host-exposed ports unless there is a specific reason.

## 9. Suggested test pyramid with Testcontainers

A practical split:

- unit tests for pure logic
- Testcontainers-backed integration tests for MySQL/Redis behavior
- optional live tests for cloud-managed DBs, external chains, or third-party APIs

This usually gives a better speed/confidence tradeoff than sending everything to a shared staging environment.

## 10. When not to use Testcontainers

Do **not** force Testcontainers on every dependency.

Prefer subprocess or direct in-process setup when:

- the dependency is a custom Go daemon under active local development
- you need to inspect stdout/stderr events in fine detail
- the service has no reliable container image yet
- the protocol target is an external chain / public testnet / remote SaaS

A good mixed strategy is common:

- MySQL + Redis via Testcontainers
- custom bot via subprocess
- external chain access behind env-gated live mode
