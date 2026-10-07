package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/agent"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/config"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/coordinator"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/heartbeat"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/hostidentity"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/processsupervisor"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/relay"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/relaypicker"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/roles"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sponsor"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/wg"
	"github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/ws"
	wgctrl "golang.zx2c4.com/wireguard/wgctrl"
)

var (
	version   = "dev"
	startedAt = time.Now()

	// relayPeers tracks SUI address → relay peer ID for WSS fallback cleanup.
	relayPeers = make(map[string]uint16)
)

type runtimeCommandExecutor interface {
	Execute(context.Context, nodecommand.NodeCommand) (runtimeadapter.Response, nodecommand.NodeEvent, error)
}

func main() {
	configPath := flag.String("config", "sentinel.yaml", "path to config file")
	showVersion := flag.Bool("version", false, "show version")
	initHost := flag.Bool("init-host", false, "initialize Host signing/encryption keys in the system credential store")
	joinHost := flag.Bool("join-host", false, "redeem an organization invitation entered through hidden terminal input")
	appJoinHost := flag.Bool("app-join-host", false, "desktop App setup: redeem the invitation from stdin only for this config's organization and local Coordinator binding")
	hostPublic := flag.Bool("host-public", false, "print this Host's public keys without creating them")
	removeHostKeys := flag.Bool("remove-host-keys", false, "delete this Host's private keys from the system credential store")
	joinStatus := flag.Bool("host-join-status", false, "query the original Host admission transaction without accessing private keys")
	newJoinAttempt := flag.Bool("new-host-join-attempt", false, "explicitly prepare another admission after a known terminal original receipt")
	joinAddress := flag.String("host-address", "", "public Host address for --host-join-status")
	settleReview := flag.Bool("settle-stopped-review", false, "acknowledge an explicitly stopped expired zero-tool handover review; original signed command is read from stdin")
	flag.Parse()
	exclusive := 0
	for _, set := range []bool{*initHost, *joinHost, *appJoinHost, *joinStatus, *hostPublic, *removeHostKeys, *settleReview} {
		if set {
			exclusive++
		}
	}
	if flag.NArg() != 0 || exclusive > 1 || *newJoinAttempt && !*joinHost && !*appJoinHost || *joinAddress != "" && !*joinStatus || *settleReview && *showVersion {
		fmt.Fprintln(os.Stderr, "invalid Host command options; invitations are entered through stdin, never argv")
		os.Exit(2)
	}

	if *showVersion {
		fmt.Printf("fractalmind-envd %s\n", version)
		os.Exit(0)
	}

	log.SetPrefix("[envd] ")
	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	if *settleReview {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := runStoppedReviewCLI(ctx, cfg, os.Stdin, os.Stdout); err != nil {
			log.Print(err)
			os.Exit(1)
		}
		return
	}
	if *joinHost || *joinStatus || *appJoinHost {
		ui := hostJoinInteraction(os.Stdin, os.Stdout, os.Stderr)
		if *appJoinHost {
			ui = appHostJoinInteraction(os.Stdin, os.Stdout, cfg)
		}
		if err := runHostJoinCLI(context.Background(), cfg, *joinStatus, *newJoinAttempt, *joinAddress, ui, os.Stdout); err != nil {
			log.Print(err)
			os.Exit(1)
		}
		return
	}

	if *removeHostKeys {
		store, err := hostidentity.OpenNativeStoreWithCollection(cfg.Identity.SecretServiceCollection)
		if err != nil {
			log.Fatal(err)
		}
		if err := hostidentity.Remove(store, cfg.Identity.KeyProfile); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *initHost || *hostPublic {
		store, err := hostidentity.OpenNativeStoreWithCollection(cfg.Identity.SecretServiceCollection)
		if err != nil {
			log.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		var keys *hostidentity.Keys
		if *hostPublic {
			keys, err = hostidentity.Load(store, cfg.Identity.KeyProfile)
		} else {
			keys, err = hostidentity.Initialize(ctx, store, cfg.Identity.KeyProfile, "")
		}
		if err != nil {
			log.Fatal(err)
		}
		defer keys.Close()
		public, err := keys.Public(cfg.Identity.KeyProfile)
		if err != nil {
			log.Fatal(err)
		}
		if err := json.NewEncoder(os.Stdout).Encode(public); err != nil {
			log.Fatal(err)
		}
		return
	}
	log.Printf("starting fractalmind-envd %s (host=%s)", version, cfg.Identity.Hostname)
	peerRegistry, err := peerRegistryEnabled(cfg)
	if err != nil {
		log.Fatal(err)
	}

	runtimeExecutor, err := newRuntimeCommandExecutorFromEnv(cfg)
	if errors.Is(err, hostidentity.ErrAccessDenied) {
		waitAfterDeniedKey(err)
	}
	if err != nil {
		log.Fatalf("[runtimeadapter] failed to initialize persistent signed-command runtime: %v", err)
	}
	if chainRuntime, ok := runtimeExecutor.(*chainRuntimeExecutor); ok {
		cfg.Identity.HostID = chainRuntime.signer.Address()
	}
	if closer, ok := runtimeExecutor.(io.Closer); ok {
		defer closer.Close()
	}
	if runtimeExecutor != nil {
		log.Printf("[runtimeadapter] persistent signed-command runtime enabled (executor=%T)", runtimeExecutor)
	}

	// Parse durations
	reconnectWait, _ := time.ParseDuration(cfg.Gateway.ReconnectInterval)
	if reconnectWait == 0 {
		reconnectWait = 5 * time.Second
	}
	heartbeatInterval, _ := time.ParseDuration(cfg.Heartbeat.Interval)
	if heartbeatInterval == 0 {
		heartbeatInterval = 30 * time.Second
	}
	scanInterval, _ := time.ParseDuration(cfg.Agents.ScanInterval)
	if scanInterval == 0 {
		scanInterval = 10 * time.Second
	}

	// ======= v3: Resolve active roles =======
	activeRoles := roles.Resolve(cfg)

	// Initialize sponsor service early (needed for SUI self-sponsorship)
	var sponsorSvc *sponsor.Service
	if activeRoles.Sponsor {
		sponsorSvc, err = sponsor.NewService(sponsor.Config{
			SUI_RPC:         cfg.SUI.RPC,
			OrgWalletPath:   cfg.Sponsor.OrgWalletPath,
			AllowedPackages: cfg.Sponsor.AllowedPackages,
			MaxGasPerTx:     cfg.Sponsor.MaxGasPerTx,
			DailyGasLimit:   cfg.Sponsor.DailyGasLimit,
		})
		if err != nil {
			log.Fatalf("[sponsor] failed to start: %v", err)
		}
		defer sponsorSvc.Close()
		log.Printf("[sponsor] sponsor role enabled (wallet=%s, address=%s)", cfg.Sponsor.OrgWalletPath, sponsorSvc.Address())
	}

	// Initialize components
	scanner := agent.NewScannerAtSocket(cfg.Agents.ScanMethod, cfg.Agents.TmuxSocket)
	wsClient := ws.NewClient(cfg.Gateway.URL, reconnectWait)

	var desktopCancel context.CancelFunc
	var desktopDone <-chan error
	if strings.TrimSpace(cfg.Desktop.Command) != "" {
		supervisor, serr := newDesktopSupervisor(cfg.Desktop)
		if serr != nil {
			log.Fatalf("[desktop-supervisor] invalid configuration: %v", serr)
		}
		desktopCtx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		desktopCancel = cancel
		desktopDone = done
		go func() { done <- supervisor.Run(desktopCtx) }()
		log.Printf("[desktop-supervisor] enabled command=%s", cfg.Desktop.Command)
	}

	// The chain connection and execution runtime share the explicitly initialized
	// NativeStore Host identity. Only legacy configurations use a wallet file.
	var ctrlKey *sui.Keypair
	var connectionReader connectionRPC
	var connectionKeys *hostidentity.Keys
	if chainRuntime, ok := runtimeExecutor.(*chainRuntimeExecutor); ok {
		connectionReader, ok = chainRuntime.rpc.(connectionRPC)
		if !ok {
			log.Fatal("[auth] chain connection reader unavailable")
		}
		connectionKeys = chainRuntime.keys
	} else if cfg.SUI.HostConnectionEnabled {
		store, err := hostidentity.OpenNativeStoreWithCollection(cfg.Identity.SecretServiceCollection)
		if err != nil {
			log.Fatal("[auth] native Host store unavailable")
		}
		log.Printf("[auth] reading Host key %q from the system credential store (the OS may ask to allow access)", cfg.Identity.KeyProfile)
		connectionKeys, err = hostidentity.Load(store, cfg.Identity.KeyProfile)
		if errors.Is(err, hostidentity.ErrAccessDenied) {
			waitAfterDeniedKey(err)
		}
		if err != nil {
			log.Fatal("[auth] initialize native Host keys with --init-host first")
		}
		defer connectionKeys.Close()
		rpc, err := sui.NewGRPCClient(cfg.SUI.RPC, cfg.SUI.GraphQLURL)
		if err != nil {
			log.Fatal("[auth] chain connection RPC unavailable")
		}
		defer rpc.Close()
		connectionReader = rpc
	}
	loadControlKey := func() (*sui.Keypair, error) {
		if connectionKeys != nil {
			private, err := connectionKeys.SigningPrivate()
			if err != nil {
				return nil, err
			}
			return &sui.Keypair{Private: private, Public: private.Public().(ed25519.PublicKey)}, nil
		}
		return sui.LoadOrGenerateKeypair(cfg.SUI.KeypairPath)
	}
	if kp, kerr := loadControlKey(); kerr != nil {
		if connectionKeys != nil {
			log.Fatalf("[auth] secure Host control-channel identity unavailable: %v", kerr)
		}
		log.Printf("[auth] WARNING: could not load control-channel keypair (%v); control channel will be UNAUTHENTICATED", kerr)
	} else {
		ctrlKey = kp
		if connectionKeys != nil {
			defer clear(ctrlKey.Private)
			if cfg.Identity.HostID != "" && cfg.Identity.HostID != ctrlKey.Address() {
				log.Fatal("[auth] host_id must match the native Host address")
			}
			cfg.Identity.HostID = ctrlKey.Address()
		}
		// Hostnames remain display labels. Authenticated workers always register
		// the address derived from their actual control key.
		cfg.Identity.HostID = ctrlKey.Address()
		wsClient.SetAuth(ctrlKey, cfg.Gateway.CoordinatorAddress)
		log.Printf("[auth] control channel enabled, node identity=%s", ctrlKey.Address())
	}
	if connectionKeys != nil {
		public, err := connectionKeys.Public(cfg.Identity.KeyProfile)
		if err != nil {
			log.Fatal("[auth] Host public keys unavailable")
		}
		encryption, err := hex.DecodeString(public.EncryptionPublicKey)
		if err != nil {
			log.Fatal("[auth] Host encryption key unavailable")
		}
		if err := configureChainWorker(wsClient, cfg, connectionReader, ctrlKey, encryption); err != nil {
			log.Fatalf("[auth] %v", err)
		}
	}

	// Track agents and restart counts
	restartCounts := make(map[string]int)
	var lastAgents []agent.Agent

	// --- SUI + WireGuard integration (gated behind config flags) ---
	var suiClient *sui.Client
	var wgManager *wg.Manager
	var suiPollTicker *time.Ticker
	var eventCursor interface{}

	if peerRegistry {
		// --- WireGuard init (optional, graceful degradation) ---
		if cfg.WireGuard.Enabled {
			log.Printf("SUI + WireGuard integration enabled")

			wgClient, err := wgctrl.New()
			if err != nil {
				log.Printf("[wg] WARNING: failed to create wgctrl client: %v (continuing without WireGuard)", err)
			} else {
				wgManager, err = wg.NewManager(cfg.WireGuard, wgClient)
				if err != nil {
					log.Printf("[wg] WARNING: failed to create wg manager: %v (continuing without WireGuard)", err)
				} else if err := wgManager.Setup(); err != nil {
					log.Printf("[wg] WARNING: failed to setup wg interface: %v (continuing without WireGuard)", err)
					wgManager = nil
				}
			}
		} else {
			log.Printf("SUI enabled (WireGuard disabled)")
		}

		// Build endpoints list (use NAT detection result from role resolution)
		var endpoints []string
		if activeRoles.PublicEndpoint != "" {
			endpoints = append(endpoints, activeRoles.PublicEndpoint)
		}
		if cfg.WireGuard.Address != "" {
			endpoints = append(endpoints, cfg.WireGuard.Address)
		}
		if len(endpoints) == 0 {
			endpoints = append(endpoints, fmt.Sprintf("0.0.0.0:%d", cfg.WireGuard.ListenPort))
		}

		// Init SUI client (works independently of WireGuard)
		if connectionKeys != nil {
			suiClient, err = sui.NewClientWithKeypair(cfg.SUI, ctrlKey)
		} else {
			suiClient, err = sui.NewClient(cfg.SUI)
		}
		if err != nil {
			log.Fatalf("failed to create sui client: %v", err)
		}

		defer suiClient.Close()

		// Assign deterministic VPN IP to WireGuard interface
		if wgManager != nil {
			if err := wgManager.AssignIP(suiClient.Address()); err != nil {
				log.Printf("[wg] WARNING: failed to assign VPN IP: %v", err)
			}
		}

		// Gas top-up: sponsor wallet funds envd node for direct SUI execution
		if sponsorSvc != nil {
			ctx := context.Background()
			if err := sponsorSvc.TransferGas(ctx, suiClient.Address(), 50_000_000); err != nil {
				log.Printf("[sui] gas top-up failed: %v (will retry with direct gas)", err)
			}
		}

		// Register peer on-chain
		ctx := context.Background()
		var wgPubKey []byte
		if wgManager != nil {
			wgPubKey = wgManager.PublicKey()
		}
		if len(wgPubKey) != 32 {
			log.Printf("[wg] WARNING: WireGuard public key missing or invalid (%d bytes), using zero-filled key", len(wgPubKey))
			wgPubKey = make([]byte, 32)
		}
		if err := suiClient.RegisterPeer(ctx, wgPubKey, endpoints, cfg.Identity.Hostname); err != nil {
			log.Printf("[sui] peer registration failed: %v", err)
		}

		// NOTE: Initial peer sync is deferred until after WSS client setup,
		// so peers can be routed through the WSS relay when fallback is active.

		// Start SUI event poll ticker
		pollInterval, _ := time.ParseDuration(cfg.SUI.PollInterval)
		if pollInterval == 0 {
			pollInterval = 30 * time.Second
		}
		suiPollTicker = time.NewTicker(pollInterval)
	}

	// ======= v3: Start role-specific services =======
	var relayServer *relay.Server
	var stunOnlyServer *relay.StunOnlyServer
	var wssHandler *relay.WSSHandler
	var wssClient *relay.WSSClient
	var coordinatorServer *coordinator.Server

	if activeRoles.Relay {
		// Extract bare IP from "ip:port" endpoint
		relayIP := activeRoles.PublicEndpoint
		if host, _, err := net.SplitHostPort(relayIP); err == nil {
			relayIP = host
		}

		// Combined STUN + Relay on shared UDP port
		relayServer = relay.NewServer(relay.Config{
			ListenPort:     cfg.Relay.ListenPort,
			PublicIP:       relayIP,
			MaxConnections: cfg.Relay.MaxConnections,
		})
		if err := relayServer.Start(); err != nil {
			log.Fatalf("[relay] failed to start: %v", err)
		}
		log.Printf("[relay] relay server enabled on :%d (region=%s, isp=%s)",
			cfg.Relay.ListenPort, cfg.Relay.Region, cfg.Relay.ISP)

		// Start WSS relay handler if tcp_fallback config is present
		if cfg.Relay.TCPFallback && activeRoles.PublicEndpoint != "" {
			wssHandler = relay.NewWSSHandler(relayIP, cfg.Relay.WSSPortMin, cfg.Relay.WSSPortMax)

			// Wire relay-WG bridge callbacks: when a WSS client connects,
			// add its WG peer entry on this relay node so mesh traffic flows.
			if wgManager != nil {
				wssHandler.OnPeerConnected = func(suiAddr string, wgPubKey []byte, allocatedPort int) {
					endpoint := fmt.Sprintf("127.0.0.1:%d", allocatedPort)
					if err := wgManager.AddPeer(suiAddr, wgPubKey, []string{endpoint}); err != nil {
						log.Printf("[wss-relay] failed to add WG peer for %s: %v", truncAddr(suiAddr), err)
					} else {
						log.Printf("[wss-relay] added WG peer for %s (endpoint=%s)", truncAddr(suiAddr), endpoint)
					}
				}
				wssHandler.OnPeerDisconnected = func(suiAddr string) {
					if err := wgManager.RemovePeer(suiAddr); err != nil {
						log.Printf("[wss-relay] failed to remove WG peer for %s: %v", truncAddr(suiAddr), err)
					} else {
						log.Printf("[wss-relay] removed WG peer for %s", truncAddr(suiAddr))
					}
				}
			}

			mux := http.NewServeMux()
			mux.Handle("/wg-relay", wssHandler)
			wssAddr := fmt.Sprintf(":%d", cfg.Relay.WSSListenPort)
			go func() {
				if cfg.Relay.WSSCertFile != "" && cfg.Relay.WSSKeyFile != "" {
					log.Printf("[wss-relay] WSS relay server listening on %s (TLS)", wssAddr)
					if err := http.ListenAndServeTLS(wssAddr, cfg.Relay.WSSCertFile, cfg.Relay.WSSKeyFile, mux); err != nil {
						log.Printf("[wss-relay] server error: %v", err)
					}
				} else {
					log.Printf("[wss-relay] WARNING: starting without TLS — use wss_cert_file/wss_key_file or terminate TLS at reverse proxy")
					log.Printf("[wss-relay] WSS relay server listening on %s (plain HTTP)", wssAddr)
					if err := http.ListenAndServe(wssAddr, mux); err != nil {
						log.Printf("[wss-relay] server error: %v", err)
					}
				}
			}()
		}

		// Register as relay on SUI chain so clients can auto-discover this relay
		if suiClient != nil {
			wssPort := cfg.Relay.WSSListenPort
			if cfg.Relay.WSSExternalPort > 0 {
				wssPort = cfg.Relay.WSSExternalPort
			}
			relayAddr := fmt.Sprintf("%s:%d", relayIP, wssPort)
			capacity := uint64(cfg.Relay.MaxConnections)
			if err := suiClient.RegisterRelay(context.Background(), relayAddr, cfg.Relay.Region, cfg.Relay.ISP, capacity); err != nil {
				log.Printf("[sui] relay registration failed: %v", err)
			}
		}

		// Enable IP forwarding on the relay node so mesh traffic between
		// WSS clients can be routed through the WireGuard interface.
		wg.EnableIPForward(cfg.WireGuard.InterfaceName)
	} else if activeRoles.StunServer {
		// STUN-only server (no relay capability)
		stunOnlyServer = relay.NewStunOnlyServer(cfg.Relay.ListenPort)
		if err := stunOnlyServer.Start(); err != nil {
			log.Fatalf("[stun-server] failed to start: %v", err)
		}
		log.Printf("[stun-server] STUN server enabled on :%d", cfg.Relay.ListenPort)
	}

	if activeRoles.Coordinator {
		coordinatorServer = coordinator.NewServer(cfg.Coordinator.ListenAddr, 30*time.Second, cfg.Coordinator.APIToken)
		if connectionKeys != nil {
			if err := configureChainCoordinator(coordinatorServer, cfg, connectionReader, ctrlKey); err != nil {
				log.Fatalf("[coordinator] %v", err)
			}
		}
		if ctrlKey != nil {
			coordinatorServer.SetAuth(ctrlKey, cfg.Coordinator.AllowedSigners)
			log.Printf("[coordinator] control-channel auth enabled (allowed_signers=%d)", len(cfg.Coordinator.AllowedSigners))
		} else {
			log.Printf("[coordinator] WARNING: control-channel auth NOT enabled (no keypair); /ws accepts unauthenticated workers")
		}
		if err := coordinatorServer.Start(); err != nil {
			log.Fatalf("[coordinator] failed to start server on %s: %v", cfg.Coordinator.ListenAddr, err)
		}
		log.Printf("[coordinator] REST API listening on %s (routes: /api, /ws)", cfg.Coordinator.ListenAddr)
	}

	// ======= WSS relay client (for UDP-restricted nodes) =======
	if activeRoles.TCPFallbackActive && suiClient != nil {
		relayURL := cfg.Relay.RelayURL

		// Auto-discover relay from SUI chain when no relay_url configured
		if relayURL == "" {
			ctx := context.Background()
			peers, err := suiClient.QueryPeers(ctx)
			if err != nil {
				log.Printf("[wss-client] failed to query peers for relay discovery: %v", err)
			} else {
				picker := relaypicker.NewPicker(cfg.SUI.OrgID, cfg.Relay.Region, cfg.Relay.ISP, relaypicker.NewRelayLoadCache())
				candidates := picker.SelectBest(peers, 1)
				if len(candidates) > 0 && candidates[0].Peer.RelayAddr != "" {
					relayURL = fmt.Sprintf("wss://%s/wg-relay", candidates[0].Peer.RelayAddr)
					log.Printf("[wss-client] auto-discovered relay: %s (score=%d)", relayURL, candidates[0].Score)
				} else {
					log.Printf("[wss-client] no suitable relay found via SUI chain")
				}
			}
		} else {
			log.Printf("[wss-client] using configured relay_url: %s", relayURL)
		}

		if relayURL != "" {
			wssClient = relay.NewWSSClient(
				relayURL,
				suiClient.Address(),
				suiClient.Keypair(),
				fmt.Sprintf("127.0.0.1:%d", cfg.WireGuard.ListenPort),
			)
			if wgManager != nil {
				wssClient.SetWGPublicKey(wgManager.PublicKey())
			}
			ctx := context.Background()
			relayEndpoint, err := wssClient.Connect(ctx)
			if err != nil {
				log.Printf("[wss-client] failed to connect to relay: %v", err)
				wssClient = nil
			} else {
				log.Printf("[wss-client] connected via WSS relay, endpoint: %s", relayEndpoint)
				// Update SUI registration with the relay endpoint
				if err := suiClient.UpdateEndpoints(ctx, []string{relayEndpoint}); err != nil {
					log.Printf("[wss-client] failed to update SUI endpoint: %v", err)
				}
			}
		}
	}

	// ======= Initial peer sync (after WSS client setup) =======
	if suiClient != nil && wgManager != nil {
		ctx := context.Background()
		peers, err := suiClient.QueryPeers(ctx)
		if err != nil {
			log.Printf("[sui] failed to query peers: %v", err)
		} else if len(peers) > 0 {
			syncPeers(wgManager, wssClient, peers)
		}
	}

	// Handle commands from Gateway
	wsClient.OnCommand(func(cmd ws.CommandPayload) {
		log.Printf("[cmd] received: %s agent=%s", cmd.Command, cmd.AgentID)
		result := handleCommand(cmd, scanner, cfg, runtimeExecutor)
		wsClient.Send("command_result", map[string]interface{}{
			"request_id": cmd.RequestID,
			"result":     result,
		})
	})

	// Relay remote-desktop signaling from the coordinator to the local
	// envd-desktop server, so the console reaches the desktop over the
	// authenticated control channel instead of a public tunnel.
	wsClient.OnDesktopSignal(func(sig ws.DesktopSignalPayload) {
		if connectionKeys != nil {
			// Admission/observation is not a device's permission to control the
			// desktop. This legacy envelope cannot carry the required authority.
			wsClient.Send("desktop_signal_result", ws.DesktopSignalResult{RequestID: sig.RequestID, Status: http.StatusForbidden, Error: "signed device desktop authority required"})
			return
		}
		res := proxyDesktopSignal(cfg.Desktop, sig)
		wsClient.Send("desktop_signal_result", res)
	})

	// Register with Gateway on every (re)connect, once the control-channel
	// handshake has completed. A fixed post-connect delay loses the race on
	// high-latency links, and a one-shot register leaves reconnected workers
	// invisible (the coordinator drops heartbeats from unregistered nodes).
	wsClient.OnConnect(func() {
		if err := wsClient.Send("register", map[string]string{
			"host_id":     cfg.Identity.HostID,
			"hostname":    cfg.Identity.Hostname,
			"version":     version,
			"desktop_url": cfg.Identity.DesktopURL,
		}); err != nil {
			log.Printf("[ws] register send failed: %v", err)
		}
	})

	// Start WebSocket connection in background
	go wsClient.Connect()

	// Heartbeat + scan loop
	heartbeatTicker := time.NewTicker(heartbeatInterval)
	scanTicker := time.NewTicker(scanInterval)
	defer heartbeatTicker.Stop()
	defer scanTicker.Stop()
	if suiPollTicker != nil {
		defer suiPollTicker.Stop()
	}

	var discovery *agent.Discovery
	var nativeDiscovery *agent.Discovery
	// Chain-connected Hosts report a scan's actual timestamp and failure state.
	// An unreadable inventory must never keep renewing the previous list.
	scan := func() ([]agent.Agent, error) {
		if connectionKeys == nil {
			return scanner.Scan()
		}
		value := scanner.Discover()
		discovery = &value
		if runtime, ok := runtimeExecutor.(interface{ NativeDiscovery() *agent.Discovery }); ok {
			nativeDiscovery = runtime.NativeDiscovery()
		}
		rows := []agent.Agent{}
		for _, instance := range value.Instances {
			status := "running"
			if instance.State == "dead" {
				status = "dead"
			}
			rows = append(rows, agent.Agent{ID: instance.Session, Session: instance.Session, Status: status})
		}
		return rows, nil
	}
	if agents, err := scan(); err == nil {
		lastAgents = agents
		log.Printf("initial scan: %d agent panes found", len(agents))
	}

	// Signal handling
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Helper to get SUI poll channel (nil-safe)
	suiPollCh := func() <-chan time.Time {
		if suiPollTicker != nil {
			return suiPollTicker.C
		}
		return nil
	}

	for {
		select {
		case <-scanTicker.C:
			agents, err := scan()
			if err != nil {
				log.Printf("[scan] error: %v", err)
				continue
			}

			// Detect crashed agents (was running, now missing)
			if cfg.Agents.AutoRestart && connectionKeys == nil {
				detectAndRestart(lastAgents, agents, scanner, restartCounts, cfg.Agents.MaxRestartAttempts, wsClient)
			}

			lastAgents = agents

		case <-heartbeatTicker.C:
			payload := heartbeat.NewPayload(
				cfg.Identity.HostID,
				cfg.Identity.Hostname,
				lastAgents,
				startedAt,
			)
			payload.Discovery = discovery
			payload.NativeDiscovery = nativeDiscovery

			// v3: Attach relay load info if this node is a relay
			if activeRoles.Relay && relayServer != nil {
				info := relayServer.GetLoadInfo()
				payload.WithRelayLoad(info.CurrentLoad, info.Capacity, info.AvgLatencyMs)
			}

			if err := wsClient.Send("heartbeat", payload); err != nil {
				log.Printf("[heartbeat] send failed: %v", err)
			}

		case <-suiPollCh():
			// Poll SUI for new peer events
			if suiClient != nil && wgManager != nil {
				newPeers, newCursor, err := suiClient.PollNewEvents(context.Background(), eventCursor)
				if err != nil {
					log.Printf("[sui] event poll failed: %v", err)
				} else {
					eventCursor = newCursor
					if len(newPeers) > 0 {
						log.Printf("[sui] %d peer updates from poll", len(newPeers))
						syncPeers(wgManager, wssClient, newPeers)
					}
				}
			}

		case sig := <-sigCh:
			log.Printf("received signal %s, shutting down", sig)

			if desktopCancel != nil {
				desktopCancel()
				select {
				case err := <-desktopDone:
					if err != nil {
						log.Printf("[desktop-supervisor] shutdown failed: %v", err)
					}
				case <-time.After(6 * time.Second):
					log.Printf("[desktop-supervisor] shutdown timed out")
				}
			}

			// Graceful WSS relay shutdown
			if wssClient != nil {
				if err := wssClient.Close(); err != nil {
					log.Printf("[wss-client] close failed: %v", err)
				}
			}

			// Graceful relay/STUN shutdown
			if relayServer != nil {
				if err := relayServer.Close(); err != nil {
					log.Printf("[relay] close failed: %v", err)
				}
			}
			if stunOnlyServer != nil {
				if err := stunOnlyServer.Close(); err != nil {
					log.Printf("[stun-server] close failed: %v", err)
				}
			}

			// Graceful SUI + WireGuard shutdown
			if suiClient != nil {
				if err := suiClient.GoOffline(context.Background()); err != nil {
					log.Printf("[sui] go offline failed: %v", err)
				}
			}
			if wgManager != nil {
				if err := wgManager.Close(); err != nil {
					log.Printf("[wg] close failed: %v", err)
				}
			}
			if coordinatorServer != nil {
				shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				if err := coordinatorServer.Shutdown(shutdownCtx); err != nil {
					log.Printf("[coordinator] shutdown failed: %v", err)
				}
				cancel()
			}

			wsClient.Close()
			os.Exit(0)
		}
	}
}

func newDesktopSupervisor(cfg config.DesktopConfig) (*processsupervisor.Supervisor, error) {
	restartDelay, err := parseSupervisorDuration(cfg.RestartDelay, 2*time.Second)
	if err != nil {
		return nil, fmt.Errorf("restart_delay: %w", err)
	}
	healthInterval, err := parseSupervisorDuration(cfg.HealthCheckInterval, 10*time.Second)
	if err != nil {
		return nil, fmt.Errorf("health_check_interval: %w", err)
	}
	healthTimeout, err := parseSupervisorDuration(cfg.HealthCheckTimeout, 3*time.Second)
	if err != nil {
		return nil, fmt.Errorf("health_check_timeout: %w", err)
	}

	healthURL := ""
	if localAddr := strings.TrimRight(strings.TrimSpace(cfg.LocalAddr), "/"); localAddr != "" {
		healthURL = localAddr + "/healthz"
	}
	env := []string{"FRACTALMIND_SUPERVISOR_PID=" + strconv.Itoa(os.Getpid())}
	if cfg.Token != "" {
		env = append(env, "ENVD_DESKTOP_TOKEN="+cfg.Token)
	}
	return processsupervisor.New(processsupervisor.Config{
		Name:               "envd-desktop",
		Command:            strings.TrimSpace(cfg.Command),
		Args:               append([]string(nil), cfg.Args...),
		Env:                env,
		HealthURL:          healthURL,
		RestartDelay:       restartDelay,
		HealthInterval:     healthInterval,
		HealthTimeout:      healthTimeout,
		UnhealthyThreshold: cfg.UnhealthyThreshold,
	})
}

func parseSupervisorDuration(raw string, fallback time.Duration) (time.Duration, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, err
	}
	if value <= 0 {
		return 0, fmt.Errorf("must be positive")
	}
	return value, nil
}

func signedCommandLowRiskActions() map[string]struct{} {
	return map[string]struct{}{
		"inventory":    {},
		"status":       {},
		"monitor":      {},
		"logs":         {},
		"health":       {},
		"availability": {},
	}
}

func signedCommandHighRiskActions() map[string]struct{} {
	return map[string]struct{}{
		"start":          {},
		"stop":           {},
		"assign":         {},
		"direct.message": {},
	}
}

func splitRuntimeAdapterArgs(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return strings.Fields(raw)
}

// detectAndRestart checks for crashed agents and restarts them.
func detectAndRestart(prev, curr []agent.Agent, scanner *agent.Scanner, restartCounts map[string]int, maxAttempts int, wsClient *ws.Client) {
	currentSet := make(map[string]bool)
	for _, a := range curr {
		currentSet[a.Session] = true
	}

	for _, a := range prev {
		if a.Status == "running" && !currentSet[a.Session] {
			count := restartCounts[a.Session]
			if count >= maxAttempts {
				log.Printf("[auto-restart] %s: max attempts (%d) reached, alerting", a.Session, maxAttempts)
				wsClient.Send("alert", map[string]string{
					"type":    "agent_crash",
					"agent":   a.ID,
					"session": a.Session,
					"message": fmt.Sprintf("agent %s crashed, restart failed after %d attempts", a.ID, maxAttempts),
				})
				continue
			}

			log.Printf("[auto-restart] %s crashed, attempt %d/%d", a.Session, count+1, maxAttempts)
			if err := scanner.RestartAgent(a.Session); err != nil {
				log.Printf("[auto-restart] %s restart failed: %v", a.Session, err)
			}
			restartCounts[a.Session] = count + 1
		}
	}
}

// proxyDesktopSignal forwards a relayed signaling request to the local
// envd-desktop server and returns its response for the coordinator. Only the
// desktop signaling/status paths are allowed, and the desktop token is injected
// here so the console never has to hold it.
func proxyDesktopSignal(cfg config.DesktopConfig, sig ws.DesktopSignalPayload) ws.DesktopSignalResult {
	res := ws.DesktopSignalResult{RequestID: sig.RequestID}
	if cfg.LocalAddr == "" {
		res.Status = http.StatusServiceUnavailable
		res.Error = "desktop relay not configured on this node"
		return res
	}
	if sig.Path != "/offer" && sig.Path != "/ice" && sig.Path != "/status" {
		res.Status = http.StatusBadRequest
		res.Error = "unsupported desktop path"
		return res
	}

	method := sig.Method
	if method == "" {
		method = http.MethodGet
	}
	var body io.Reader
	if len(sig.Body) > 0 {
		body = bytes.NewReader(sig.Body)
	}
	req, err := http.NewRequest(method, strings.TrimRight(cfg.LocalAddr, "/")+sig.Path, body)
	if err != nil {
		res.Status = http.StatusInternalServerError
		res.Error = err.Error()
		return res
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		res.Status = http.StatusBadGateway
		res.Error = err.Error()
		return res
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	res.Status = resp.StatusCode
	if len(raw) > 0 {
		res.Body = json.RawMessage(raw)
	}
	return res
}

// handleCommand accepts only signed intents. Coordinator credentials establish
// a transport connection; they never authorize local agent or shell actions.
func handleCommand(cmd ws.CommandPayload, _ *agent.Scanner, _ *config.Config, runtimeExecutor runtimeCommandExecutor) map[string]interface{} {
	switch cmd.Command {
	case "signed_command", "signed-command", "node_command":
		return handleSignedCommand(context.Background(), cmd.Args, runtimeExecutor)
	default:
		return map[string]interface{}{
			"success":    false,
			"error_code": "unsigned_command_disabled",
			"error":      "commands require a signed NodeCommand with an authorized target, action and scope",
		}
	}
}

func parseShellTimeout(raw string) time.Duration {
	const defaultTimeout = 15 * time.Second

	if strings.TrimSpace(raw) == "" {
		return defaultTimeout
	}
	timeout, err := time.ParseDuration(raw)
	if err != nil || timeout <= 0 {
		log.Printf("[cmd] invalid agents.shell_timeout %q; using %s", raw, defaultTimeout)
		return defaultTimeout
	}
	return timeout
}

func handleSignedCommand(ctx context.Context, rawCommand string, runtimeExecutor runtimeCommandExecutor) map[string]interface{} {
	result := map[string]interface{}{
		"success": false,
	}
	if runtimeExecutor == nil {
		result["error_code"] = "runtime_configuration_required"
		result["error"] = "signed-command runtime requires runtime.enabled, Sui configuration and an initialized secure Host identity"
		return result
	}
	if strings.TrimSpace(rawCommand) == "" {
		result["error_code"] = "invalid_envelope"
		result["error"] = "signed command JSON is required in args"
		return result
	}

	var command nodecommand.NodeCommand
	decoder := json.NewDecoder(strings.NewReader(rawCommand))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&command); err != nil {
		result["error_code"] = "invalid_envelope"
		result["error"] = err.Error()
		return result
	}
	var trailing interface{}
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			err = fmt.Errorf("trailing JSON value")
		}
		result["error_code"] = "invalid_envelope"
		result["error"] = err.Error()
		return result
	}

	response, event, err := runtimeExecutor.Execute(ctx, command)
	if len(response.CommandID) > 0 {
		result["response"] = response
	}
	if event.CommandID != "" {
		result["event"] = event
	}
	if err != nil {
		result["error"] = err.Error()
		var rejection *nodecommand.RejectionError
		if errors.As(err, &rejection) {
			if rejection.ExecutionID != "" {
				result["execution_id"] = rejection.ExecutionID
			}
			if rejection.TransactionDigest != "" {
				result["transaction_digest"] = rejection.TransactionDigest
			}
			if rejection.Code == nodecommand.CodeExecutionUnknown {
				result["requires_confirmation"] = true
			}
		}
		if code := nodecommand.CodeOf(err); code != "" {
			result["error_code"] = code
		} else {
			result["error_code"] = runtimeadapter.RunErrorCode(err)
		}
		return result
	}
	if response.Error != nil {
		result["error_code"] = response.Error.Code
		result["error"] = response.Error.Message
	}
	result["success"] = response.OK
	return result
}

// shellCommandAllowed reports whether a shell command line is permitted by the
// allowlist. An empty allowlist permits any command (AllowShell must still be
// true). A non-empty allowlist matches argv[0] (the first whitespace-separated
// token) against the listed program names.
func shellCommandAllowed(cmdLine string, allowlist []string) bool {
	if len(allowlist) == 0 {
		return true
	}
	fields := strings.Fields(cmdLine)
	if len(fields) == 0 {
		return false
	}
	prog := fields[0]
	for _, a := range allowlist {
		if a == prog {
			return true
		}
	}
	return false
}

// syncPeers syncs WireGuard peers, routing through WSS relay when active.
// When wssClient is nil, peers are synced directly via WireGuard.
// When wssClient is active (TCP fallback), each peer gets a local UDP proxy
// and its WG endpoint is rewritten to the local proxy address.
func syncPeers(wgManager *wg.Manager, wssClient *relay.WSSClient, peers []sui.PeerInfo) {
	if wssClient == nil {
		// Direct mode: WireGuard peers use their SUI-registered endpoints
		if err := wgManager.SyncPeers(peers); err != nil {
			log.Printf("[wg] failed to sync peers: %v", err)
		}
		return
	}

	// WSS fallback mode: reconcile relay routes
	ctx := context.Background()

	// Build desired set from incoming peers
	desired := make(map[string]struct{})
	for _, p := range peers {
		if len(p.Endpoints) > 0 && p.Status == sui.PeerStatusOnline {
			desired[p.Address] = struct{}{}
		}
	}

	// Remove relay routes for peers no longer in the desired set
	for addr, peerID := range relayPeers {
		if _, ok := desired[addr]; !ok {
			if err := wssClient.RemovePeer(ctx, peerID); err != nil {
				log.Printf("[wss-client] failed to remove stale peer %s: %v", truncAddr(addr), err)
			} else {
				log.Printf("[wss-client] removed stale relay route for %s", truncAddr(addr))
			}
			delete(relayPeers, addr)
		}
	}

	// Add relay routes for new peers, skip already-routed ones
	for i, p := range peers {
		if len(p.Endpoints) == 0 || p.Status != sui.PeerStatusOnline {
			continue
		}
		if _, routed := relayPeers[p.Address]; routed {
			continue // already has an active relay route
		}
		localAddr, peerID, err := wssClient.AddPeer(ctx, p.Endpoints[0])
		if err != nil {
			log.Printf("[wss-client] failed to add peer %s via relay: %v", truncAddr(p.Address), err)
			continue
		}
		relayPeers[p.Address] = peerID
		// Rewrite endpoint to the local proxy address
		peers[i].Endpoints = []string{localAddr}
		log.Printf("[wss-client] peer %s routed via local proxy %s", truncAddr(p.Address), localAddr)
	}

	if err := wgManager.SyncPeers(peers); err != nil {
		log.Printf("[wg] failed to sync peers: %v", err)
	}
}

// truncAddr safely truncates an address for logging.
func truncAddr(s string) string {
	if len(s) > 16 {
		return s[:16]
	}
	return s
}

// waitAfterDeniedKey keeps a service process alive after the person cancelled
// or denied the OS prompt for the Host key. Exiting would let the service
// manager restart it and ask again in a loop; the App restarts it on request.
func waitAfterDeniedKey(err error) {
	log.Printf("[auth] %v; waiting. Restart the service from the FractalMind App to ask again.", err)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Printf("[auth] stopped while waiting for Host key access")
	os.Exit(0)
}
