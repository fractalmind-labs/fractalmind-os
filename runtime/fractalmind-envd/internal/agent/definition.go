package agent

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Definition is what an agent-manager Home says about its main Agent: the
// root AGENTS.md frontmatter plus counts read from the Home. It is a public
// observation for the App's import view, never identity or authority.
type Definition struct {
	Home        string  `json:"home"`
	Name        string  `json:"name"`
	Namespace   string  `json:"namespace,omitempty"`
	Description string  `json:"description,omitempty"`
	Launcher    string  `json:"launcher,omitempty"`
	Profile     string  `json:"profile,omitempty"`
	Model       string  `json:"model,omitempty"`
	Heartbeat   string  `json:"heartbeat,omitempty"` // cron, empty when disabled or absent
	Schedules   int     `json:"schedules"`
	ROM         *ROMRef `json:"rom,omitempty"`
	Skills      int     `json:"skills"`
	SubAgents   int     `json:"sub_agents"`
}
type ROMRef struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

const maxAgentsFile = 64 << 10

var (
	namespacePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)
	modelLine        = regexp.MustCompile(`(?m)^model\s*=\s*"([^"\n]{1,128})"\s*$`)
)

type frontmatter struct {
	Name         string   `yaml:"name"`
	Namespace    string   `yaml:"namespace"`
	Description  string   `yaml:"description"`
	Launcher     string   `yaml:"launcher"`
	LauncherArgs []string `yaml:"launcher_args"`
	Heartbeat    *struct {
		Cron    string `yaml:"cron"`
		Enabled *bool  `yaml:"enabled"`
	} `yaml:"heartbeat"`
	Schedules []yaml.Node `yaml:"schedules"`
	ROM       *ROMRef     `yaml:"rom"`
}

func readFrontmatter(path string) (*frontmatter, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxAgentsFile))
	if err != nil {
		return nil, err
	}
	if !bytes.HasPrefix(data, []byte("---\n")) {
		return nil, fmt.Errorf("no frontmatter")
	}
	end := bytes.Index(data[4:], []byte("\n---"))
	if end < 0 {
		return nil, fmt.Errorf("unterminated frontmatter")
	}
	var fm frontmatter
	if err := yaml.Unmarshal(data[4:4+end], &fm); err != nil {
		return nil, err
	}
	if fm.Name == "" {
		return nil, fmt.Errorf("frontmatter has no name")
	}
	return &fm, nil
}

// launchProfile returns the launcher profile and an explicit model argument.
func launchProfile(args []string) (profile, model string) {
	for i, a := range args {
		switch {
		case (a == "--profile" || a == "-p") && i+1 < len(args):
			profile = args[i+1]
		case strings.HasPrefix(a, "--profile="):
			profile = strings.TrimPrefix(a, "--profile=")
		case (a == "--model" || a == "-m") && i+1 < len(args):
			model = args[i+1]
		case strings.HasPrefix(a, "--model="):
			model = strings.TrimPrefix(a, "--model=")
		}
	}
	return profile, model
}

// codexModel reads only the top-level `model = "…"` of the Codex profile
// (`$CODEX_HOME/<profile>.config.toml`, else config.toml). Nothing else in
// the file, such as providers or credentials, is read into the result.
func codexModel(profile string) string {
	home := os.Getenv("CODEX_HOME")
	if home == "" {
		user, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		home = filepath.Join(user, ".codex")
	}
	name := "config.toml"
	if profile != "" && namespacePattern.MatchString(profile) {
		name = profile + ".config.toml"
	}
	f, err := os.Open(filepath.Join(home, name))
	if err != nil {
		return ""
	}
	defer f.Close()
	// The model key precedes any [table]; stop at the first table header.
	var head bytes.Buffer
	scanner := bufio.NewScanner(io.LimitReader(f, 64<<10))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(strings.TrimSpace(line), "[") {
			break
		}
		head.WriteString(line + "\n")
	}
	if m := modelLine.FindSubmatch(head.Bytes()); m != nil {
		return string(m[1])
	}
	return ""
}

func countDirs(dirs ...string) int {
	best := 0
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		n := 0
		for _, e := range entries {
			if e.IsDir() || e.Type()&os.ModeSymlink != 0 {
				n++
			}
		}
		if n > best {
			best = n
		}
	}
	return best
}

func countSubAgents(home string) int {
	entries, err := os.ReadDir(filepath.Join(home, "agents"))
	if err != nil {
		return 0
	}
	n := 0
	for _, e := range entries {
		name := e.Name()
		switch {
		case e.IsDir():
			if _, err := os.Stat(filepath.Join(home, "agents", name, "AGENTS.md")); err == nil {
				n++
			}
		case strings.HasSuffix(name, ".md") && name != "main.md":
			n++
		}
		if n >= 1000 {
			break
		}
	}
	return n
}

// ReadDefinition looks for the Home's AGENTS.md at dir or up to two parents
// (an Agent may have changed into a subfolder). It returns nil when no
// agent-manager definition exists.
func ReadDefinition(dir string) *Definition {
	for i, d := 0, dir; i < 3; i, d = i+1, filepath.Dir(d) {
		fm, err := readFrontmatter(filepath.Join(d, "AGENTS.md"))
		if err != nil {
			if d == filepath.Dir(d) {
				return nil
			}
			continue
		}
		def := &Definition{Home: d, Name: fm.Name, Description: oneLine(fm.Description, 200), Launcher: fm.Launcher, Schedules: len(fm.Schedules), ROM: fm.ROM}
		if namespacePattern.MatchString(fm.Namespace) {
			def.Namespace = fm.Namespace
		}
		profile, model := launchProfile(fm.LauncherArgs)
		def.Profile = profile
		if model == "" && strings.Contains(filepath.Base(fm.Launcher), "codex") {
			model = codexModel(profile)
		}
		def.Model = model
		if fm.Heartbeat != nil && (fm.Heartbeat.Enabled == nil || *fm.Heartbeat.Enabled) {
			def.Heartbeat = fm.Heartbeat.Cron
		}
		def.Skills = countDirs(filepath.Join(d, ".agents", "skills"), filepath.Join(d, ".agent", "skills"), filepath.Join(d, ".claude", "skills"))
		def.SubAgents = countSubAgents(d)
		if !def.valid() {
			return nil
		}
		return def
	}
	return nil
}

func (d *Definition) valid() bool {
	if d == nil {
		return true
	}
	ok := filepath.IsAbs(d.Home) && safeText(d.Home, 4096) && safeText(d.Name, 128) && d.Name != "" &&
		safeText(d.Namespace, 64) && safeText(d.Description, 512) && safeText(d.Launcher, 512) &&
		safeText(d.Profile, 64) && safeText(d.Model, 128) && safeText(d.Heartbeat, 128) &&
		d.Schedules >= 0 && d.Schedules <= 1000 && d.Skills >= 0 && d.Skills <= 10000 && d.SubAgents >= 0 && d.SubAgents <= 1000
	if d.ROM != nil {
		ok = ok && safeText(d.ROM.Name, 128) && d.ROM.Name != "" && safeText(d.ROM.Version, 64)
	}
	return ok
}

// oneLine keeps a description displayable: control characters become spaces
// and it is cut to limit runes.
func oneLine(s string, limit int) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if len(out) >= limit {
			break
		}
		if r < 32 || r == 127 {
			r = ' '
		}
		out = append(out, r)
	}
	return strings.TrimSpace(string(out))
}
