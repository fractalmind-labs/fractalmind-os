"""
Tmux session helper for agent-manager skill.

Wraps tmux commands for managing agent sessions.
Sessions are named: agent-{agent_id} where agent_id is file_id in lowercase (e.g., emp-0001)
"""

import subprocess
import time
import re
from typing import Optional, List, Dict


# Session prefix for all agent sessions
SESSION_PREFIX = "agent-"


def check_tmux() -> bool:
    """
    Check if tmux is available.

    Returns:
        True if tmux is installed and accessible
    """
    result = subprocess.run(['which', 'tmux'], capture_output=True)
    return result.returncode == 0


def list_sessions() -> List[str]:
    """
    List all agent-* tmux sessions.

    Returns:
        List of agent_id values (e.g., ['emp-0001', 'emp-0002'])
    """
    result = subprocess.run(['tmux', 'ls'], capture_output=True, text=True)

    if result.returncode != 0:
        return []

    sessions = []
    for line in result.stdout.split('\n'):
        if ':' in line:
            session_name = line.split(':')[0]
            if session_name.startswith(SESSION_PREFIX):
                # Extract agent_id from session name
                agent_id = session_name[len(SESSION_PREFIX):]
                sessions.append(agent_id)

    return sessions


def session_exists(agent_id: str) -> bool:
    """
    Check if an agent session exists.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001', without agent- prefix)

    Returns:
        True if session exists
    """
    return agent_id in list_sessions()


def start_session(agent_id: str, command: str) -> bool:
    """
    Start a new tmux session for an agent.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001', will be prefixed with agent-)
        command: Command to run in the session

    Returns:
        True if session was started successfully
    """
    session_name = f"{SESSION_PREFIX}{agent_id}"

    if session_exists(agent_id):
        return False

    # Start tmux session in detached mode
    result = subprocess.run([
        'tmux', 'new-session', '-d', '-s', session_name, command
    ], capture_output=True, text=True)

    return result.returncode == 0


def stop_session(agent_id: str) -> bool:
    """
    Stop (kill) a tmux session.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001', without agent- prefix)

    Returns:
        True if session was stopped
    """
    session_name = f"{SESSION_PREFIX}{agent_id}"

    result = subprocess.run([
        'tmux', 'kill-session', '-t', session_name
    ], capture_output=True, text=True)

    return result.returncode == 0


def capture_output(agent_id: str, lines: int = 100) -> Optional[str]:
    """
    Capture recent output from a tmux session.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001', without agent- prefix)
        lines: Number of lines to capture (from the end)

    Returns:
        Captured output, or None if session doesn't exist
    """
    if not session_exists(agent_id):
        return None

    session_name = f"{SESSION_PREFIX}{agent_id}"

    result = subprocess.run([
        'tmux', 'capture-pane', '-p', '-t', session_name, f'-S-{lines}'
    ], capture_output=True, text=True)

    if result.returncode != 0:
        return None

    return result.stdout


def send_keys(agent_id: str, keys: str, *, send_enter: bool = True) -> bool:
    """
    Send keys to a tmux session.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001', without agent- prefix)
        keys: Keys to send
        send_enter: Whether to send Enter after the keys (default: True)

    Returns:
        True if keys were sent successfully
    """
    if not session_exists(agent_id):
        return False

    session_name = f"{SESSION_PREFIX}{agent_id}"

    def _send_literal(text: str) -> bool:
        if not text:
            return True
        result = subprocess.run(
            ['tmux', 'send-keys', '-t', session_name, '-l', text],
            capture_output=True,
            text=True,
        )
        return result.returncode == 0

    def _send_enter() -> bool:
        # Use load-buffer + paste-buffer for more reliable Enter key
        # tmux send-keys 'Enter' doesn't work reliably with some TUI apps
        try:
            subprocess.run(
                ['tmux', 'load-buffer', '-b', 'enter-key', '-'],
                input='\n',
                capture_output=True,
                text=True,
                check=True,
            )
            subprocess.run(
                ['tmux', 'paste-buffer', '-d', '-b', 'enter-key', '-t', session_name],
                capture_output=True,
                text=True,
                check=True,
            )
            return True
        except Exception:
            return False

    # For multi-line content, paste via tmux buffer (more reliable than send-keys).
    if '\n' in keys:
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write(keys)
            temp_file = f.name

        try:
            subprocess.run(
                ['tmux', 'load-buffer', '-b', 'agent-send', temp_file],
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ['tmux', 'paste-buffer', '-d', '-b', 'agent-send', '-t', session_name],
                capture_output=True,
                check=True,
            )
            # Wait for paste to complete before sending Enter
            time.sleep(1.0)
        except Exception:
            return False
        finally:
            import os
            try:
                os.unlink(temp_file)
            except Exception:
                pass
    else:
        # Chunk long messages to avoid dropping keys under load.
        chunk_size = 100
        for start in range(0, len(keys), chunk_size):
            chunk = keys[start:start + chunk_size]
            if not _send_literal(chunk):
                return False
            time.sleep(0.1)

    # Send carriage return as a separate command (more reliable than combining in one send-keys).
    if send_enter:
        return _send_enter()

    return True


def inject_system_prompt(agent_id: str, prompt: str) -> bool:
    """
    Inject system prompt to agent and wait for it to be processed.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001')
        prompt: System prompt content

    Returns:
        True if injection successful
    """
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))

    session_name = f"{SESSION_PREFIX}{agent_id}"

    # Write prompt to a temp file for reliable multi-line injection
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(prompt)
        f.write('\n')  # Ensure trailing newline
        temp_file = f.name

    try:
        # Use tmux's load-buffer to paste the content
        # This is more reliable than send-keys for multi-line content
        subprocess.run([
            'tmux', 'load-buffer', '-b', 'agent-prompt', temp_file
        ], capture_output=True, check=True)

        # Paste the buffer content
        subprocess.run([
            'tmux', 'paste-buffer', '-d', '-b', 'agent-prompt', '-t', session_name
        ], capture_output=True, check=True)

        # Wait a bit for paste to complete
        time.sleep(1)

        # Send Enter to execute the pasted content using load-buffer (more reliable)
        subprocess.run(
            ['tmux', 'load-buffer', '-b', 'enter-key', '-'],
            input='\n',
            capture_output=True,
            text=True,
            check=True,
        )
        subprocess.run(
            ['tmux', 'paste-buffer', '-d', '-b', 'enter-key', '-t', session_name],
            capture_output=True,
            text=True,
            check=True,
        )

        return True
    except Exception as e:
        print(f"  Debug: Injection error - {e}")
        return False
    finally:
        import os
        try:
            os.unlink(temp_file)
        except:
            pass


def wait_for_agent_ready(agent_id: str, launcher: str, timeout: int = 45) -> bool:
    """
    Wait for agent to be ready after system prompt injection.

    This checks if the agent has processed the system prompt and is ready for tasks.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001')
        launcher: Launcher path/name to detect CLI type
        timeout: Maximum seconds to wait (default: 45)

    Returns:
        True if agent is ready, False if timeout
    """
    session_name = f"{SESSION_PREFIX}{agent_id}"

    # Import provider system
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from providers import get_prompt_patterns

    prompt_patterns = get_prompt_patterns(launcher)

    start_time = time.time()
    check_interval = 2  # Check every 2 seconds
    min_wait = 3  # Minimum wait time before first check

    # Some TUIs (e.g., OpenCode) don't expose a stable prompt via tmux capture-pane.
    # In that case, treat "started" as "ready" after the minimum wait.
    if not prompt_patterns:
        time.sleep(min_wait)
        return True

    # Detect provider for special handling
    launcher_lower = launcher.lower()
    is_droid = 'droid' in launcher_lower
    is_codex = 'codex' in launcher_lower

    # Give agent time to process the prompt
    time.sleep(min_wait)

    while (time.time() - start_time) < timeout:
        # Capture recent output
        result = subprocess.run([
            'tmux', 'capture-pane', '-p', '-t', session_name, '-S-15'
        ], capture_output=True, text=True)

        if result.returncode == 0:
            output = result.stdout

            # Special handling for droid: check for droid-specific patterns
            if is_droid:
                # Droid shows help text when ready
                if '? for help' in output or '/ide for VS Code' in output:
                    return True

            # Special handling for codex: prompt may include inline suggestions (e.g. "› Summarize...")
            if is_codex:
                for line in output.split('\n'):
                    stripped = line.strip()
                    if stripped.startswith(('›', '❯')):
                        return True
                # Also check for mode line which indicates readiness
                if 'Auto (High)' in output or 'shift+tab to cycle modes' in output:
                    return True

            # Check for prompt pattern (agent ready for input)
            for pattern in prompt_patterns:
                if pattern in output:
                    lines = output.split('\n')
                    for line in lines:
                        stripped = line.strip()
                        # For droid, be more lenient with prompt detection
                        if is_droid:
                            if stripped.startswith('>'):
                                return True
                        elif is_codex:
                            if stripped.startswith(pattern):
                                return True
                        else:
                            # Look for standalone prompt
                            if stripped == pattern or (stripped.startswith(pattern) and len(stripped) <= 3):
                                return True

        time.sleep(check_interval)

    return False


def get_session_info(agent_id: str) -> Optional[Dict[str, str]]:
    """
    Get detailed information about a session.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001', without agent- prefix)

    Returns:
        Dict with 'agent_id', 'session', 'status', or None if not found
    """
    if not session_exists(agent_id):
        return None

    session_name = f"{SESSION_PREFIX}{agent_id}"

    # Get session info from tmux ls
    result = subprocess.run(['tmux', 'ls'], capture_output=True, text=True)

    if result.returncode != 0:
        return None

    for line in result.stdout.split('\n'):
        if line.startswith(f"{session_name}:"):
            # Parse session info (e.g., "agent-emp-0001: 1 windows (created Fri Jan  3 10:00:00 2025)")
            parts = line.split('(', 1)
            status = "running" if len(parts) > 1 else "unknown"

            return {
                'agent_id': agent_id,
                'session': session_name,
                'status': status
            }

    return None


def is_agent_busy(agent_id: str, launcher: str = "") -> bool:
    """
    Check if an agent is currently busy (processing/thinking).

    Args:
        agent_id: Agent ID (e.g., 'emp-0001')
        launcher: Optional launcher path for provider-specific detection

    Returns:
        True if agent is busy (should not send new tasks)
    """
    if not session_exists(agent_id):
        return False

    session_name = f"{SESSION_PREFIX}{agent_id}"

    # Capture only the last few lines to detect current state
    # Using -5 to avoid matching old output that scrolled by
    result = subprocess.run([
        'tmux', 'capture-pane', '-p', '-t', session_name, '-S-5'
    ], capture_output=True, text=True)

    if result.returncode != 0:
        return True  # If we can't read, assume busy

    output = result.stdout

    # Provider-specific activity indicators.
    try:
        import sys
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).parent.parent))
        from providers import get_busy_patterns

        busy_patterns = get_busy_patterns(launcher)
    except Exception:
        busy_patterns = []

    # Fallback patterns (minimal, cross-provider).
    if not busy_patterns:
        busy_patterns = [
            '✻ Thinking',
            'Thinking...',
            '⏳ Thinking',
            '(esc to interrupt',
        ]

    for pattern in busy_patterns:
        if pattern in output:
            return True

    return False


def _parse_elapsed_seconds(output: str) -> Optional[int]:
    """Best-effort parse of an on-screen elapsed timer (e.g., "[⏱ 5m 7s]")."""
    if not output:
        return None

    match = re.search(r"\[\s*(?:⏱|⏳)\s*(\d+)m\s*(\d+)s\s*\]", output)
    if match:
        minutes = int(match.group(1))
        seconds = int(match.group(2))
        return minutes * 60 + seconds

    match = re.search(r"\[\s*(?:⏱|⏳)\s*(\d+)s\s*\]", output)
    if match:
        return int(match.group(1))

    match = re.search(r"\b(\d+\.\d+)s\b", output)
    if match:
        try:
            return int(float(match.group(1)))
        except Exception:
            return None

    return None


def _detect_error_reason(output: str) -> Optional[str]:
    """Best-effort detect a terminal/tool error in recent agent output.

    This is intentionally heuristic: we only use it to decide whether an agent
    is "idle" versus "error" (needs restart/retry).
    """
    if not output:
        return None

    lowered = output.lower()

    # Network / gateway issues seen in this repo.
    if 'stopped after 10 redirects' in lowered:
        return 'redirect_loop'
    if 'error 522' in lowered or 'cloudflare ray id' in lowered:
        return 'cloudflare_522'
    if 'error: 500 post ' in lowered:
        return 'http_500'

    # Provider/model config issues.
    if 'api error: 400' in lowered and 'unknown provider' in lowered:
        return 'unknown_provider'
    if 'invalid_request_error' in lowered:
        return 'invalid_request'

    # Generic timeouts / connection failures.
    if 'timed out' in lowered or 'timeout' in lowered:
        return 'timeout'
    if 'econnrefused' in lowered or 'connection refused' in lowered:
        return 'connection_refused'
    if 'etimedout' in lowered:
        return 'connection_timed_out'

    return None


def is_agent_blocked(agent_id: str, launcher: str = "") -> bool:
    """Detect whether an agent is blocked on approvals/user input (best-effort)."""
    if not session_exists(agent_id):
        return False

    session_name = f"{SESSION_PREFIX}{agent_id}"
    result = subprocess.run(
        ['tmux', 'capture-pane', '-p', '-t', session_name, '-S-30'],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return False

    output = result.stdout
    try:
        import sys
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).parent.parent))
        from providers import get_blocked_patterns

        blocked_patterns = get_blocked_patterns(launcher)
    except Exception:
        blocked_patterns = []

    if not blocked_patterns:
        blocked_patterns = [
            'all actions require approval',
            'actions require approval',
            'requires approval',
            'waiting for approval',
        ]

    return any(p in output for p in blocked_patterns)


def get_agent_runtime_state(agent_id: str, launcher: str = "") -> Dict[str, object]:
    """Return a more truthful runtime state than just "tmux session exists".

    States:
      - stopped: no tmux session
      - blocked: waiting on approvals/user input
      - error: last action failed (network/provider/etc) and agent is otherwise idle
      - stuck: busy for a long time (heuristic)
      - busy: actively processing
      - idle: running and ready
    """
    if not session_exists(agent_id):
        return {'state': 'stopped'}

    session_name = f"{SESSION_PREFIX}{agent_id}"
    result = subprocess.run(
        # Capture a larger window so we can reliably detect error pages/output
        # (e.g., Cloudflare 522 HTML) that may not fit in the last ~40 lines.
        ['tmux', 'capture-pane', '-p', '-t', session_name, '-S-200'],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        return {'state': 'busy', 'reason': 'unreadable_output'}

    output = result.stdout
    elapsed_seconds = _parse_elapsed_seconds(output)

    if is_agent_blocked(agent_id, launcher=launcher):
        return {
            'state': 'blocked',
            'elapsed_seconds': elapsed_seconds,
        }

    if is_agent_busy(agent_id, launcher=launcher):
        stuck_after_seconds = 180
        try:
            import sys
            from pathlib import Path

            sys.path.insert(0, str(Path(__file__).parent.parent))
            from providers import get_stuck_after_seconds

            stuck_after_seconds = int(get_stuck_after_seconds(launcher))
        except Exception:
            stuck_after_seconds = 180

        if elapsed_seconds is not None and elapsed_seconds >= stuck_after_seconds:
            return {
                'state': 'stuck',
                'elapsed_seconds': elapsed_seconds,
            }
        return {
            'state': 'busy',
            'elapsed_seconds': elapsed_seconds,
        }

    error_reason = _detect_error_reason(output)
    if error_reason:
        return {
            'state': 'error',
            'reason': error_reason,
            'elapsed_seconds': elapsed_seconds,
        }

    return {
        'state': 'idle',
        'elapsed_seconds': elapsed_seconds,
    }


def attach_session(agent_id: str) -> bool:
    """
    Attach to a tmux session (for interactive use).

    Args:
        agent_id: Agent ID (e.g., 'emp-0001', without agent- prefix)

    Returns:
        True if attachment succeeded (note: this blocks the terminal)
    """
    if not session_exists(agent_id):
        return False

    session_name = f"{SESSION_PREFIX}{agent_id}"

    # This will block and take over the terminal
    result = subprocess.run(['tmux', 'attach', '-t', session_name])

    return result.returncode == 0


def wait_for_prompt(agent_id: str, launcher: str, timeout: int = 30) -> bool:
    """
    Wait for CLI prompt to appear in the session.

    Args:
        agent_id: Agent ID (e.g., 'emp-0001')
        launcher: Launcher path/name to detect CLI type
        timeout: Maximum seconds to wait (default: 30)

    Returns:
        True if prompt detected, False if timeout
    """
    # Import provider system
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from providers import get_prompt_patterns, get_startup_wait, PROVIDERS

    session_name = f"{SESSION_PREFIX}{agent_id}"

    # Get prompt patterns based on launcher (provider)
    prompt_patterns = get_prompt_patterns(launcher)
    startup_wait = get_startup_wait(launcher)

    # Detect provider for special handling
    launcher_lower = launcher.lower()
    is_droid = 'droid' in launcher_lower
    is_codex = 'codex' in launcher_lower

    # Initial wait for CLI to start
    time.sleep(startup_wait)

    # Some TUIs (e.g., OpenCode) don't expose a stable prompt via tmux capture-pane.
    # In that case, treat "started" as "ready" after startup_wait.
    if not prompt_patterns:
        return True

    start_time = time.time()
    check_interval = 1  # Check every second

    while (time.time() - start_time) < timeout:
        # Capture last few lines of output
        result = subprocess.run([
            'tmux', 'capture-pane', '-p', '-t', session_name, '-S-20'
        ], capture_output=True, text=True)

        if result.returncode == 0:
            output = result.stdout

            # Special handling for droid: check for droid-specific patterns
            if is_droid:
                # Droid shows help text when ready
                if '? for help' in output or '/ide for VS Code' in output:
                    return True

            # Special handling for codex: prompt may include inline suggestions (e.g. "› Summarize...")
            if is_codex:
                for line in output.split('\n'):
                    stripped = line.strip()
                    if stripped.startswith(('›', '❯')):
                        return True
                # Also check for mode line which indicates readiness
                if 'Auto (High)' in output or 'shift+tab to cycle modes' in output:
                    return True

            # Standard prompt detection
            for pattern in prompt_patterns:
                if pattern in output:
                    lines = output.split('\n')
                    for line in lines:
                        stripped = line.strip()
                        # For droid, be more lenient with prompt detection
                        if is_droid:
                            if stripped.startswith('>'):
                                return True
                        elif is_codex:
                            if stripped.startswith(pattern):
                                return True
                        else:
                            # Standard check: line is just the prompt
                            if stripped == pattern or (stripped.startswith(pattern) and len(stripped) <= 3):
                                return True

        time.sleep(check_interval)

    return False
