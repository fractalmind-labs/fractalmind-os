package secrets

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
)

// Environment is what store selection looks at. Tests replace it.
type Environment struct {
	GOOS      string
	LookupEnv func(string) (string, bool)
	Exists    func(string) bool
}

// HostEnvironment describes the running process.
func HostEnvironment() Environment {
	return Environment{
		GOOS:      runtime.GOOS,
		LookupEnv: os.LookupEnv,
		Exists: func(path string) bool {
			_, err := os.Stat(path)
			return err == nil
		},
	}
}

// Resolver maps secret names to the store that holds them on this machine.
type Resolver struct {
	cfg       Config
	env       Environment
	fileDir   string
	namespace string
	def       Store
	reason    string
}

// NewResolver selects this machine's stores. dataDir holds the file store
// (`<dataDir>/secrets`).
func NewResolver(cfg Config, dataDir string, env Environment) (*Resolver, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	r := &Resolver{cfg: cfg, env: env, fileDir: filepath.Join(dataDir, "secrets"), namespace: cfg.Namespace}
	if r.namespace == "" {
		r.namespace = defaultNamespace
	}
	kind := cfg.Store
	r.reason = "configured"
	if kind == "" || kind == "auto" {
		kind, r.reason = r.autoKind()
	}
	if kind == "command" {
		r.def = commandStore{argv: cfg.Command, appendName: true}
	} else {
		r.def = r.store(kind)
	}
	return r, nil
}

// autoKind picks os where a credential store is expected, env in containers
// and file on Linux without a session bus.
func (r *Resolver) autoKind() (string, string) {
	if _, ok := r.env.LookupEnv("KUBERNETES_SERVICE_HOST"); ok || r.env.Exists("/.dockerenv") {
		return "env", "auto: container"
	}
	if r.env.GOOS == "linux" {
		if v, ok := r.env.LookupEnv("DBUS_SESSION_BUS_ADDRESS"); !ok || v == "" {
			return "file", "auto: Linux without a session bus"
		}
		return "os", "auto: Linux Secret Service"
	}
	return "os", "auto: " + r.env.GOOS + " credential store"
}

func (r *Resolver) store(kind string) Store {
	switch kind {
	case "file":
		return fileStore{dir: r.fileDir}
	case "env":
		return envStore{lookup: r.env.LookupEnv}
	default:
		return osStore{namespace: r.namespace}
	}
}

// Default returns this machine's default store and why it was chosen.
func (r *Resolver) Default() (Store, string) { return r.def, r.reason }

// StoreFor returns the store that holds name.
func (r *Resolver) StoreFor(name string) Store {
	if o, ok := r.cfg.Overrides[name]; ok {
		if len(o.Command) > 0 {
			return commandStore{argv: o.Command}
		}
		return r.store(o.Store)
	}
	return r.def
}

// Result is one secret's resolution. Value is empty when Err is set.
type Result struct {
	Name  string
	Store string
	Value string
	Err   error
}

// Resolve reads every named secret. A missing or unreadable secret is
// reported in its Result and does not stop the others.
func (r *Resolver) Resolve(names []string) []Result {
	unique := map[string]bool{}
	for _, n := range names {
		unique[n] = true
	}
	sorted := make([]string, 0, len(unique))
	for n := range unique {
		sorted = append(sorted, n)
	}
	sort.Strings(sorted)
	results := make([]Result, 0, len(sorted))
	for _, name := range sorted {
		store := r.StoreFor(name)
		res := Result{Name: name, Store: store.Kind()}
		if err := store.Available(); err != nil {
			res.Err = err
		} else if value, err := store.Get(name); err != nil {
			res.Err = err
		} else {
			res.Value = value
		}
		results = append(results, res)
	}
	return results
}

// Missing reports whether a resolution failed only because no value is set.
func (res Result) Missing() bool { return errors.Is(res.Err, ErrNotFound) }
