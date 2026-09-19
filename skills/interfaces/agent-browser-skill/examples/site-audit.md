# Site Audit / Visual QA

Use agent-browser to audit a website's visual appearance, navigation, and link integrity.

## Workflow

```bash
# 1. Open the site
npx agent-browser open "https://your-site.com" --session audit

# 2. Screenshot the homepage
npx agent-browser screenshot /tmp/audit-homepage.png --full

# 3. Check navigation structure
npx agent-browser snapshot -i
# Look for: nav links, buttons, search, language switcher

# 4. Visit each major section
npx agent-browser click @e5        # e.g., "Getting Started"
npx agent-browser screenshot /tmp/audit-getting-started.png --full
npx agent-browser snapshot -i      # Verify sidebar, content, links

# 5. Go back and check next section
npx agent-browser back
npx agent-browser click @e6        # e.g., "API Reference"
npx agent-browser screenshot /tmp/audit-api-reference.png --full

# 6. Test dark mode
npx agent-browser click @e10       # e.g., dark mode toggle
npx agent-browser screenshot /tmp/audit-dark-mode.png

# 7. Test search
npx agent-browser click @e3        # Search button
npx agent-browser snapshot -i      # Find search input
npx agent-browser fill @e44 "settlement"
npx agent-browser screenshot /tmp/audit-search.png

# 8. Check a different locale
npx agent-browser open "https://your-site.com/zh-TW/" --session audit
npx agent-browser screenshot /tmp/audit-zh.png --full

# 9. Close
npx agent-browser close --session audit
```

## What to Check

- **Navigation**: All nav links present and clickable
- **Content**: Pages have real content (not stubs)
- **Search**: Returns relevant results
- **Dark mode**: Readable contrast, no broken styles
- **i18n**: Translated content renders correctly
- **Responsive**: Compare screenshots at different viewports
- **Dead links**: Click through all sidebar links, verify pages load
