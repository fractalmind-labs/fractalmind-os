# Service Architecture

## Component Assembly

The service uses manual dependency injection — no DI framework. Components are wired in `main.go`:

```go
func main() {
    // 1. Configuration
    cfg := config.Load()  // .env + .env.{ENV} + env vars

    // 2. Infrastructure
    db := database.Connect(cfg.DatabaseDSN, database.PoolConfig{
        MaxOpenConns:    100,
        MaxIdleConns:    10,
        ConnMaxLifetime: 30 * time.Minute,
    })
    database.Migrate(db, cfg.MigrationsPath)
    rdb := redis.NewClient(&redis.Options{
        Addr:     cfg.RedisAddr,
        Password: cfg.RedisPassword,
    })
    chain := ethclient.Dial(cfg.ChainRPCURL)

    // 3. Services
    jwt := service.NewJWTService(cfg.JWTSecretKey)
    wallets := service.NewWalletService(db, cfg.EncryptionMasterKey)
    metrics := metrics.NewPaymasterMetrics()
    sponsorship := service.NewGasSponsorshipManager(db, rdb, cfg, metrics)
    executor := service.NewSponsorshipExecutorManager(cfg, metrics)

    // 4. Router
    r := gin.New()
    r.Use(gin.Recovery(), gin.Logger(), middleware.CORS(cfg))

    // Root endpoints (no auth)
    health.NewHealthHandler(db, rdb, chain, cfg.Version).RegisterRoot(r)
    metrics.RegisterRoot(r)  // GET /metrics (Prometheus)

    // API endpoints (authenticated)
    v1 := r.Group("/api/v1")
    handler.NewSigningHandler(jwt, wallets, sponsorship, executor).Register(v1)
    handler.NewWithdrawalHandler(jwt, wallets, sponsorship, executor).Register(v1)
    handler.NewUserHandler(jwt, db).Register(v1)

    // 5. Background jobs
    opResolver := service.NewOperationStatusResolver(db, executor, cfg)
    opResolverJob := service.NewPeriodicJob(opResolver.RunOnce, cfg.OpResolverInterval)
    opResolverJob.Start()
    defer opResolverJob.Stop()

    // 6. Graceful shutdown
    srv := &http.Server{Addr: ":" + cfg.ServerPort, Handler: r}
    go srv.ListenAndServe()
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    srv.Shutdown(ctx)
}
```

## Configuration Loading

```go
type Config struct {
    Env                string  // "development", "test", "production"
    ServerPort         string  // "8080"
    DatabaseDSN        string  // "user:pass@tcp(host:3306)/db?parseTime=true&charset=utf8mb4"
    RedisAddr          string
    RedisPassword      string
    JWTSecretKey       string
    EncryptionMasterKey string  // 32-byte hex for AES-256-GCM
    ChainRPCURL        string
    ExpectedChainID    int64   // e.g., 1 (Ethereum), 56 (BSC), 137 (Polygon)
    CollateralTokenAddress string
    Version            string  // git SHA or "dev"
    MigrationsPath     string  // "/app/migrations"
}

func Load() Config {
    godotenv.Load(".env")
    env := os.Getenv("ENV")
    if env != "" {
        godotenv.Load(".env." + env)
    }
    // Env vars override file values
    cfg := Config{
        Env:        getEnvOrDefault("ENV", "development"),
        ServerPort: getEnvOrDefault("SERVER_PORT", "8080"),
        DatabaseDSN: mustGetEnv("DATABASE_DSN"),
        // ...
    }
    cfg.Validate()
    return cfg
}
```

## Router Registration

Handlers implement one of two interfaces:

```go
// For /api/v1/* routes (authenticated)
type IRegistrar interface {
    Register(v1 *gin.RouterGroup)
}

// For root routes (/health, /metrics)
type IRootRegistrar interface {
    RegisterRoot(r *gin.Engine)
}
```

Example handler registration:
```go
func (h *SigningHandler) Register(v1 *gin.RouterGroup) {
    grp := v1.Group("/wallet")
    grp.Use(middleware.Auth(h.jwt, h.users))
    grp.Use(middleware.RateLimit(h.rdb, middleware.RateLimitOptions{
        KeyPrefix: "sign",
        Limit:     20,
        Window:    time.Minute,
    }))
    grp.POST("/sign", h.Sign)
    grp.GET("/operations/:operationId", h.GetOperationStatus)
}
```

## Middleware Chain

```
Request → Recovery → Logger → CORS → [Auth] → [RateLimit] → Handler
```

- **Recovery**: catches panics, returns 500
- **Logger**: structured request logging
- **CORS**: configurable origins per environment
- **Auth**: JWT validation + user loading (per-group)
- **RateLimit**: Redis-based sliding window (per-group)

## Error Handling

```go
type AppError struct {
    Code    string         `json:"code"`
    Message string         `json:"message"`
    Details map[string]any `json:"details,omitempty"`
}

// HTTP status mapping
var httpCodes = map[string]int{
    ErrUnauthorized:      401,
    ErrInvalidRequest:    400,
    ErrNotFound:          404,
    ErrRateLimited:       429,
    ErrServiceUnavailable: 503,
    ErrInternal:          500,
}
```

## Database Migrations

SQL-based migrations applied at startup:

```
migrations/
├── 000001_create_users.up.sql
├── 000001_create_users.down.sql
├── 000002_create_wallets.up.sql
├── 000002_create_wallets.down.sql
├── 000003_create_signed_transactions.up.sql
└── ...
```

```go
func Migrate(db *gorm.DB, migrationsPath string) {
    sqlDB, _ := db.DB()
    m, _ := migrate.NewWithDatabaseInstance(
        "file://"+migrationsPath, "mysql",
        mysql.WithInstance(sqlDB, &mysql.Config{}),
    )
    m.Up()  // Apply all pending migrations
}
```
