---
name: use-agent-browser
description: Fast headless browser for AI agents via agent-browser CLI. Use when you need to browse websites, take screenshots, fill forms, click elements, extract page content, audit web UIs, or perform any browser automation task. Token-efficient output with element references (@e1, @e2) instead of raw HTML.
license: MIT
---

# Agent Browser — Headless Browser for AI Agents

`agent-browser` is a fast headless browser CLI (Rust + Node.js + Playwright) optimized for AI agent usage. It produces compact, token-efficient output using accessibility-tree element references (`@e1`, `@e2`, ...) instead of raw HTML.

## One-Time Setup

```bash
# Install browser + system dependencies (requires sudo once)
npx agent-browser install --with-deps

# If sudo fails, install deps manually:
sudo npx playwright install-deps chromium
npx playwright install chromium
```

## Core Workflow

The fundamental pattern is: **navigate → snapshot → interact → verify**.

```bash
# 1. Open a URL
npx agent-browser open "https://example.com"

# 2. Take a snapshot (accessibility tree with element refs)
npx agent-browser snapshot -i
# Output: @e1 [link] "Home"  @e2 [button] "Sign In"  @e3 [textbox] "Search"

# 3. Interact using element refs
npx agent-browser click @e2          # Click "Sign In"
npx agent-browser fill @e3 "query"   # Type into search box

# 4. Verify result
npx agent-browser snapshot -i        # See updated state
npx agent-browser screenshot /tmp/result.png  # Visual capture
```

## Essential Commands

### Navigation
```bash
npx agent-browser open "URL"              # Navigate to URL
npx agent-browser back                     # Go back
npx agent-browser forward                  # Go forward
npx agent-browser reload                   # Reload page
npx agent-browser wait MILLISECONDS        # Wait for content to load
```

### Inspection
```bash
npx agent-browser snapshot -i             # Accessibility tree (interactive elements only) — PRIMARY TOOL
npx agent-browser snapshot                 # Full accessibility tree (all elements)
npx agent-browser screenshot PATH          # Save screenshot as PNG
npx agent-browser screenshot --full PATH   # Full-page screenshot
npx agent-browser title                    # Get page title
npx agent-browser url                      # Get current URL
```

### Interaction
```bash
npx agent-browser click @e1               # Click element
npx agent-browser fill @e1 "text"          # Type into input field
npx agent-browser select @e1 "option"      # Select dropdown option
npx agent-browser check @e1                # Check checkbox
npx agent-browser uncheck @e1              # Uncheck checkbox
npx agent-browser hover @e1                # Hover over element
npx agent-browser focus @e1                # Focus element
```

### Keyboard & Mouse
```bash
npx agent-browser press "Enter"            # Press key
npx agent-browser press "Control+a"        # Key combo
npx agent-browser type "hello"             # Type text at cursor
npx agent-browser scroll down 500          # Scroll down 500px
npx agent-browser scroll up 300            # Scroll up 300px
```

### Content Extraction
```bash
npx agent-browser innertext @e1            # Get text content of element
npx agent-browser innerhtml @e1            # Get innerHTML
npx agent-browser textcontent @e1          # Get textContent
npx agent-browser value @e1                # Get input value
npx agent-browser attribute @e1 "href"     # Get attribute value
```

### Sessions
```bash
npx agent-browser open "URL" --session mytest    # Named session (persists cookies/state)
npx agent-browser snapshot -i --session mytest   # Continue in same session
npx agent-browser close --session mytest         # Close session
```

### Advanced
```bash
npx agent-browser pdf /tmp/page.pdf        # Save page as PDF
npx agent-browser evaluate "document.title" # Run JS in page context
npx agent-browser network                   # Show network requests
npx agent-browser cookies                   # Show cookies
npx agent-browser tabs                      # List open tabs
npx agent-browser tab 2                     # Switch to tab 2
```

## Usage Patterns

### Site Audit / Visual QA
```bash
npx agent-browser open "https://docs-test.cloudbank.to"
npx agent-browser screenshot /tmp/homepage.png --full
npx agent-browser snapshot -i                 # Check navigation, links
npx agent-browser click @e5                   # Navigate to subpage
npx agent-browser screenshot /tmp/subpage.png
```

### Form Testing
```bash
npx agent-browser open "https://app.example.com/login" --session login-test
npx agent-browser snapshot -i
npx agent-browser fill @e3 "user@example.com"
npx agent-browser fill @e4 "password123"
npx agent-browser click @e5                   # Submit button
npx agent-browser wait 2000
npx agent-browser snapshot -i                 # Check result
npx agent-browser close --session login-test
```

### Content Extraction
```bash
npx agent-browser open "https://example.com/pricing"
npx agent-browser snapshot                    # Full tree for all text
npx agent-browser evaluate "JSON.stringify([...document.querySelectorAll('.price')].map(e => e.textContent))"
```

### Multi-Page Crawl
```bash
npx agent-browser open "https://docs.example.com" --session crawl
npx agent-browser snapshot -i                 # Find nav links
npx agent-browser click @e10                  # Click first doc link
npx agent-browser snapshot -i                 # Read content
npx agent-browser back
npx agent-browser click @e11                  # Next link
npx agent-browser close --session crawl
```

## Key Concepts

- **Element References** (`@e1`, `@e2`): Temporary IDs assigned to interactive elements in `snapshot -i` output. They change after navigation or DOM updates — always re-snapshot before interacting.
- **`snapshot -i`** (interactive only): Shows only clickable/fillable elements. Use this 90% of the time — much smaller output.
- **`snapshot`** (full): Shows all elements including text nodes. Use when you need to read page content.
- **Sessions**: Named sessions persist browser state (cookies, localStorage) across commands. Use for multi-step flows like login.
- **Token efficiency**: Snapshots produce 200-400 tokens vs 3,000-5,000 for raw HTML. Always prefer `snapshot` over `evaluate "document.body.innerHTML"`.

## Tips

- **Always snapshot before interacting** — element refs are invalidated by navigation and DOM changes
- **Use `--session`** for multi-step workflows to avoid re-authentication
- **Use `wait`** after clicks that trigger page loads or AJAX before snapshotting again
- **Use `screenshot`** when visual layout matters (CSS issues, alignment, responsive design)
- **Use `snapshot`** (without `-i`) when you need to read text content, not just interactive elements
- **Prefer `innertext`** over `evaluate` for extracting text from specific elements
