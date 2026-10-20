package configv2

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// fieldError is a decoding error that already carries its line.
type fieldError struct {
	line int
	msg  string
}

func (e *fieldError) Error() string { return fmt.Sprintf("line %d: %s", e.line, e.msg) }

// v1Hints maps version 1 field names to their version 2 replacement. They
// explain both a missing `version: 2` and an unknown field.
var v1Hints = map[string]string{
	"router":             "agents.router was removed: bind each channel to agents with agents.<name>.channels",
	"ohMyCode":           "agents.ohMyCode was removed: give each agent its workspace and runtime: agentManager; tune it under runtimes.agentManager",
	"codexAppCDP":        "agents.codexAppCDP was removed: use runtime: codexApp with session: <Codex thread ID>",
	"claudeDesktop":      "agents.claudeDesktop moved: use runtime: claudeDesktop on the agent; inboxes derive from dataDir",
	"heartbeat":          "agents.heartbeat was replaced by schedules.jobs.<id> with agent",
	"targets":            "receiver targets were replaced by agents.<name>.channels",
	"receivers":          "receiver targets were replaced by agents.<name>.channels",
	"receiverIds":        "receiver targets were replaced by agents.<name>.channels",
	"enabled":            "enabled was removed: a configured channel or runtime is enabled",
	"bots":               "channels.feishu.bots.<name> is now channels.feishu.<name>",
	"dedupeFile":         "dedupeFile was removed: deduplication state derives from dataDir",
	"pollingOffsetFile":  "pollingOffsetFile was removed: the offset derives from dataDir",
	"cursorFile":         "cursorFile was removed: the cursor derives from dataDir",
	"statePath":          "statePath was removed: schedule state derives from dataDir",
	"inboxPath":          "inboxPath was removed: each agent's inbox derives from dataDir",
	"fallbackToInbox":    "fallbackToInbox was removed: runtimes declare how they deliver",
	"defaultAgent":       "defaultAgent was removed: an agent's runtime receiver is its session",
	"allowedAgents":      "allowedAgents was removed: a channel reaches the agents bound to it",
	"text":               "text is now prompt (or promptFile)",
	"agentCronProfiles":  "agentCronProfiles is now backoff",
	"resetCronOnInbound": "resetCronOnInbound is now resetOnInbound",
	"dispatchMode":       "dispatchMode is now mode",
	"agentManagerScript": "agentManagerScript is now runtimes.agentManager.script",
	"identityKeyFile":    "identityKeyFile is now identityKey: secret:<name>",
	"rpcUrl":             "rpcUrl was removed: use graphqlUrl",
}

var unknownFieldPattern = regexp.MustCompile(`^line (\d+): field (\S+) not found in type \S+$`)

// Load reads and validates a version 2 configuration file.
func Load(path string, p Platform) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg, err := Parse(data, p)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	cfg.Path = path
	return cfg, nil
}

// Parse decodes and validates a version 2 configuration.
func Parse(data []byte, p Platform) (*Config, error) {
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	if err := requireVersion2(&root); err != nil {
		return nil, err
	}
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	var cfg Config
	if err := dec.Decode(&cfg); err != nil && !errors.Is(err, io.EOF) {
		return nil, explainDecodeError(err)
	}
	if err := cfg.normalize(p); err != nil {
		return nil, err
	}
	if err := cfg.validate(p); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// requireVersion2 rejects version 1 files with the rewrites they need.
func requireVersion2(root *yaml.Node) error {
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 || root.Content[0].Kind != yaml.MappingNode {
		return errors.New("the configuration must be a YAML mapping")
	}
	top := root.Content[0]
	for i := 0; i+1 < len(top.Content); i += 2 {
		if top.Content[i].Value == "version" {
			if top.Content[i+1].Value == "2" {
				return nil
			}
			return fmt.Errorf("line %d: unsupported version %q; this FractalBot reads version: 2", top.Content[i+1].Line, top.Content[i+1].Value)
		}
	}
	found := map[string]bool{}
	collectV1Keys(top, found)
	msg := "this is a version 1 configuration (it has no version: 2). FractalBot V2 does not load version 1; rewrite it as described in docs/config-v2.md"
	if len(found) > 0 {
		keys := make([]string, 0, len(found))
		for k := range found {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var b strings.Builder
		b.WriteString(msg)
		b.WriteString(":")
		written := map[string]bool{}
		for _, k := range keys {
			if hint := v1Hints[k]; !written[hint] {
				written[hint] = true
				b.WriteString("\n  - ")
				b.WriteString(hint)
			}
		}
		msg = b.String()
	}
	return errors.New(msg)
}

func collectV1Keys(node *yaml.Node, found map[string]bool) {
	if node.Kind == yaml.SequenceNode {
		for _, item := range node.Content {
			collectV1Keys(item, found)
		}
		return
	}
	if node.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if _, ok := v1Hints[node.Content[i].Value]; ok {
			found[node.Content[i].Value] = true
		}
		collectV1Keys(node.Content[i+1], found)
	}
}

// explainDecodeError turns yaml's unknown-field errors into a short message
// with the version 2 replacement when one exists.
func explainDecodeError(err error) error {
	var te *yaml.TypeError
	if !errors.As(err, &te) {
		return err
	}
	lines := make([]string, 0, len(te.Errors))
	for _, e := range te.Errors {
		if m := unknownFieldPattern.FindStringSubmatch(e); m != nil {
			line := fmt.Sprintf("line %s: unknown field %q", m[1], m[2])
			if hint, ok := v1Hints[m[2]]; ok {
				line += " (" + hint + ")"
			}
			lines = append(lines, line)
			continue
		}
		lines = append(lines, e)
	}
	return errors.New(strings.Join(lines, "\n"))
}
