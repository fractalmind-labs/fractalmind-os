# Agent Status Skill - Quick Start Examples

## Daily Workflow Examples

### 1. Morning Standup - Check Team Attendance

```bash
# View all agents like an employee calendar
python3 .agent/skills/agent-calendar/scripts/main.py calendar
```

**Sample Output:**
```
╔════════════════════════════════════════════════════════════╗
║  Agent Availability Calendar - 2026-01-05 09:00           ║
╠════════════════════════════════════════════════════════════╣
║ EMP    │ Agent Name              │ Status  │ Info         ║
╠────────┼─────────────────────────┼─────────┼──────────────╢
║ 0004   │ destiny-dev             │ ✅ Work │ -            ║
║ 0005   │ destiny-qa              │ ⏸️ Idle │ 5m idle      ║
║ 0006   │ destiny-dev-lead        │ ⚠️ 429  │ ~3h until    ║
║ 0007   │ director                │ ⚠️ 429  │ ~3h until    ║
║ 0008   │ polymarket-quant-lead   │ ⏸️ Idle │ 2h idle      ║
║ 0009   │ polymarket-data-eng     │ ✅ Work │ -            ║
║ 0010   │ polymarket-quant-dev    │ ✅ Work │ -            ║
║ 0011   │ polymarket-algo-dev     │ ✅ Work │ -            ║
║ 0012   │ polymarket-risk-mgr     │ ✅ Work │ -            ║
║ 0013   │ polymarket-quant-qa     │ ✅ Work │ -            ║
╚─────────────────────────────────────────────────────────────╝

Summary: 6 Working | 2 Idle | 2 Quota Exhausted
Recommendation: Assign tasks to EMP_0005, EMP_0008
```

**Interpretation:**
- 🟢 6 agents working
- 🟡 2 agents idle and ready for tasks
- 🔴 2 agents on "vacation" (quota exhausted)
- 💡 Lead should assign to idle agents first

---

### 2. Pre-Task Assignment - Find Best Candidate

```bash
# Get AI-powered recommendations
python3 .agent/skills/agent-calendar/scripts/main.py suggest --task-type development
```

**Sample Output:**
```
💡 Task Assignment Recommendations
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task Type: Development

Top Recommendations:
🥇 EMP_0005 (destiny-qa)
   • Status: ⏸️ Idle - 5m idle
   • Skills: review-pr, move-contract-development
   ✅ Ready to start immediately

🥈 EMP_0008 (polymarket-quant-lead)
   • Status: ⏸️ Idle - 2h idle
   • Skills: team-manager, agent-manager, golang-quant-dev
   ⚠️ Available but was idle longer (might need context)

❌ Avoid:
  • EMP_0006, EMP_0007 - Quota exhausted (~3h)

💡 Assignment Command:
   python3 .agent/skills/agent-manager/scripts/main.py assign EMP_0005 <<EOF
   Implement feature X...
   EOF
```

---

### 3. Team Capacity Planning

```bash
# Check if team can take more work
python3 .agent/skills/agent-calendar/scripts/main.py team polymarket-quant
```

**Sample Output:**
```
📦 polymarket-quant Team Availability
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏸️ Idle but Available: 1
   • EMP_0008 (quant-lead) - Idle for 2h

🔄 Currently Working: 5
   • EMP_0009 (data-engineer) - Active
   • EMP_0010 (quant-dev) - Active
   • EMP_0011 (algo-dev) - Active
   • EMP_0012 (risk-manager) - Active
   • EMP_0013 (quant-qa) - Active

💡 Team Capacity: 6 total | 1 available | 5 working
💡 Can accept 1-2 new tasks (lead available)
💡 Priority: EMP_0008 (lead) first, then distribute to team
```

**Decision:**
- Team has capacity for 1-2 new tasks
- Lead agent available - good for coordination tasks
- Don't overload working agents

---

### 4. Quota Monitoring - Avoid Failed Assignments

```bash
# Check specific agent before assigning
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0007
```

**Sample Output:**
```
📊 Agent: EMP_0007 (director)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current Status: ⚠️ Quota Exhausted

Quota Details:
  • Error: API Error 429 - Usage limit reached
  • Reset Time: 2026-01-05 12:00:00
  • Wait Time: ~3h

Recommendations:
  ⏳ Wait for quota reset before assigning tasks
  🔄 Consider restarting agent after reset
```

**Decision:** Don't assign to EMP_0007, pick another agent.

---

### 5. Filter Views - Quick Status Checks

```bash
# Show only available agents
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state idle

# Show only quota-exhausted agents
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state quota-exhausted

# Show only working agents
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state working
```

---

## Common Use Cases

### 🌅 Daily Standup Routine

```bash
# 1. Check overall attendance
python3 .agent/skills/agent-calendar/scripts/main.py calendar

# 2. Check quota issues
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state quota-exhausted

# 3. Check team capacity
python3 .agent/skills/agent-calendar/scripts/main.py team polymarket-quant
python3 .agent/skills/agent-calendar/scripts/main.py team destiny
```

### 📋 Before Assigning Tasks

```bash
# 1. Get recommendations
python3 .agent/skills/agent-calendar/scripts/main.py suggest --task-type development

# 2. Verify top candidate
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0005

# 3. Assign task
python3 .agent/skills/agent-manager/scripts/main.py assign EMP_0005 <<EOF
Your task here...
EOF
```

### ⚠️ Incident Response

```bash
# 1. Check who's down
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state error

# 2. Check quota issues
python3 .agent/skills/agent-calendar/scripts/main.py calendar --state quota-exhausted

# 3. Get details on problematic agents
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0007
```

---

## Integration with Other Skills

### With agent-manager

```bash
# Check status first
python3 .agent/skills/agent-calendar/scripts/main.py show EMP_0005

# Then assign if available
python3 .agent/skills/agent-manager/scripts/main.py assign EMP_0005 <<EOF
Task details...
EOF

# Send follow-up message
python3 .agent/skills/agent-manager/scripts/main.py send EMP_0005 "Please add error handling"
```

### With team-manager

```bash
# Check team capacity
python3 .agent/skills/agent-calendar/scripts/main.py team polymarket-quant

# Assign to team if capacity available
python3 .agent/skills/team-manager/scripts/main.py assign polymarket-quant <<EOF
Team task...
EOF
```

---

## Status Icons Reference

| Icon | State | Meaning | Can Assign? |
|------|-------|---------|-------------|
| ✅ | Working | Actively processing | ⚠️ With caution |
| ⏸️ | Idle | Waiting for commands | ✅ Yes, priority |
| ⚠️ | Quota Exhausted | API limit hit | ❌ No, wait for reset |
| ❌ | Error | Error state | ❌ No, needs attention |
| ⭕ | Stopped | Not running | ❌ No, start first |

---

## Pro Tips

1. **Always check before assigning**: Run `suggest` or `show` to avoid wasting quota
2. **Monitor quota regularly**: Check `--state quota-exhausted` daily
3. **Use team views**: Understand group capacity before assigning team tasks
4. **Track idle times**: Long idle times might mean agent needs restart
5. **Morning routine**: Start with `calendar` for full picture

---

## Future Features

These commands are planned but not yet implemented:

```bash
# Watch status changes in real-time
python3 .agent/skills/agent-calendar/scripts/main.py watch --follow

# View historical data
python3 .agent/skills/agent-calendar/scripts/main.py history EMP_0007 --days 7

# Generate weekly report
python3 .agent/skills/agent-calendar/scripts/main.py report --week
```
