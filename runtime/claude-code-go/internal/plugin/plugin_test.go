package plugin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallCreatesUserScopedEntryAndMetadata(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)

	result, err := Install(InstallOptions{Plugin: "demo@market", Scope: "user", Version: "1.2.3"})
	if err != nil {
		t.Fatalf("Install returned error: %v", err)
	}
	if result.Status != "installed" {
		t.Fatalf("unexpected install status: %#v", result)
	}
	if got := result.InstallPath; got != filepath.Join(home, ".claude", "plugins", "cache", "market", "demo", "1.2.3") {
		t.Fatalf("unexpected install path: %s", got)
	}
	if _, err := os.Stat(filepath.Join(result.InstallPath, ".claude-code-go-plugin-install.json")); err != nil {
		t.Fatalf("expected metadata file: %v", err)
	}

	payload := readInstalledPluginsFile(t, filepath.Join(home, ".claude", "plugins", "installed_plugins.json"))
	entries := payload.Plugins["demo@market"]
	if len(entries) != 1 {
		t.Fatalf("expected 1 install entry, got %#v", entries)
	}
	if entries[0].Scope != "user" || entries[0].Version != "1.2.3" {
		t.Fatalf("unexpected entry: %#v", entries[0])
	}
}

func TestInstallProjectUpdatesSameScopeAndPreservesOtherScopes(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "repo", "app")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	projectCanonical, err := filepath.EvalSymlinks(project)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	mustWriteFile(t, filepath.Join(home, ".claude", "plugins", "installed_plugins.json"), fmt.Sprintf(`{
  "version": 2,
  "plugins": {
    "demo@market": [
      {
        "scope": "user",
        "installPath": "/plugins/demo/1.0.0",
        "version": "1.0.0",
        "installedAt": "2026-04-06T11:00:00Z",
        "lastUpdated": "2026-04-06T11:00:00Z"
      },
      {
        "scope": "project",
        "projectPath": %q,
        "installPath": "/plugins/demo/1.1.0",
        "version": "1.1.0",
        "installedAt": "2026-04-06T11:05:00Z",
        "lastUpdated": "2026-04-06T11:05:00Z"
      }
    ]
  }
}`, projectCanonical))

	withWorkingDir(t, project, func() {
		result, err := Install(InstallOptions{Plugin: "demo@market", Scope: "project", Version: "2.0.0"})
		if err != nil {
			t.Fatalf("Install returned error: %v", err)
		}
		if result.Status != "updated" {
			t.Fatalf("expected updated status, got %#v", result)
		}
		if result.ProjectPath != projectCanonical {
			t.Fatalf("unexpected project path: %s", result.ProjectPath)
		}
	})

	payload := readInstalledPluginsFile(t, filepath.Join(home, ".claude", "plugins", "installed_plugins.json"))
	entries := payload.Plugins["demo@market"]
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %#v", entries)
	}
	var userSeen, projectSeen bool
	for _, entry := range entries {
		switch entry.Scope {
		case "user":
			userSeen = entry.Version == "1.0.0"
		case "project":
			projectSeen = entry.Version == "2.0.0" && entry.ProjectPath == projectCanonical
		}
	}
	if !userSeen || !projectSeen {
		t.Fatalf("unexpected entries after update: %#v", entries)
	}
}

func TestUninstallRemovesScopedEntryAndInstallPath(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)

	installed, err := Install(InstallOptions{Plugin: "demo@market", Scope: "user", Version: "1.2.3"})
	if err != nil {
		t.Fatalf("Install returned error: %v", err)
	}
	if _, err := os.Stat(installed.InstallPath); err != nil {
		t.Fatalf("expected install path before uninstall: %v", err)
	}

	removed, err := Uninstall(UninstallOptions{Plugin: "demo@market", Scope: "user"})
	if err != nil {
		t.Fatalf("Uninstall returned error: %v", err)
	}
	if removed.Status != "removed" {
		t.Fatalf("unexpected uninstall status: %#v", removed)
	}
	if _, err := os.Stat(installed.InstallPath); !os.IsNotExist(err) {
		t.Fatalf("expected install path removed, got err=%v", err)
	}
	payload := readInstalledPluginsFile(t, filepath.Join(home, ".claude", "plugins", "installed_plugins.json"))
	if len(payload.Plugins) != 0 {
		t.Fatalf("expected no plugins after uninstall, got %#v", payload.Plugins)
	}
}

func TestUninstallRejectsWrongScope(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "repo", "app")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	withWorkingDir(t, project, func() {
		if _, err := Install(InstallOptions{Plugin: "demo@market", Scope: "project", Version: "2.0.0"}); err != nil {
			t.Fatalf("Install returned error: %v", err)
		}
	})

	_, err := Uninstall(UninstallOptions{Plugin: "demo@market", Scope: "user"})
	if err == nil || !strings.Contains(err.Error(), "available=project(") {
		t.Fatalf("expected helpful scope error, got %v", err)
	}
}

func TestListReadsInstalledPluginsFromDefaultPath(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)
	mustWriteFile(t, filepath.Join(home, ".claude", "plugins", "installed_plugins.json"), `{
  "version": 2,
  "plugins": {
    "formatter@anthropic-tools": [
      {
        "scope": "user",
        "installPath": "/plugins/formatter/1.0.0",
        "version": "1.0.0",
        "installedAt": "2026-04-06T11:30:00Z"
      },
      {
        "scope": "project",
        "projectPath": "/repo/app",
        "installPath": "/plugins/formatter/1.1.0",
        "version": "1.1.0",
        "lastUpdated": "2026-04-06T11:45:00Z"
      }
    ],
    "lint@anthropic-tools": [
      {
        "scope": "local",
        "projectPath": "/repo/app",
        "installPath": "/plugins/lint/0.3.0",
        "version": "0.3.0"
      }
    ]
  }
}`)

	result, err := List()
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if got := result.SourcePath; got != filepath.Join(home, ".claude", "plugins", "installed_plugins.json") {
		t.Fatalf("unexpected source path: %s", got)
	}
	if got := len(result.Installations); got != 3 {
		t.Fatalf("expected 3 installations, got %d", got)
	}
	output := result.String()
	for _, needle := range []string{
		"plugin_count=3",
		"- id=formatter@anthropic-tools scope=project version=1.1.0 install_path=/plugins/formatter/1.1.0",
		"  project_path=/repo/app",
		"  last_updated=2026-04-06T11:45:00Z",
		"- id=lint@anthropic-tools scope=local version=0.3.0 install_path=/plugins/lint/0.3.0",
	} {
		if !strings.Contains(output, needle) {
			t.Fatalf("expected output to contain %q, got:\n%s", needle, output)
		}
	}
}

func TestListSupportsEnvOverridesAndEmptyState(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(home, ".claude-custom"))
	t.Setenv("CLAUDE_CODE_USE_COWORK_PLUGINS", "true")

	result, err := List()
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if got := result.SourcePath; got != filepath.Join(home, ".claude-custom", "cowork_plugins", "installed_plugins.json") {
		t.Fatalf("unexpected source path: %s", got)
	}
	if !strings.Contains(result.String(), "plugins=none") {
		t.Fatalf("expected empty output, got:\n%s", result.String())
	}
}

func TestListSupportsExplicitPluginCacheDir(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	cache := filepath.Join(home, "cache", "plugins")
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CODE_PLUGIN_CACHE_DIR", "~/cache/plugins")
	mustWriteFile(t, filepath.Join(cache, "installed_plugins.json"), `{"version":2,"plugins":{"demo@market":[{"scope":"user","installPath":"/cache/demo","version":"9.9.9"}]}}`)

	result, err := List()
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if got := result.SourcePath; got != filepath.Join(cache, "installed_plugins.json") {
		t.Fatalf("unexpected source path: %s", got)
	}
	if !strings.Contains(result.String(), "demo@market") {
		t.Fatalf("expected explicit cache plugin in output, got:\n%s", result.String())
	}
}

func TestAddMarketplaceUserWritesSettingsAndKnownMarketplaces(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)

	result, err := AddMarketplace(MarketplaceAddOptions{Source: "demo-owner/demo-market", Scope: "user"})
	if err != nil {
		t.Fatalf("AddMarketplace returned error: %v", err)
	}
	if result.Status != "added" {
		t.Fatalf("unexpected add status: %#v", result)
	}
	if result.PluginID != "demo-market" || result.Scope != "user" || result.Version != "github" {
		t.Fatalf("unexpected result payload: %#v", result)
	}

	settingsPath := filepath.Join(home, ".claude", "settings.json")
	settings := readJSONMap(t, settingsPath)
	extra := readNestedMap(t, settings, "extraKnownMarketplaces")
	entry := readNestedMap(t, extra, "demo-market")
	source := readNestedMap(t, entry, "source")
	if got := source["source"]; got != "github" {
		t.Fatalf("unexpected source type: %#v", source)
	}
	if got := source["repo"]; got != "demo-owner/demo-market" {
		t.Fatalf("unexpected repo field: %#v", source)
	}

	expectedInstallPath := filepath.Join(home, ".claude", "plugins", "marketplaces", "demo-market")
	if got := entry["installLocation"]; got != expectedInstallPath {
		t.Fatalf("unexpected installLocation in settings: %v", got)
	}
	if _, err := os.Stat(expectedInstallPath); err != nil {
		t.Fatalf("expected marketplace install directory: %v", err)
	}

	knownPath := filepath.Join(home, ".claude", "plugins", "known_marketplaces.json")
	known := readJSONMap(t, knownPath)
	knownEntry := readNestedMap(t, known, "demo-market")
	if got := knownEntry["installLocation"]; got != expectedInstallPath {
		t.Fatalf("unexpected known installLocation: %v", got)
	}
	knownSource := readNestedMap(t, knownEntry, "source")
	if got := knownSource["repo"]; got != "demo-owner/demo-market" {
		t.Fatalf("unexpected known source: %#v", knownSource)
	}
}

func TestAddMarketplaceWritesProjectAndLocalSettingsPaths(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "repo", "app")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	withWorkingDir(t, project, func() {
		if _, err := AddMarketplace(MarketplaceAddOptions{Source: "team/project-market", Scope: "project"}); err != nil {
			t.Fatalf("project AddMarketplace returned error: %v", err)
		}
		if _, err := AddMarketplace(MarketplaceAddOptions{Source: "team/local-market", Scope: "local"}); err != nil {
			t.Fatalf("local AddMarketplace returned error: %v", err)
		}
	})

	projectSettings := readJSONMap(t, filepath.Join(project, ".claude", "settings.json"))
	projectExtra := readNestedMap(t, projectSettings, "extraKnownMarketplaces")
	if _, ok := projectExtra["project-market"]; !ok {
		t.Fatalf("expected project-market in project settings, got %#v", projectExtra)
	}

	localSettings := readJSONMap(t, filepath.Join(project, ".claude", "settings.local.json"))
	localExtra := readNestedMap(t, localSettings, "extraKnownMarketplaces")
	if _, ok := localExtra["local-market"]; !ok {
		t.Fatalf("expected local-market in local settings, got %#v", localExtra)
	}
}

func TestAddMarketplaceUpdatesExistingMarketplaceWithoutDuplicate(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)

	settingsPath := filepath.Join(home, ".claude", "settings.json")
	knownPath := filepath.Join(home, ".claude", "plugins", "known_marketplaces.json")
	mustWriteFile(t, settingsPath, `{
  "extraKnownMarketplaces": {
    "demo-market": {
      "source": {
        "source": "github",
        "repo": "demo-owner/old-market"
      },
      "installLocation": "/tmp/old-market"
    }
  }
}`)
	mustWriteFile(t, knownPath, `{
  "demo-market": {
    "source": {
      "source": "github",
      "repo": "demo-owner/old-market"
    },
    "installLocation": "/tmp/old-market",
    "lastUpdated": "2026-04-06T00:00:00Z"
  }
}`)

	result, err := AddMarketplace(MarketplaceAddOptions{Source: "demo-owner/demo-market", Scope: "user"})
	if err != nil {
		t.Fatalf("AddMarketplace returned error: %v", err)
	}
	if result.Status != "updated" {
		t.Fatalf("expected updated status, got %#v", result)
	}

	settings := readJSONMap(t, settingsPath)
	extra := readNestedMap(t, settings, "extraKnownMarketplaces")
	if len(extra) != 1 {
		t.Fatalf("expected single marketplace entry, got %#v", extra)
	}
	entry := readNestedMap(t, extra, "demo-market")
	source := readNestedMap(t, entry, "source")
	if got := source["repo"]; got != "demo-owner/demo-market" {
		t.Fatalf("expected updated repo, got %#v", source)
	}

	known := readJSONMap(t, knownPath)
	if len(known) != 1 {
		t.Fatalf("expected single known marketplace entry, got %#v", known)
	}
}

func TestListMarketplacesReadsKnownMarketplacesFromDefaultPath(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)
	mustWriteFile(t, filepath.Join(home, ".claude", "plugins", "known_marketplaces.json"), `{
  "demo-market": {
    "source": {
      "source": "github",
      "repo": "demo-owner/demo-market"
    },
    "installLocation": "/plugins/demo-market",
    "lastUpdated": "2026-04-06T04:41:23Z"
  },
  "file-market": {
    "source": {
      "source": "file",
      "path": "/tmp/marketplace.json"
    },
    "installLocation": "/plugins/file-market",
    "lastUpdated": "2026-04-06T04:42:00Z"
  }
}`)

	result, err := ListMarketplaces()
	if err != nil {
		t.Fatalf("ListMarketplaces returned error: %v", err)
	}
	if got := result.SourcePath; got != filepath.Join(home, ".claude", "plugins", "known_marketplaces.json") {
		t.Fatalf("unexpected source path: %s", got)
	}
	if got := len(result.Marketplaces); got != 2 {
		t.Fatalf("expected 2 marketplaces, got %d", got)
	}
	output := result.String()
	for _, needle := range []string{
		"marketplace_count=2",
		"- name=demo-market source=github install_path=/plugins/demo-market",
		"  repo=demo-owner/demo-market",
		"- name=file-market source=file install_path=/plugins/file-market",
		"  path=/tmp/marketplace.json",
	} {
		if !strings.Contains(output, needle) {
			t.Fatalf("expected output to contain %q, got:\n%s", needle, output)
		}
	}
}

func TestListMarketplacesSupportsEnvOverridesAndEmptyState(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(home, ".claude-custom"))
	t.Setenv("CLAUDE_CODE_USE_COWORK_PLUGINS", "true")

	result, err := ListMarketplaces()
	if err != nil {
		t.Fatalf("ListMarketplaces returned error: %v", err)
	}
	if got := result.SourcePath; got != filepath.Join(home, ".claude-custom", "cowork_plugins", "known_marketplaces.json") {
		t.Fatalf("unexpected source path: %s", got)
	}
	if !strings.Contains(result.String(), "marketplaces=none") {
		t.Fatalf("expected empty output, got:\n%s", result.String())
	}
}

func TestRemoveMarketplaceRemovesKnownFileSettingsAndInstallPath(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	project := filepath.Join(tmp, "repo", "app")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	installPath := filepath.Join(home, ".claude", "plugins", "marketplaces", "demo-market")
	mustWriteFile(t, filepath.Join(installPath, "marketplace.json"), `{}`)
	mustWriteFile(t, filepath.Join(home, ".claude", "plugins", "known_marketplaces.json"), `{
  "demo-market": {
    "source": {"source":"github","repo":"demo-owner/demo-market"},
    "installLocation": "`+installPath+`",
    "lastUpdated": "2026-04-06T04:41:23Z"
  }
}`)
	mustWriteFile(t, filepath.Join(home, ".claude", "settings.json"), `{
  "extraKnownMarketplaces": {
    "demo-market": {
      "source": {"source":"github","repo":"demo-owner/demo-market"},
      "installLocation": "`+installPath+`"
    }
  },
  "theme": "dark"
}`)
	mustWriteFile(t, filepath.Join(project, ".claude", "settings.local.json"), `{
  "extraKnownMarketplaces": {
    "demo-market": {
      "source": {"source":"github","repo":"demo-owner/demo-market"},
      "installLocation": "`+installPath+`"
    }
  },
  "model": "claude-test"
}`)

	withWorkingDir(t, project, func() {
		result, err := RemoveMarketplace("demo-market")
		if err != nil {
			t.Fatalf("RemoveMarketplace returned error: %v", err)
		}
		if result.Status != "removed" || result.PluginID != "demo-market" {
			t.Fatalf("unexpected remove result: %#v", result)
		}
	})

	known := readJSONMap(t, filepath.Join(home, ".claude", "plugins", "known_marketplaces.json"))
	if len(known) != 0 {
		t.Fatalf("expected known marketplaces empty, got %#v", known)
	}
	userSettings := readJSONMap(t, filepath.Join(home, ".claude", "settings.json"))
	if _, ok := userSettings["extraKnownMarketplaces"]; ok {
		t.Fatalf("expected user extraKnownMarketplaces removed, got %#v", userSettings)
	}
	if userSettings["theme"] != "dark" {
		t.Fatalf("expected user settings preserved, got %#v", userSettings)
	}
	localSettings := readJSONMap(t, filepath.Join(project, ".claude", "settings.local.json"))
	if _, ok := localSettings["extraKnownMarketplaces"]; ok {
		t.Fatalf("expected local extraKnownMarketplaces removed, got %#v", localSettings)
	}
	if localSettings["model"] != "claude-test" {
		t.Fatalf("expected local settings preserved, got %#v", localSettings)
	}
	if _, err := os.Stat(installPath); !os.IsNotExist(err) {
		t.Fatalf("expected install path removed, err=%v", err)
	}
}

func TestRemoveMarketplaceRejectsMissingMarketplace(t *testing.T) {
	tmp := t.TempDir()
	home := filepath.Join(tmp, "home")
	t.Setenv("HOME", home)

	_, err := RemoveMarketplace("missing-market")
	if err == nil || !strings.Contains(err.Error(), "is not configured") {
		t.Fatalf("expected helpful missing marketplace error, got %v", err)
	}
}

func readInstalledPluginsFile(t *testing.T, path string) installedPluginsFile {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var payload installedPluginsFile
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func readJSONMap(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func readNestedMap(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := parent[key]
	if !ok {
		t.Fatalf("missing key %q in %#v", key, parent)
	}
	nested, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected map for key %q, got %#v", key, value)
	}
	return nested
}

func withWorkingDir(t *testing.T, path string, fn func()) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWD) }()
	if err := os.Chdir(path); err != nil {
		t.Fatal(err)
	}
	fn()
}

func mustWriteFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
