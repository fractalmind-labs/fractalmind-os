package plugin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Installation struct {
	ID          string
	Scope       string
	Version     string
	InstallPath string
	ProjectPath string
	InstalledAt string
	LastUpdated string
}

type ListResult struct {
	SourcePath    string
	SchemaVersion int
	Installations []Installation
}

type Marketplace struct {
	Name        string
	SourceType  string
	Repo        string
	URL         string
	Path        string
	InstallPath string
	LastUpdated string
}

type MarketplaceListResult struct {
	SourcePath   string
	Marketplaces []Marketplace
}

type InstallOptions struct {
	Plugin  string
	Scope   string
	Version string
}

type UninstallOptions struct {
	Plugin string
	Scope  string
}

type MarketplaceAddOptions struct {
	Source string
	Scope  string
}

type ChangeResult struct {
	Status      string
	PluginID    string
	Scope       string
	Version     string
	SourcePath  string
	InstallPath string
	ProjectPath string
}

type installedPluginsFile struct {
	Version int                             `json:"version"`
	Plugins map[string][]installationRecord `json:"plugins"`
}

type installationRecord struct {
	Scope       string `json:"scope"`
	ProjectPath string `json:"projectPath,omitempty"`
	InstallPath string `json:"installPath"`
	Version     string `json:"version,omitempty"`
	InstalledAt string `json:"installedAt,omitempty"`
	LastUpdated string `json:"lastUpdated,omitempty"`
}

type knownMarketplaceFile map[string]knownMarketplaceEntry

type knownMarketplaceEntry struct {
	Source          map[string]any `json:"source"`
	InstallLocation string         `json:"installLocation"`
	LastUpdated     string         `json:"lastUpdated"`
}

var (
	validPluginPattern  = regexp.MustCompile(`^[A-Za-z0-9._-]+(?:@[A-Za-z0-9._-]+)?$`)
	validScopePattern   = regexp.MustCompile(`^(user|project|local)$`)
	validVersionPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
)

func List() (ListResult, error) {
	sourcePath, err := resolveInstalledPluginsPath()
	if err != nil {
		return ListResult{}, err
	}

	payload, err := loadInstalledPluginsFile(sourcePath)
	if err != nil {
		return ListResult{}, err
	}

	installs := make([]Installation, 0)
	pluginIDs := make([]string, 0, len(payload.Plugins))
	for pluginID := range payload.Plugins {
		pluginIDs = append(pluginIDs, pluginID)
	}
	sort.Strings(pluginIDs)

	for _, pluginID := range pluginIDs {
		entries := sortInstallationRecords(payload.Plugins[pluginID])
		for _, entry := range entries {
			installs = append(installs, Installation{
				ID:          pluginID,
				Scope:       strings.TrimSpace(entry.Scope),
				Version:     strings.TrimSpace(entry.Version),
				InstallPath: strings.TrimSpace(entry.InstallPath),
				ProjectPath: strings.TrimSpace(entry.ProjectPath),
				InstalledAt: strings.TrimSpace(entry.InstalledAt),
				LastUpdated: strings.TrimSpace(entry.LastUpdated),
			})
		}
	}

	return ListResult{
		SourcePath:    sourcePath,
		SchemaVersion: payload.Version,
		Installations: installs,
	}, nil
}

func Install(opts InstallOptions) (ChangeResult, error) {
	pluginID := strings.TrimSpace(opts.Plugin)
	if !validPluginPattern.MatchString(pluginID) {
		return ChangeResult{}, fmt.Errorf("invalid plugin %q. expected name or name@marketplace", opts.Plugin)
	}

	scope, err := normalizeScope(opts.Scope)
	if err != nil {
		return ChangeResult{}, err
	}

	version := strings.TrimSpace(opts.Version)
	if version == "" {
		version = "0.0.0-dev"
	}
	if !validVersionPattern.MatchString(version) {
		return ChangeResult{}, fmt.Errorf("invalid version %q", opts.Version)
	}

	sourcePath, err := resolveInstalledPluginsPath()
	if err != nil {
		return ChangeResult{}, err
	}
	pluginsDir, err := resolvePluginsDirectory()
	if err != nil {
		return ChangeResult{}, err
	}
	payload, err := loadInstalledPluginsFile(sourcePath)
	if err != nil {
		return ChangeResult{}, err
	}

	projectPath, err := resolveProjectPathForScope(scope)
	if err != nil {
		return ChangeResult{}, err
	}

	installPath := buildInstallPath(pluginsDir, pluginID, version)
	if err := os.MkdirAll(installPath, 0o755); err != nil {
		return ChangeResult{}, fmt.Errorf("create install path: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	installations := append([]installationRecord(nil), payload.Plugins[pluginID]...)
	existingIndex := findInstallationIndex(installations, scope, projectPath)
	status := "installed"
	installedAt := now
	if existingIndex >= 0 {
		status = "updated"
		if strings.TrimSpace(installations[existingIndex].InstalledAt) != "" {
			installedAt = strings.TrimSpace(installations[existingIndex].InstalledAt)
		}
	}

	record := installationRecord{
		Scope:       scope,
		ProjectPath: projectPath,
		InstallPath: installPath,
		Version:     version,
		InstalledAt: installedAt,
		LastUpdated: now,
	}
	if existingIndex >= 0 {
		installations[existingIndex] = record
	} else {
		installations = append(installations, record)
	}
	payload.Plugins[pluginID] = sortInstallationRecords(installations)

	if err := writeInstallMetadataFile(installPath, pluginID, record); err != nil {
		return ChangeResult{}, err
	}
	if err := saveInstalledPluginsFile(sourcePath, payload); err != nil {
		return ChangeResult{}, err
	}

	return ChangeResult{
		Status:      status,
		PluginID:    pluginID,
		Scope:       scope,
		Version:     version,
		SourcePath:  sourcePath,
		InstallPath: installPath,
		ProjectPath: projectPath,
	}, nil
}

func Uninstall(opts UninstallOptions) (ChangeResult, error) {
	pluginID := strings.TrimSpace(opts.Plugin)
	if !validPluginPattern.MatchString(pluginID) {
		return ChangeResult{}, fmt.Errorf("invalid plugin %q. expected name or name@marketplace", opts.Plugin)
	}

	scope, err := normalizeScope(opts.Scope)
	if err != nil {
		return ChangeResult{}, err
	}

	sourcePath, err := resolveInstalledPluginsPath()
	if err != nil {
		return ChangeResult{}, err
	}
	payload, err := loadInstalledPluginsFile(sourcePath)
	if err != nil {
		return ChangeResult{}, err
	}
	projectPath, err := resolveProjectPathForScope(scope)
	if err != nil {
		return ChangeResult{}, err
	}

	installations := append([]installationRecord(nil), payload.Plugins[pluginID]...)
	if len(installations) == 0 {
		return ChangeResult{}, fmt.Errorf("plugin %q is not installed", pluginID)
	}
	index := findInstallationIndex(installations, scope, projectPath)
	if index < 0 {
		available := summarizeInstalledScopes(installations)
		if available == "" {
			available = "none"
		}
		return ChangeResult{}, fmt.Errorf("plugin %q is not installed in %s scope (available=%s)", pluginID, scope, available)
	}

	removed := installations[index]
	remaining := append([]installationRecord(nil), installations[:index]...)
	remaining = append(remaining, installations[index+1:]...)
	if len(remaining) == 0 {
		delete(payload.Plugins, pluginID)
	} else {
		payload.Plugins[pluginID] = sortInstallationRecords(remaining)
	}
	if err := saveInstalledPluginsFile(sourcePath, payload); err != nil {
		return ChangeResult{}, err
	}
	if removed.InstallPath != "" {
		if err := os.RemoveAll(removed.InstallPath); err != nil {
			return ChangeResult{}, fmt.Errorf("remove install path: %w", err)
		}
	}

	return ChangeResult{
		Status:      "removed",
		PluginID:    pluginID,
		Scope:       scope,
		Version:     removed.Version,
		SourcePath:  sourcePath,
		InstallPath: removed.InstallPath,
		ProjectPath: removed.ProjectPath,
	}, nil
}

func AddMarketplace(opts MarketplaceAddOptions) (ChangeResult, error) {
	source := strings.TrimSpace(opts.Source)
	if source == "" {
		return ChangeResult{}, fmt.Errorf("missing marketplace source")
	}
	scope, err := normalizeScope(opts.Scope)
	if err != nil {
		return ChangeResult{}, err
	}

	name, sourcePayload, err := parseMarketplaceSource(source)
	if err != nil {
		return ChangeResult{}, err
	}

	settingsPath, err := resolveSettingsPath(scope)
	if err != nil {
		return ChangeResult{}, err
	}
	pluginsDir, err := resolvePluginsDirectory()
	if err != nil {
		return ChangeResult{}, err
	}
	knownPath := filepath.Join(pluginsDir, "known_marketplaces.json")
	installLocation := filepath.Join(pluginsDir, "marketplaces", sanitizePathSegment(name))
	if err := os.MkdirAll(installLocation, 0o755); err != nil {
		return ChangeResult{}, fmt.Errorf("create marketplace directory: %w", err)
	}

	settingsDoc, err := loadJSONDocument(settingsPath)
	if err != nil {
		return ChangeResult{}, err
	}
	extra := readObjectField(settingsDoc, "extraKnownMarketplaces")
	status := "added"
	if _, exists := extra[name]; exists {
		status = "updated"
	}
	extra[name] = map[string]any{
		"source":          sourcePayload,
		"installLocation": installLocation,
	}
	settingsDoc["extraKnownMarketplaces"] = extra
	if err := writeJSONDocument(settingsPath, settingsDoc); err != nil {
		return ChangeResult{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	knownDoc, err := loadKnownMarketplaceFile(knownPath)
	if err != nil {
		return ChangeResult{}, err
	}
	knownDoc[name] = knownMarketplaceEntry{
		Source:          sourcePayload,
		InstallLocation: installLocation,
		LastUpdated:     now,
	}
	if err := saveKnownMarketplaceFile(knownPath, knownDoc); err != nil {
		return ChangeResult{}, err
	}

	return ChangeResult{
		Status:      status,
		PluginID:    name,
		Scope:       scope,
		SourcePath:  settingsPath,
		InstallPath: installLocation,
		Version:     valueOrUnknown(sourceTypeOf(sourcePayload)),
		ProjectPath: knownPath,
	}, nil
}

func ListMarketplaces() (MarketplaceListResult, error) {
	pluginsDir, err := resolvePluginsDirectory()
	if err != nil {
		return MarketplaceListResult{}, err
	}
	sourcePath := filepath.Join(pluginsDir, "known_marketplaces.json")
	doc, err := loadKnownMarketplaceFile(sourcePath)
	if err != nil {
		return MarketplaceListResult{}, err
	}

	names := make([]string, 0, len(doc))
	for name := range doc {
		names = append(names, name)
	}
	sort.Strings(names)

	items := make([]Marketplace, 0, len(names))
	for _, name := range names {
		entry := doc[name]
		item := Marketplace{
			Name:        name,
			SourceType:  sourceTypeOf(entry.Source),
			InstallPath: strings.TrimSpace(entry.InstallLocation),
			LastUpdated: strings.TrimSpace(entry.LastUpdated),
		}
		switch item.SourceType {
		case "github":
			item.Repo, _ = entry.Source["repo"].(string)
		case "git", "url":
			item.URL, _ = entry.Source["url"].(string)
		case "directory", "file":
			item.Path, _ = entry.Source["path"].(string)
		}
		items = append(items, item)
	}

	return MarketplaceListResult{
		SourcePath:   sourcePath,
		Marketplaces: items,
	}, nil
}

func RemoveMarketplace(name string) (ChangeResult, error) {
	marketplaceName := sanitizePathSegment(strings.TrimSpace(name))
	if marketplaceName == "" || marketplaceName == "unknown" {
		return ChangeResult{}, fmt.Errorf("missing marketplace name")
	}

	pluginsDir, err := resolvePluginsDirectory()
	if err != nil {
		return ChangeResult{}, err
	}
	knownPath := filepath.Join(pluginsDir, "known_marketplaces.json")
	knownDoc, err := loadKnownMarketplaceFile(knownPath)
	if err != nil {
		return ChangeResult{}, err
	}

	entry, knownExists := knownDoc[marketplaceName]
	installPath := strings.TrimSpace(entry.InstallLocation)
	if knownExists {
		delete(knownDoc, marketplaceName)
		if err := saveKnownMarketplaceFile(knownPath, knownDoc); err != nil {
			return ChangeResult{}, err
		}
	}

	settingsChanged := false
	for _, scope := range []string{"user", "project", "local"} {
		settingsPath, pathErr := resolveSettingsPath(scope)
		if pathErr != nil {
			continue
		}
		doc, loadErr := loadJSONDocument(settingsPath)
		if loadErr != nil {
			return ChangeResult{}, loadErr
		}
		extra := readObjectField(doc, "extraKnownMarketplaces")
		if _, exists := extra[marketplaceName]; !exists {
			continue
		}
		delete(extra, marketplaceName)
		if len(extra) == 0 {
			delete(doc, "extraKnownMarketplaces")
		} else {
			doc["extraKnownMarketplaces"] = extra
		}
		if err := writeJSONDocument(settingsPath, doc); err != nil {
			return ChangeResult{}, err
		}
		settingsChanged = true
	}

	if !knownExists && !settingsChanged {
		return ChangeResult{}, fmt.Errorf("marketplace %q is not configured", marketplaceName)
	}
	if installPath != "" {
		if err := os.RemoveAll(installPath); err != nil {
			return ChangeResult{}, fmt.Errorf("remove marketplace install path: %w", err)
		}
	}

	return ChangeResult{
		Status:      "removed",
		PluginID:    marketplaceName,
		SourcePath:  knownPath,
		InstallPath: installPath,
	}, nil
}

func (r ListResult) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("source=%s\n", r.SourcePath))
	b.WriteString(fmt.Sprintf("schema_version=%d\n", r.SchemaVersion))
	b.WriteString(fmt.Sprintf("plugin_count=%d\n", len(r.Installations)))
	if len(r.Installations) == 0 {
		b.WriteString("plugins=none\n")
		return b.String()
	}

	for _, item := range r.Installations {
		b.WriteString(fmt.Sprintf("- id=%s scope=%s version=%s install_path=%s\n",
			item.ID,
			valueOrUnknown(item.Scope),
			valueOrUnknown(item.Version),
			valueOrUnknown(item.InstallPath),
		))
		if item.ProjectPath != "" {
			b.WriteString(fmt.Sprintf("  project_path=%s\n", item.ProjectPath))
		}
		if item.InstalledAt != "" {
			b.WriteString(fmt.Sprintf("  installed_at=%s\n", item.InstalledAt))
		}
		if item.LastUpdated != "" {
			b.WriteString(fmt.Sprintf("  last_updated=%s\n", item.LastUpdated))
		}
	}
	return b.String()
}

func (r ChangeResult) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("status=%s\n", r.Status))
	b.WriteString(fmt.Sprintf("plugin_id=%s\n", r.PluginID))
	b.WriteString(fmt.Sprintf("scope=%s\n", r.Scope))
	b.WriteString(fmt.Sprintf("version=%s\n", r.Version))
	b.WriteString(fmt.Sprintf("source=%s\n", r.SourcePath))
	b.WriteString(fmt.Sprintf("install_path=%s\n", r.InstallPath))
	if r.ProjectPath != "" {
		b.WriteString(fmt.Sprintf("project_path=%s\n", r.ProjectPath))
	}
	return b.String()
}

func (r MarketplaceListResult) String() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("source=%s\n", r.SourcePath))
	b.WriteString(fmt.Sprintf("marketplace_count=%d\n", len(r.Marketplaces)))
	if len(r.Marketplaces) == 0 {
		b.WriteString("marketplaces=none\n")
		return b.String()
	}
	for _, item := range r.Marketplaces {
		b.WriteString(fmt.Sprintf("- name=%s source=%s install_path=%s\n",
			item.Name,
			valueOrUnknown(item.SourceType),
			valueOrUnknown(item.InstallPath),
		))
		if item.Repo != "" {
			b.WriteString(fmt.Sprintf("  repo=%s\n", item.Repo))
		}
		if item.URL != "" {
			b.WriteString(fmt.Sprintf("  url=%s\n", item.URL))
		}
		if item.Path != "" {
			b.WriteString(fmt.Sprintf("  path=%s\n", item.Path))
		}
		if item.LastUpdated != "" {
			b.WriteString(fmt.Sprintf("  last_updated=%s\n", item.LastUpdated))
		}
	}
	return b.String()
}

func loadInstalledPluginsFile(path string) (installedPluginsFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return installedPluginsFile{Version: 2, Plugins: map[string][]installationRecord{}}, nil
		}
		return installedPluginsFile{}, err
	}

	var payload installedPluginsFile
	if err := json.Unmarshal(data, &payload); err != nil {
		return installedPluginsFile{}, fmt.Errorf("decode installed plugins file: %w", err)
	}
	if payload.Version == 0 {
		payload.Version = 2
	}
	if payload.Plugins == nil {
		payload.Plugins = map[string][]installationRecord{}
	}
	return payload, nil
}

func saveInstalledPluginsFile(path string, payload installedPluginsFile) error {
	if payload.Version == 0 {
		payload.Version = 2
	}
	if payload.Plugins == nil {
		payload.Plugins = map[string][]installationRecord{}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create installed plugins dir: %w", err)
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("encode installed plugins file: %w", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		return fmt.Errorf("write installed plugins file: %w", err)
	}
	return nil
}

func writeInstallMetadataFile(installPath, pluginID string, record installationRecord) error {
	payload := map[string]string{
		"plugin_id":    pluginID,
		"scope":        record.Scope,
		"install_path": record.InstallPath,
		"version":      record.Version,
		"installed_at": record.InstalledAt,
		"last_updated": record.LastUpdated,
	}
	if record.ProjectPath != "" {
		payload["project_path"] = record.ProjectPath
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("encode install metadata: %w", err)
	}
	encoded = append(encoded, '\n')
	metaPath := filepath.Join(installPath, ".claude-code-go-plugin-install.json")
	if err := os.WriteFile(metaPath, encoded, 0o644); err != nil {
		return fmt.Errorf("write install metadata: %w", err)
	}
	return nil
}

func resolveInstalledPluginsPath() (string, error) {
	pluginsDir, err := resolvePluginsDirectory()
	if err != nil {
		return "", err
	}
	return filepath.Join(pluginsDir, "installed_plugins.json"), nil
}

func resolvePluginsDirectory() (string, error) {
	if override := strings.TrimSpace(os.Getenv("CLAUDE_CODE_PLUGIN_CACHE_DIR")); override != "" {
		return expandHome(override)
	}

	claudeConfigDir := strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR"))
	if claudeConfigDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		claudeConfigDir = filepath.Join(home, ".claude")
	} else {
		var err error
		claudeConfigDir, err = expandHome(claudeConfigDir)
		if err != nil {
			return "", err
		}
	}

	dirName := "plugins"
	if isTruthy(os.Getenv("CLAUDE_CODE_USE_COWORK_PLUGINS")) {
		dirName = "cowork_plugins"
	}
	return filepath.Join(claudeConfigDir, dirName), nil
}

func normalizeScope(raw string) (string, error) {
	scope := strings.TrimSpace(raw)
	if scope == "" {
		scope = "user"
	}
	if !validScopePattern.MatchString(scope) {
		return "", fmt.Errorf("invalid scope %q. expected one of: user, project, local", raw)
	}
	return scope, nil
}

func resolveProjectPathForScope(scope string) (string, error) {
	if scope != "project" && scope != "local" {
		return "", nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve project path: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(cwd)
	if err == nil {
		return resolved, nil
	}
	if os.IsNotExist(err) {
		return cwd, nil
	}
	return cwd, nil
}

func summarizeInstalledScopes(entries []installationRecord) string {
	parts := make([]string, 0, len(entries))
	for _, entry := range sortInstallationRecords(entries) {
		scope := entry.Scope
		if entry.ProjectPath != "" {
			scope = fmt.Sprintf("%s(%s)", scope, entry.ProjectPath)
		}
		parts = append(parts, scope)
	}
	return strings.Join(parts, ",")
}

func resolveSettingsPath(scope string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	switch scope {
	case "user":
		return filepath.Join(home, ".claude", "settings.json"), nil
	case "project":
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("resolve settings path: %w", err)
		}
		return filepath.Join(cwd, ".claude", "settings.json"), nil
	case "local":
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("resolve settings path: %w", err)
		}
		return filepath.Join(cwd, ".claude", "settings.local.json"), nil
	default:
		return "", fmt.Errorf("invalid scope %q", scope)
	}
}

func parseMarketplaceSource(raw string) (string, map[string]any, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil, fmt.Errorf("missing marketplace source")
	}

	if looksLikeSSHGit(trimmed) {
		name := deriveMarketplaceNameFromURL(trimmed)
		return name, map[string]any{"source": "git", "url": trimmed}, nil
	}

	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		if isGitLikeURL(trimmed) {
			name := deriveMarketplaceNameFromURL(trimmed)
			return name, map[string]any{"source": "git", "url": trimmed}, nil
		}
		name := deriveMarketplaceNameFromURL(trimmed)
		return name, map[string]any{"source": "url", "url": trimmed}, nil
	}

	if looksLikeGitHubShorthand(trimmed) {
		repo, ref := splitRepoRef(trimmed)
		name := sanitizePathSegment(pathBase(repo))
		payload := map[string]any{"source": "github", "repo": repo}
		if ref != "" {
			payload["ref"] = ref
		}
		return name, payload, nil
	}

	if looksLikePath(trimmed) {
		resolved, err := expandHome(trimmed)
		if err != nil {
			return "", nil, err
		}
		abs, err := filepath.Abs(resolved)
		if err != nil {
			return "", nil, err
		}
		info, err := os.Stat(abs)
		if err != nil {
			return "", nil, fmt.Errorf("inspect marketplace path: %w", err)
		}
		if info.IsDir() {
			return sanitizePathSegment(filepath.Base(abs)), map[string]any{"source": "directory", "path": abs}, nil
		}
		return sanitizePathSegment(strings.TrimSuffix(filepath.Base(abs), filepath.Ext(abs))), map[string]any{"source": "file", "path": abs}, nil
	}

	return "", nil, fmt.Errorf("unsupported marketplace source %q", raw)
}

func looksLikeSSHGit(raw string) bool {
	return strings.Contains(raw, "@") && strings.Contains(raw, ":") && !strings.HasPrefix(raw, "./") && !strings.HasPrefix(raw, "../")
}

func isGitLikeURL(raw string) bool {
	return strings.HasSuffix(raw, ".git") || strings.Contains(raw, "/_git/") || strings.Contains(raw, "github.com/")
}

func looksLikeGitHubShorthand(raw string) bool {
	if strings.HasPrefix(raw, "./") || strings.HasPrefix(raw, "../") || strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "~") {
		return false
	}
	if strings.Contains(raw, ":") {
		return false
	}
	parts := strings.Split(strings.TrimSuffix(strings.TrimSuffix(raw, ".git"), "/"), "/")
	return len(parts) == 2 && parts[0] != "" && parts[1] != ""
}

func splitRepoRef(raw string) (string, string) {
	for _, sep := range []string{"#", "@"} {
		if before, after, ok := strings.Cut(raw, sep); ok && strings.Contains(before, "/") {
			return before, after
		}
	}
	return raw, ""
}

func pathBase(raw string) string {
	trimmed := strings.TrimSuffix(strings.TrimSuffix(raw, ".git"), "/")
	parts := strings.Split(trimmed, "/")
	return parts[len(parts)-1]
}

func deriveMarketplaceNameFromURL(raw string) string {
	trimmed := strings.TrimSuffix(strings.TrimSuffix(raw, ".git"), "/")
	if idx := strings.LastIndex(trimmed, "/"); idx >= 0 && idx+1 < len(trimmed) {
		return sanitizePathSegment(trimmed[idx+1:])
	}
	if idx := strings.LastIndex(trimmed, ":"); idx >= 0 && idx+1 < len(trimmed) {
		return sanitizePathSegment(trimmed[idx+1:])
	}
	return sanitizePathSegment(trimmed)
}

func looksLikePath(raw string) bool {
	return strings.HasPrefix(raw, "./") || strings.HasPrefix(raw, "../") || strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "~")
}

func loadJSONDocument(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("read json document: %w", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("decode json document: %w", err)
	}
	if doc == nil {
		doc = map[string]any{}
	}
	return doc, nil
}

func writeJSONDocument(path string, doc map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create json document dir: %w", err)
	}
	encoded, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("encode json document: %w", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		return fmt.Errorf("write json document: %w", err)
	}
	return nil
}

func readObjectField(doc map[string]any, key string) map[string]any {
	if existing, ok := doc[key].(map[string]any); ok && existing != nil {
		copyMap := map[string]any{}
		for k, v := range existing {
			copyMap[k] = v
		}
		return copyMap
	}
	return map[string]any{}
}

func loadKnownMarketplaceFile(path string) (knownMarketplaceFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return knownMarketplaceFile{}, nil
		}
		return nil, fmt.Errorf("read known marketplaces: %w", err)
	}
	var doc knownMarketplaceFile
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("decode known marketplaces: %w", err)
	}
	if doc == nil {
		doc = knownMarketplaceFile{}
	}
	return doc, nil
}

func saveKnownMarketplaceFile(path string, doc knownMarketplaceFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create known marketplaces dir: %w", err)
	}
	encoded, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("encode known marketplaces: %w", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		return fmt.Errorf("write known marketplaces: %w", err)
	}
	return nil
}

func sourceTypeOf(payload map[string]any) string {
	if kind, ok := payload["source"].(string); ok {
		return kind
	}
	return ""
}

func buildInstallPath(pluginsDir, pluginID, version string) string {
	name := pluginID
	marketplace := "manual"
	if parsedName, parsedMarketplace, ok := strings.Cut(pluginID, "@"); ok {
		name = parsedName
		marketplace = parsedMarketplace
	}
	return filepath.Join(pluginsDir, "cache", sanitizePathSegment(marketplace), sanitizePathSegment(name), sanitizePathSegment(version))
}

func sanitizePathSegment(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "unknown"
	}
	var b strings.Builder
	for _, r := range trimmed {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return b.String()
}

func sortInstallationRecords(entries []installationRecord) []installationRecord {
	sorted := append([]installationRecord(nil), entries...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Scope != sorted[j].Scope {
			return sorted[i].Scope < sorted[j].Scope
		}
		if sorted[i].ProjectPath != sorted[j].ProjectPath {
			return sorted[i].ProjectPath < sorted[j].ProjectPath
		}
		if sorted[i].Version != sorted[j].Version {
			return sorted[i].Version < sorted[j].Version
		}
		return sorted[i].InstallPath < sorted[j].InstallPath
	})
	return sorted
}

func findInstallationIndex(entries []installationRecord, scope, projectPath string) int {
	for i, entry := range entries {
		if entry.Scope == scope && entry.ProjectPath == projectPath {
			return i
		}
	}
	return -1
}

func expandHome(path string) (string, error) {
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		if path == "~" {
			return home, nil
		}
		return filepath.Join(home, strings.TrimPrefix(path, "~/")), nil
	}
	return path, nil
}

func isTruthy(raw string) bool {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	switch normalized {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func valueOrUnknown(v string) string {
	if strings.TrimSpace(v) == "" {
		return "unknown"
	}
	return v
}
