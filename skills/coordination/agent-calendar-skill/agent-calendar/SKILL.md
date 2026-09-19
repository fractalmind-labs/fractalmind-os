---
name: agent-calendar
description: Agent availability calendar system - like Google Calendar for your AI agents. Use when checking agent availability, monitoring API quotas, tracking idle times, or making task assignment decisions. Shows when agents are free, busy (working), or unavailable (quota exhausted/'on vacation'). Essential for team leads to optimize task scheduling.
license: MIT
allowed-tools: [Read, Write, Edit, Bash]
---

# Agent Calendar

Agent availability calendar system for managing multi-agent teams. Think of it as **Google Calendar for your AI agents** - it shows which agents are available (free slots), busy (in meetings/working), or unavailable (out of office/quota exhausted). Essential for team leads to optimize task scheduling and resource allocation.

## Quick Start

```bash
# View all agents in calendar format (like employee attendance)
python3 .agent/skills/agent-calendar/scripts/main.py calendar

# Check team availability
python3 .agent/skills/agent-calendar/scripts/main.py team polymarket-quant

# Get detailed status of a specific agent
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0007

# Get task assignment suggestions
python3 .agent/skills/agent-calendar/scripts/main.py suggest --task-type development

# Watch status changes in real-time
python3 .agent/skills/agent-calendar/scripts/main.py watch --follow
```

## Core Concepts

### Agent States

| State | Icon | Meaning | Can Assign Task? |
|-------|------|---------|------------------|
| **Working** | ✅ | Agent actively processing | ⚠️ Use caution |
| **Idle** | ⏸️ | Waiting for commands | ✅ Yes |
| **Quota Exhausted** | ⚠️ | API limit hit (on 'vacation') | ❌ No - wait for reset |
| **Error** | ❌ | Error state | ❌ No - needs attention |
| **Stopped** | ⭕ | Not running | ❌ No - start first |

### Quota Detection

Automatically detects API quota exhaustion:
- **API Error 429**: Rate limit hit
- **Reset Time**: Extracted from error messages
- **Wait Time**: Calculated countdown to reset

Example detection:
```
API Error: 429 {"error":{"code":"1308","message":"Usage limit reached for 5 hour.
Your limit will reset at 2026-01-05 07:12:05"}}
```

→ Status: ⚠️ Quota Exhausted
→ Reset: 2026-01-05 07:12:05 (5 hours left)

### Idle Time Tracking

Detects agent idle time from Claude's prompt timer:
```
[⏱ 1h 9m] ? for help
```

→ Status: ⏸️ Idle for 1h 9m

## Commands

### `calendar` - Employee Attendance View

Display all agents in a calendar-like format showing availability.

```bash
python3 .agent/skills/agent-calendar/scripts/main.py calendar
```

Output:
```
╔════════════════════════════════════════════════════════════════╗
║  Agent Availability Calendar - 2026-01-05 14:30               ║
╠════════════════════════════════════════════════════════════════╣
║ EMP    │ Agent Name              │ Status  │ Info            ║
╠────────┼─────────────────────────┼─────────┼─────────────────╢
║ 0004   │ destiny-dev             │ ✅ Work │ -               ║
║ 0005   │ destiny-qa              │ ⏸️ Idle │ 3m 37s          ║
║ 0006   │ destiny-dev-lead        │ ⚠️ 429  │ ~5h until reset ║
║ 0007   │ director                │ ⚠️ 429  │ ~5h until reset ║
║ 0008   │ polymarket-quant-lead   │ ⏸️ Idle │ 1h 9m           ║
║ 0009   │ polymarket-data-eng     │ ✅ Work │ -               ║
║ 0010   │ polymarket-quant-dev    │ ✅ Work │ -               ║
║ 0011   │ polymarket-algo-dev     │ ✅ Work │ -               ║
║ 0012   │ polymarket-risk-mgr     │ ✅ Work │ -               ║
║ 0013   │ polymarket-quant-qa     │ ✅ Work │ -               ║
╚───────────────────────────────────────────────────────────────╝

Summary: 6 Working | 3 Idle | 2 Quota Exhausted | 2 Stopped
Recommendation: Assign tasks to EMP_0005, EMP_0008, or polymarket team
```

**Options:**
```bash
# Show only running agents
python3 .agent/skills/agent-calendar/scripts/main.py calendar --running

# Filter by state
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state idle
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state quota-exhausted
```

### `team` - Team Availability Report

Show availability status for a specific team.

```bash
python3 .agent/skills/agent-calendar/scripts/main.py team polymarket-quant
```

Output:
```
📦 Polymarket Quant Team Availability
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Available for Tasks: 2
   • EMP_0013 (quant-qa) - Idle (can assign immediately)
   • EMP_0009 (data-engineer) - Working (low load)

⏸️ Idle but Available: 1
   • EMP_0008 (quant-lead) - Idle for 1h 9m

🔄 Currently Working: 3
   • EMP_0010 (quant-dev) - Active task
   • EMP_0011 (algo-dev) - Active task
   • EMP_0012 (risk-manager) - Active task

💡 Team Capacity: Can accept 2-3 new tasks
💡 Priority Assignment: EMP_0008 (lead) first, then EMP_0013
```

### `show` - Detailed Agent Calendar

Get comprehensive status report for a single agent.

```bash
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0007
```

Output:
```
📊 Agent: EMP_0007 (director)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current Status: ⚠️ Quota Exhausted

Provider Configuration:
  • Launcher: ccc (claude-code-switch)
  • Model: GLM
  • Working Dir: /home/yubing/.../work-assistant

Quota Details:
  • Error: API Error 429 - Usage limit reached
  • Limit Type: 5 hour rolling window
  • Reset Time: 2026-01-05 07:12:05
  • Wait Time: ~5 hours
  • Retry Count: 4 attempts

Recent Activity:
  • 02:10:53 - Attempted to process command
  • 02:08:27 - Hit rate limit (429 error)
  • 02:06:15 - Last successful request
  • 01:55:30 - Task assignment received

Session Info:
  • Tmux Session: agent-emp-0007
  • Session Age: 4h 23m
  • Attached: Yes

Recommendations:
  ⏳ Wait until 07:12 for quota reset
  🔄 Consider restarting agent after reset
  📊 Monitor usage patterns to prevent future limits
```

### `suggest` - Task Assignment Recommendations

Get AI-powered recommendations for task assignment.

```bash
python3 .agent/skills/agent-calendar/scripts/main.py suggest --task-type development
```

Output:
```
💡 Task Assignment Recommendations
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task Type: Development

Top Recommendations:
1. 🥇 EMP_0005 (destiny-qa)
   • Status: ⏸️ Idle (3m 37s)
   • Skills: review-pr, move-contract-development
   • Team: Destiny
   • Fit: Excellent - ready to start immediately

2. 🥈 EMP_0008 (polymarket-quant-lead)
   • Status: ⏸️ Idle (1h 9m)
   • Skills: team-manager, agent-manager, golang-quant-dev
   • Team: Polymarket Quant
   • Fit: Good - available for coordination tasks

3. 🥉 EMP_0013 (polymarket-quant-qa)
   • Status: ✅ Low load
   • Skills: golang-quant-dev, polymarket-backtest, review-pr
   • Team: Polymarket Quant
   • Fit: Good - can take on review work

❌ Avoid (Unavailable):
  • EMP_0006 (destiny-dev-lead) - Quota exhausted until ~07:12
  • EMP_0007 (director) - Quota exhausted until ~07:12

💡 Assignment Command:
  python3 .agent/skills/agent-manager/scripts/main.py assign EMP_0005 <<EOF
  Your task here...
  EOF
```

**Task Types:**
- `development` - Code implementation
- `review` - Code review and QA
- `coordination` - Team management
- `analysis` - Data analysis and research
- `testing` - Test execution

### `watch` - Real-time Status Monitoring

Monitor agent status changes in real-time.

```bash
python3 .agent/skills/agent-calendar/scripts/main.py watch --follow
```

Output (live updates):
```
📡 Watching agent status (Ctrl+C to stop)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[14:30:05] EMP_0005: ⏸️ Idle → ✅ Working (Task assigned)
[14:31:22] EMP_0008: ⏸️ Idle still idle (1h 10m)
[14:32:45] EMP_0007: ⚠️ 429 reset in 4h 39m
[14:35:10] EMP_0006: ⚠️ 429 reset in 4h 36m
...
```

**Options:**
```bash
# Watch specific agents
python3 .agent/skills/agent-calendar/scripts/main.py watch EMP_0007 EMP_0008 --follow

# Set refresh interval (default 30s)
python3 .agent/skills/agent-calendar/scripts/main.py watch --interval 60
```

### `history` - Agent Calendar History

View historical status data for an agent.

```bash
python3 .agent/skills/agent-calendar/scripts/main.py history EMP_0007 --days 7
```

Output:
```
📜 Status History: EMP_0007 (Last 7 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2026-01-05:
  • 02:08 - ⚠️ Quota exhausted (reset at 07:12)
  • 00:15 - ✅ Working
  • 00:00 - ✅ Started

2026-01-04:
  • 19:12 - ⚠️ Quota exhausted (reset at 00:15)
  • 15:30 - ✅ Working
  • ...

Summary:
  • Total uptime: 42h 15m
  • Quota incidents: 3 times
  • Average daily usage: 6h 02m
  • Most active: 09:00-15:00
```

## Architecture

### Detection Logic

**Status Detection:**
```python
1. Check if tmux session exists → Stopped if no
2. Capture tmux pane output (last 100 lines)
3. Detect state from output patterns:
   • '429' + 'Usage limit' → Quota Exhausted
   • '[⏱' + '>' in last line → Idle
   • 'Build' / 'Thinking' → Working
   • Else → Running
```

**Quota Parsing:**
```python
# Extract reset time from error message
pattern = r'Your limit will reset at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})'
reset_time = parse_datetime(match)

# Calculate wait time
wait_seconds = (reset_time - now).total_seconds()
```

**Idle Time Parsing:**
```python
# Extract idle time from prompt timer
pattern = r'\[⏱\s+(\d+)h\s+(\d+)m\]'
hours, minutes = parse_idle_time(match)
idle_duration = hours * 3600 + minutes * 60
```

### Data Storage

Status history stored in `~/.agent/state/agent-calendar/`:

```
~/.agent/state/agent-calendar/
├── history/
│   ├── EMP_0007_20260105.json  # Daily snapshots
│   ├── EMP_0006_20260105.json
│   └── ...
└── stats/
    ├── EMP_0007_stats.json     # Aggregated stats
    └── EMP_0006_stats.json
```

**Snapshot Format:**
```json
{
  "agent_id": "EMP_0007",
  "date": "2026-01-05",
  "snapshots": [
    {
      "timestamp": "2026-01-05T02:10:53Z",
      "status": "quota-exhausted",
      "reset_time": "2026-01-05T07:12:05Z",
      "error": "429"
    }
  ],
  "summary": {
    "uptime_seconds": 15843,
    "quota_incidents": 3,
    "idle_periods": 5
  }
}
```

## Integration with Other Skills

### With agent-manager
```bash
# Check availability before assigning
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0005
python3 .agent/skills/agent-manager/scripts/main.py assign EMP_0005 <<EOF
...
EOF
```

### With team-manager
```bash
# Check team capacity before assigning
python3 .agent/skills/agent-calendar/scripts/main.py team polymarket-quant
python3 .agent/skills/team-manager/scripts/main.py assign polymarket-quant <<EOF
...
EOF
```

## Use Cases

### 1. Morning Standup
```bash
# Check daily attendance
python3 .agent/skills/agent-calendar/scripts/main.py calendar

# Output informs daily planning:
# - Who's available today?
# - Who's on 'vacation' (quota reset)?
# - Where should I assign tasks?
```

### 2. Pre-Task Assignment
```bash
# Find best candidate for urgent task
python3 .agent/skills/agent-calendar/scripts/main.py suggest --task-type review

# Get detailed view before assigning
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0005
```

### 3. Capacity Planning
```bash
# Check team bandwidth
python3 .agent/skills/agent-calendar/scripts/main.py team polymarket-quant

# Output shows:
# - Can team take 2 more tasks?
# - Who's overloaded?
# - Who's underutilized?
```

### 4. Incident Response
```bash
# Monitor quota issues in real-time
python3 .agent/skills/agent-calendar/scripts/main.py watch --follow

# Alert when quota resets
# Restart agents automatically
```

## Best Practices

1. **Check Before Assign**: Always run `suggest` or `show` before task assignment
2. **Monitor Quota**: Use `watch` during high-usage periods to catch 429s early
3. **Historical Analysis**: Review `history` weekly to identify usage patterns
4. **Team Awareness**: Use `team` command to understand group capacity
5. **Morning Routine**: Start day with `calendar` for full picture

## Future Enhancements

- [ ] Email/slack alerts when quota resets
- [ ] Automatic agent restart after quota reset
- [ ] Usage trend predictions
- [ ] Cost estimation by provider/model
- [ ] Integration with team scheduling
- [ ] Web dashboard for visual monitoring

## Error Handling

- **Agent not found**: Lists available agents
- **Team not found**: Lists available teams
- **No tmux sessions**: Shows all agents as stopped
- **Malformed quota error**: Shows quota-exhausted but no reset time
- **Permission denied**: Shows error and suggests checking tmux permissions
