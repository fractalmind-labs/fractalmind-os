package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Server struct {
	Name            string
	Scope           string
	SourcePath      string
	Type            string
	Command         string
	Args            []string
	URL             string
	HeaderKeys      []string
	EnvKeys         []string
	OAuthConfigured bool
}

type ListResult struct {
	Checked []string
	Servers map[string]Server
}

type AddOptions struct {
	Scope        string
	Transport    string
	Name         string
	Target       string
	Args         []string
	Headers      map[string]string
	Env          map[string]string
	ClientID     string
	CallbackPort int
}

type RemoveOptions struct {
	Name  string
	Scope string
}

type ChangeResult struct {
	Status     string
	Name       string
	Scope      string
	Type       string
	TargetFile string
	Command    string
	Args       []string
	URL        string
}

type rawConfigFile struct {
	MCPServers map[string]json.RawMessage `json:"mcpServers"`
}

type rawDocument struct {
	Top     map[string]json.RawMessage
	Servers map[string]json.RawMessage
}

type oauthConfig struct {
	ClientID     string `json:"clientId,omitempty"`
	CallbackPort int    `json:"callbackPort,omitempty"`
}

type stdioConfig struct {
	Type    string            `json:"type,omitempty"`
	Command string            `json:"command"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

type remoteConfig struct {
	Type    string            `json:"type"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers,omitempty"`
	OAuth   *oauthConfig      `json:"oauth,omitempty"`
}

var validNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func List() (ListResult, error) {
	userPath, err := resolveUserSettingsPath()
	if err != nil {
		return ListResult{}, err
	}
	projectPaths, err := resolveProjectMCPPaths()
	if err != nil {
		return ListResult{}, err
	}
	localPath, err := resolveLocalSettingsPath()
	if err != nil {
		return ListResult{}, err
	}

	checked := []string{
		fmt.Sprintf("user=%s", userPath),
		fmt.Sprintf("project=%s", joinPaths(existingPaths(projectPaths))),
		fmt.Sprintf("local=%s", localPath),
	}

	merged := map[string]Server{}
	if err := mergeServers(merged, "user", []string{userPath}); err != nil {
		return ListResult{}, err
	}
	if err := mergeServers(merged, "project", projectPaths); err != nil {
		return ListResult{}, err
	}
	if err := mergeServers(merged, "local", []string{localPath}); err != nil {
		return ListResult{}, err
	}

	return ListResult{Checked: checked, Servers: merged}, nil
}

func Get(name string) (Server, error) {
	result, err := List()
	if err != nil {
		return Server{}, err
	}
	server, ok := result.Servers[name]
	if !ok {
		return Server{}, fmt.Errorf("no MCP server found with name: %s", name)
	}
	return server, nil
}

func Add(opts AddOptions) (ChangeResult, error) {
	scope, err := ensureScope(opts.Scope)
	if err != nil {
		return ChangeResult{}, err
	}
	transport, err := ensureTransport(opts.Transport)
	if err != nil {
		return ChangeResult{}, err
	}
	if !validNamePattern.MatchString(strings.TrimSpace(opts.Name)) {
		return ChangeResult{}, fmt.Errorf("invalid name %s. names can only contain letters, numbers, hyphens, and underscores", opts.Name)
	}
	if strings.TrimSpace(opts.Target) == "" {
		return ChangeResult{}, fmt.Errorf("missing MCP target")
	}
	if (transport == "http" || transport == "sse") && len(opts.Args) > 0 {
		return ChangeResult{}, fmt.Errorf("transport %s does not accept command args", transport)
	}
	if transport == "stdio" && len(opts.Headers) > 0 {
		return ChangeResult{}, fmt.Errorf("--header is only supported for http/sse transports")
	}
	if transport != "stdio" && len(opts.Env) > 0 {
		return ChangeResult{}, fmt.Errorf("--env is only supported for stdio transport")
	}

	targetFile, err := resolveAddTargetFile(scope)
	if err != nil {
		return ChangeResult{}, err
	}
	doc, err := loadRawDocument(targetFile)
	if err != nil {
		return ChangeResult{}, err
	}
	if _, exists := doc.Servers[opts.Name]; exists {
		return ChangeResult{}, fmt.Errorf("MCP server %s already exists in %s config", opts.Name, scope)
	}

	payload, result, err := buildServerPayload(scope, transport, targetFile, opts)
	if err != nil {
		return ChangeResult{}, err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return ChangeResult{}, err
	}
	doc.Servers[opts.Name] = raw
	if err := writeRawDocument(targetFile, doc); err != nil {
		return ChangeResult{}, err
	}
	return result, nil
}

func Remove(opts RemoveOptions) (ChangeResult, error) {
	name := strings.TrimSpace(opts.Name)
	if name == "" {
		return ChangeResult{}, fmt.Errorf("missing MCP server name")
	}

	if strings.TrimSpace(opts.Scope) != "" {
		scope, err := ensureScope(opts.Scope)
		if err != nil {
			return ChangeResult{}, err
		}
		server, err := findVisibleServerInScope(name, scope)
		if err != nil {
			return ChangeResult{}, err
		}
		if server.Name == "" {
			return ChangeResult{}, fmt.Errorf("no %s-scoped MCP server found with name: %s", scope, name)
		}
		return removeServerAt(server)
	}

	matches, err := findVisibleMatches(name)
	if err != nil {
		return ChangeResult{}, err
	}
	if len(matches) == 0 {
		return ChangeResult{}, fmt.Errorf("no MCP server found with name: %s", name)
	}
	if len(matches) > 1 {
		scopes := make([]string, 0, len(matches))
		for _, match := range matches {
			scopes = append(scopes, fmt.Sprintf("%s(%s)", match.Scope, match.SourcePath))
		}
		return ChangeResult{}, fmt.Errorf("MCP server %q exists in multiple scopes: %s; rerun with --scope <local|project|user>", name, strings.Join(scopes, ", "))
	}
	return removeServerAt(matches[0])
}

func (r ListResult) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("checked=%s\n", strings.Join(r.Checked, "; ")))
	b.WriteString(fmt.Sprintf("server_count=%d\n", len(r.Servers)))
	if len(r.Servers) == 0 {
		b.WriteString("servers=none\n")
		return b.String()
	}

	names := make([]string, 0, len(r.Servers))
	for name := range r.Servers {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		server := r.Servers[name]
		b.WriteString(fmt.Sprintf("- name=%s scope=%s type=%s source=%s\n", server.Name, valueOrNone(server.Scope), valueOrNone(server.Type), valueOrNone(server.SourcePath)))
		if server.Command != "" {
			b.WriteString(fmt.Sprintf("  command=%s\n", server.Command))
		}
		if len(server.Args) > 0 {
			b.WriteString(fmt.Sprintf("  args=%s\n", strings.Join(server.Args, " ")))
		}
		if server.URL != "" {
			b.WriteString(fmt.Sprintf("  url=%s\n", server.URL))
		}
		if len(server.HeaderKeys) > 0 {
			b.WriteString(fmt.Sprintf("  header_keys=%s\n", strings.Join(server.HeaderKeys, ",")))
		}
		if len(server.EnvKeys) > 0 {
			b.WriteString(fmt.Sprintf("  env_keys=%s\n", strings.Join(server.EnvKeys, ",")))
		}
		b.WriteString(fmt.Sprintf("  oauth_configured=%t\n", server.OAuthConfigured))
	}

	return b.String()
}

func (s Server) String() string {
	lines := []string{
		fmt.Sprintf("name=%s", valueOrNone(s.Name)),
		fmt.Sprintf("scope=%s", valueOrNone(s.Scope)),
		fmt.Sprintf("type=%s", valueOrNone(s.Type)),
		fmt.Sprintf("source=%s", valueOrNone(s.SourcePath)),
	}
	if s.Command != "" {
		lines = append(lines, fmt.Sprintf("command=%s", s.Command))
	}
	if len(s.Args) > 0 {
		lines = append(lines, fmt.Sprintf("args=%s", strings.Join(s.Args, " ")))
	}
	if s.URL != "" {
		lines = append(lines, fmt.Sprintf("url=%s", s.URL))
	}
	if len(s.HeaderKeys) > 0 {
		lines = append(lines, fmt.Sprintf("header_keys=%s", strings.Join(s.HeaderKeys, ",")))
	}
	if len(s.EnvKeys) > 0 {
		lines = append(lines, fmt.Sprintf("env_keys=%s", strings.Join(s.EnvKeys, ",")))
	}
	lines = append(lines, fmt.Sprintf("oauth_configured=%t", s.OAuthConfigured))
	return strings.Join(lines, "\n") + "\n"
}

func (r ChangeResult) String() string {
	lines := []string{
		fmt.Sprintf("status=%s", valueOrNone(r.Status)),
		fmt.Sprintf("name=%s", valueOrNone(r.Name)),
		fmt.Sprintf("scope=%s", valueOrNone(r.Scope)),
		fmt.Sprintf("type=%s", valueOrNone(r.Type)),
		fmt.Sprintf("target_file=%s", valueOrNone(r.TargetFile)),
	}
	if r.Command != "" {
		lines = append(lines, fmt.Sprintf("command=%s", r.Command))
	}
	if len(r.Args) > 0 {
		lines = append(lines, fmt.Sprintf("args=%s", strings.Join(r.Args, " ")))
	}
	if r.URL != "" {
		lines = append(lines, fmt.Sprintf("url=%s", r.URL))
	}
	return strings.Join(lines, "\n") + "\n"
}

func buildServerPayload(scope string, transport string, targetFile string, opts AddOptions) (any, ChangeResult, error) {
	result := ChangeResult{
		Status:     "added",
		Name:       opts.Name,
		Scope:      scope,
		Type:       transport,
		TargetFile: targetFile,
	}
	if transport == "stdio" {
		result.Command = opts.Target
		result.Args = append([]string(nil), opts.Args...)
		return stdioConfig{
			Type:    "stdio",
			Command: opts.Target,
			Args:    opts.Args,
			Env:     cloneStringMap(opts.Env),
		}, result, nil
	}
	oauth := buildOAuth(opts)
	result.URL = opts.Target
	return remoteConfig{
		Type:    transport,
		URL:     opts.Target,
		Headers: cloneStringMap(opts.Headers),
		OAuth:   oauth,
	}, result, nil
}

func buildOAuth(opts AddOptions) *oauthConfig {
	if strings.TrimSpace(opts.ClientID) == "" && opts.CallbackPort == 0 {
		return nil
	}
	return &oauthConfig{
		ClientID:     strings.TrimSpace(opts.ClientID),
		CallbackPort: opts.CallbackPort,
	}
}

func removeServerAt(server Server) (ChangeResult, error) {
	doc, err := loadRawDocument(server.SourcePath)
	if err != nil {
		return ChangeResult{}, err
	}
	if _, exists := doc.Servers[server.Name]; !exists {
		return ChangeResult{}, fmt.Errorf("no %s-scoped MCP server found with name: %s", server.Scope, server.Name)
	}
	delete(doc.Servers, server.Name)
	if err := writeRawDocument(server.SourcePath, doc); err != nil {
		return ChangeResult{}, err
	}
	return ChangeResult{
		Status:     "removed",
		Name:       server.Name,
		Scope:      server.Scope,
		Type:       server.Type,
		TargetFile: server.SourcePath,
	}, nil
}

func mergeServers(dst map[string]Server, scope string, paths []string) error {
	for _, path := range paths {
		servers, err := loadServersFromFile(path, scope)
		if err != nil {
			return err
		}
		for name, server := range servers {
			dst[name] = server
		}
	}
	return nil
}

func loadServersFromFile(path string, scope string) (map[string]Server, error) {
	doc, err := loadRawDocument(path)
	if err != nil {
		return nil, err
	}
	servers := make(map[string]Server, len(doc.Servers))
	for name, raw := range doc.Servers {
		server, err := parseServer(name, scope, path, raw)
		if err != nil {
			return nil, fmt.Errorf("parse %s:%s: %w", path, name, err)
		}
		servers[name] = server
	}
	return servers, nil
}

func parseServer(name string, scope string, path string, raw json.RawMessage) (Server, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return Server{}, err
	}

	serverType := strings.TrimSpace(stringValue(payload["type"]))
	if serverType == "" {
		serverType = "stdio"
	}

	server := Server{
		Name:            name,
		Scope:           scope,
		SourcePath:      path,
		Type:            serverType,
		Command:         stringValue(payload["command"]),
		Args:            stringSlice(payload["args"]),
		URL:             stringValue(payload["url"]),
		HeaderKeys:      sortedKeys(payload["headers"]),
		EnvKeys:         sortedKeys(payload["env"]),
		OAuthConfigured: objectLength(payload["oauth"]) > 0,
	}
	return server, nil
}

func loadRawDocument(path string) (rawDocument, error) {
	doc := rawDocument{
		Top:     map[string]json.RawMessage{},
		Servers: map[string]json.RawMessage{},
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return doc, nil
		}
		return rawDocument{}, err
	}
	if err := json.Unmarshal(data, &doc.Top); err != nil {
		return rawDocument{}, fmt.Errorf("parse %s: %w", path, err)
	}
	if raw, ok := doc.Top["mcpServers"]; ok {
		if err := json.Unmarshal(raw, &doc.Servers); err != nil {
			return rawDocument{}, fmt.Errorf("parse %s mcpServers: %w", path, err)
		}
	}
	if doc.Servers == nil {
		doc.Servers = map[string]json.RawMessage{}
	}
	return doc, nil
}

func writeRawDocument(path string, doc rawDocument) error {
	if doc.Top == nil {
		doc.Top = map[string]json.RawMessage{}
	}
	if doc.Servers == nil {
		doc.Servers = map[string]json.RawMessage{}
	}
	rawServers, err := json.Marshal(doc.Servers)
	if err != nil {
		return err
	}
	doc.Top["mcpServers"] = rawServers
	data, err := json.MarshalIndent(doc.Top, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

func findVisibleMatches(name string) ([]Server, error) {
	matches := make([]Server, 0, 3)
	for _, scope := range []string{"local", "project", "user"} {
		server, err := findVisibleServerInScope(name, scope)
		if err != nil {
			return nil, err
		}
		if server.Name != "" {
			matches = append(matches, server)
		}
	}
	return matches, nil
}

func findVisibleServerInScope(name string, scope string) (Server, error) {
	switch scope {
	case "local":
		path, err := resolveLocalSettingsPath()
		if err != nil {
			return Server{}, err
		}
		servers, err := loadServersFromFile(path, scope)
		if err != nil {
			return Server{}, err
		}
		return servers[name], nil
	case "user":
		path, err := resolveUserSettingsPath()
		if err != nil {
			return Server{}, err
		}
		servers, err := loadServersFromFile(path, scope)
		if err != nil {
			return Server{}, err
		}
		return servers[name], nil
	case "project":
		paths, err := resolveProjectMCPPaths()
		if err != nil {
			return Server{}, err
		}
		for i := len(paths) - 1; i >= 0; i-- {
			servers, err := loadServersFromFile(paths[i], scope)
			if err != nil {
				return Server{}, err
			}
			if server, ok := servers[name]; ok {
				return server, nil
			}
		}
		return Server{}, nil
	default:
		return Server{}, fmt.Errorf("invalid scope: %s", scope)
	}
}

func resolveUserSettingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude", "settings.json"), nil
}

func resolveLocalSettingsPath() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	return filepath.Join(cwd, ".claude", "settings.local.json"), nil
}

func resolveAddTargetFile(scope string) (string, error) {
	switch scope {
	case "local":
		return resolveLocalSettingsPath()
	case "user":
		return resolveUserSettingsPath()
	case "project":
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		return filepath.Join(cwd, ".mcp.json"), nil
	default:
		return "", fmt.Errorf("invalid scope: %s", scope)
	}
}

func resolveProjectMCPPaths() ([]string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	current := filepath.Clean(cwd)
	paths := []string{}
	seen := map[string]bool{}
	for {
		candidate := filepath.Join(current, ".mcp.json")
		if !seen[candidate] {
			paths = append(paths, candidate)
			seen[candidate] = true
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}

	for i, j := 0, len(paths)-1; i < j; i, j = i+1, j-1 {
		paths[i], paths[j] = paths[j], paths[i]
	}
	return paths, nil
}

func joinPaths(paths []string) string {
	if len(paths) == 0 {
		return "none"
	}
	return strings.Join(paths, ",")
}

func existingPaths(paths []string) []string {
	existing := make([]string, 0, len(paths))
	for _, path := range paths {
		if _, err := os.Stat(path); err == nil {
			existing = append(existing, path)
		}
	}
	return existing
}

func ensureScope(scope string) (string, error) {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		return "local", nil
	}
	switch scope {
	case "local", "project", "user":
		return scope, nil
	default:
		return "", fmt.Errorf("invalid scope: %s. must be one of: local, project, user", scope)
	}
}

func ensureTransport(transport string) (string, error) {
	transport = strings.TrimSpace(transport)
	if transport == "" {
		return "stdio", nil
	}
	switch transport {
	case "stdio", "http", "sse":
		return transport, nil
	default:
		return "", fmt.Errorf("invalid transport type: %s. must be one of: stdio, sse, http", transport)
	}
}

func ParseEnv(entries []string) (map[string]string, error) {
	return parseKeyValueEntries(entries, "=")
}

func ParseHeaders(entries []string) (map[string]string, error) {
	return parseKeyValueEntries(entries, ":")
}

func ParsePositivePort(raw string) (int, error) {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("invalid callback port: %s", raw)
	}
	return value, nil
}

func parseKeyValueEntries(entries []string, separator string) (map[string]string, error) {
	if len(entries) == 0 {
		return nil, nil
	}
	result := make(map[string]string, len(entries))
	for _, entry := range entries {
		idx := strings.Index(entry, separator)
		if idx <= 0 {
			return nil, fmt.Errorf("invalid value %q", entry)
		}
		key := strings.TrimSpace(entry[:idx])
		value := strings.TrimSpace(entry[idx+len(separator):])
		if key == "" || value == "" {
			return nil, fmt.Errorf("invalid value %q", entry)
		}
		result[key] = value
	}
	return result, nil
}

func stringValue(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func stringSlice(v any) []string {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

func sortedKeys(v any) []string {
	obj, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(obj))
	for key := range obj {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func objectLength(v any) int {
	obj, ok := v.(map[string]any)
	if !ok {
		return 0
	}
	return len(obj)
}

func cloneStringMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(src))
	for k, v := range src {
		cloned[k] = v
	}
	return cloned
}

func valueOrNone(v string) string {
	if strings.TrimSpace(v) == "" {
		return "none"
	}
	return v
}
