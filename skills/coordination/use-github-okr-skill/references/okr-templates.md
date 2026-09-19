# OKR Templates

Use these templates when creating or updating GitHub OKR artifacts.

## Objective Issue

```md
## Objective
<Outcome-focused Objective statement.>

## Alignment
Level: Company / Team / Product
Parent Objective: <URL or none>
Parent KR: <URL or none>
Team: <team or owner group>
Alignment rationale: <why this Objective belongs under the parent KR>

## Key Results
- [ ] KR1: <metric target> - <KR issue URL>
- [ ] KR2: <metric target> - <KR issue URL>
- [ ] KR3: <metric target> - <KR issue URL>

## Operating cadence
- Weekly KR owner updates every <weekday>.
- PRs close task or initiative issues, not KR issues directly.
- KR issues close only when the metric reaches target and evidence is linked.

## Project fields
Objective: <O1>
OKR Type: Objective
Company Objective: <company-level Objective name>
Parent KR: <parent KR URL or id>
Team: <team>
Alignment: Direct / Supporting / Dependency
Health: <Green|Yellow|Red>
Confidence: <0.00-1.00>
Due: <YYYY-MM-DD>
```

## Key Result Issue

```md
## Key Result
Objective: <O1 - Objective title>
Owner: <GitHub handle or TBD>
Due date: <YYYY-MM-DD>

## Alignment
Parent Objective: <Objective issue URL>
Parent KR: <parent KR issue URL, if this is a child/team KR>
Contribution type: Direct / Supporting / Dependency
Team: <team>
Alignment rationale: <how this KR moves or unblocks the parent KR metric>

## Metric
Baseline: <starting value>
Target: <target value>
Current: <current value>
Confidence: <0.00-1.00>
Health: <Green|Yellow|Red>

## Measurement
<How the metric is calculated and where evidence comes from.>

## Linked work
- [ ] <Initiative or task issue>
- [ ] <Initiative or task issue>

## Children
- [ ] <Team KR, Initiative, or Task issue URL>

## Weekly update
- Date: <YYYY-MM-DD>
- Progress: <what changed>
- Risk: <risk or none>
- Next: <next action>
```

## Initiative Or Task Issue

```md
## Work
<Concrete deliverable.>

## Alignment
Parent Objective: <Objective issue URL>
Parent KR: <KR issue URL>
Contribution type: Direct / Supporting / Dependency
Team: <team>

## Parent KR
<KR issue URL>

## Acceptance
- [ ] <Verifiable outcome>
- [ ] <Evidence or test requirement>

## Notes
<Implementation or operational notes.>
```

## Alignment Audit Comment

```md
## OKR alignment audit - <YYYY-MM-DD>

Hierarchy:
- Parent Objective: <URL or missing>
- Parent KR: <URL or missing>
- Child items: <count and links>

Contribution:
- Type: Direct / Supporting / Dependency / Missing
- Rationale: <clear, weak, or missing>
- Parent metric affected: <yes/no and why>

Hygiene:
- Owner: <present/missing>
- Target: <present/missing>
- Current: <present/missing>
- Evidence source: <present/missing>
- Weekly update cadence: <current/stale>

Finding:
- <Aligned / Needs clarification / Misaligned>

Next:
- <specific repair action>
```

## Weekly KR Comment

```md
## Weekly OKR update - <YYYY-MM-DD>

Current: <current value>
Target: <target value>
Health: <Green|Yellow|Red>
Confidence: <0.00-1.00>

Progress:
- <what changed>

Risks:
- <risk or none>

Next:
- <next action>

Evidence:
- <link to dashboard, PR, issue, deploy, screenshot, or test result>
```
