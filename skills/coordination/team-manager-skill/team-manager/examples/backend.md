---
name: backend
description: Backend API Development Team
lead_agent: EMP_0004
members:
  - employee_id: EMP_0004
    role: api lead
  - employee_id: EMP_0005
    role: database admin
  - employee_id: EMP_0006
    role: qa engineer
---

# Backend Team

## Description
Responsible for backend API development, database management, and API testing.

## Workflow

```mermaid
sequenceDiagram
    participant User
    participant Lead as EMP_0004 (API Lead)
    participant DBA as EMP_0005 (DB Admin)
    participant QA as EMP_0006 (QA Engineer)

    User->>Lead: Task assigned
    Lead->>Lead: Analyze requirements

    alt Database changes needed
        Lead->>DBA: Design schema changes
        DBA->>Lead: Schema approved
        DBA->>DBA: Implement migrations
    end

    Lead->>Lead: Implement API endpoints
    Lead->>QA: Request API testing
    QA->>QA: Test endpoints

    alt Issues found
        QA->>Lead: Report bugs
        Lead->>Lead: Fix bugs
        Lead->>QA: Re-test
    end

    QA->>Lead: Tests passed
    Lead->>User: Task completed
```

## Coordination Process

1. **Lead Agent** (EMP_0004) receives task and analyzes requirements
2. If database changes are needed, Lead works with DB Admin (EMP_0005) on schema
3. DB Admin implements database migrations
4. Lead implements API endpoints
5. QA Engineer (EMP_0006) tests the API endpoints
6. If issues are found, Lead fixes and re-submits for testing
7. Once all tests pass, Lead reports completion

## Team Members

- **EMP_0004** (backend-lead): api lead 👑
- **EMP_0005** (db-admin): database admin
- **EMP_0006** (qa): qa engineer

## Usage

Assign task to this team:
```bash
python3 .agent/skills/team-manager/scripts/main.py assign backend <<EOF
Implement user profile API endpoint
EOF
```

Monitor team progress:
```bash
python3 .agent/skills/team-manager/scripts/main.py monitor backend --follow
```
