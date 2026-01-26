# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| Latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

### How to Report

Please send an email to **yubing744@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce the issue
- Any potential impact or exploit scenario
- If applicable, a proposed fix or mitigation

### What to Expect

- We will acknowledge receipt of your report within 48 hours
- We will provide a detailed response within 7 days indicating the next steps
- You will receive credit for your discovery (unless you prefer to remain anonymous)

### Guidelines

- Please do not disclose security vulnerabilities publicly until they have been fixed
- Give us reasonable time to investigate and address the issue
- We appreciate your help in keeping this project secure!

## Security Best Practices

When using Team Manager Skill, consider the following:

### Team Security

- **Member Access**: Control who can modify team configurations
- **Lead Assignment**: Ensure team leads are trusted and verified
- **Task Distribution**: Be aware of what tasks are being assigned to teams
- **Output Monitoring**: Regularly monitor team output for unexpected behavior

### Agent Permissions

- **File Access**: Agents can read/write files within their workspace
- **Command Execution**: Agents can execute system commands with user permissions
- **Team Coordination**: Team leads can coordinate other agents' actions
- **Review all team configurations** before deployment

### Data Protection

- **Sensitive Data**: Never commit secrets, API keys, or passwords
- **Workspace**: Keep workspace contents private if they contain sensitive information
- **Team Data**: Be careful when sharing team configurations that might contain sensitive information

## Dependency Security

This project depends on:

- `python3` (standard library only)
- `agent-manager-skill` (minimal dependencies)

We recommend:
- Keeping your Python installation updated
- Keeping agent-manager-skill updated
- Regularly checking for security updates in your operating system

## Private Information

Never commit the following to the repository:

- API keys or tokens
- Passwords or credentials
- Personal information
- Private keys or certificates
- Team member credentials or access tokens
- Agent credentials or access tokens

Use environment variables or secure configuration files for sensitive data.
