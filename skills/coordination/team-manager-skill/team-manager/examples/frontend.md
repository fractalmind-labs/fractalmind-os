---
name: frontend
description: Frontend Development Team
lead_agent: EMP_0001
members:
  - employee_id: EMP_0001
    role: lead developer
  - employee_id: EMP_0002
    role: ui developer
  - employee_id: EMP_0003
    role: qa tester
---

# Frontend Team

## Description
Responsible for frontend web application development, UI/UX implementation, and quality assurance.

## Workflow

```mermaid
graph TD
    Start[Lead receives task] --> Analysis[Analyze requirements]
    Analysis --> Design[Create design/spec]
    Design --> Assign[Assign to UI Developer]
    Assign --> Implement[UI Developer implements]
    Implement --> Review[Lead code review]
    Review --> Fixes{Issues found?}
    Fixes -->|Yes| Implement
    Fixes -->|No| QA[Assign to QA]
    QA --> Test[QA tests implementation]
    Test --> Bugs{Bugs found?}
    Bugs -->|Yes| Implement
    Bugs -->|No| Complete[Lead reports completion]
```

## Coordination Process

1. **Lead Agent** (EMP_0001) receives task and analyzes requirements
2. Lead creates design/specification if needed
3. Lead assigns work to UI Developer (EMP_0002)
4. UI Developer implements the feature
5. Lead performs code review
6. QA (EMP_0003) tests the implementation
7. If bugs are found, return to UI Developer for fixes
8. Once approved, Lead reports completion

## Team Members

- **EMP_0001** (dev): lead developer 👑
- **EMP_0002** (ui-dev): ui developer
- **EMP_0003** (qa): qa tester

## Usage

Assign task to this team:
```bash
python3 .agent/skills/team-manager/scripts/main.py assign frontend <<EOF
Implement user login form with validation
EOF
```

Monitor team progress:
```bash
python3 .agent/skills/team-manager/scripts/main.py monitor frontend --follow
```
