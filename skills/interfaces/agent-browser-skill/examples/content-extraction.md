# Content Extraction

Use agent-browser to extract structured data from web pages.

## Extract Text Content

```bash
# Open the page
npx agent-browser open "https://example.com/article"

# Get full page text via accessibility tree
npx agent-browser snapshot
# This returns all text nodes, headings, links, etc.

# Get text from a specific element
npx agent-browser snapshot -i        # Find the element ref
npx agent-browser innertext @e5      # Extract just that element's text
```

## Extract Links

```bash
npx agent-browser open "https://example.com"
npx agent-browser snapshot -i
# All links show as: link "Link Text" [ref=eN]
# with /url: attribute in full snapshot

# For programmatic extraction:
npx agent-browser evaluate "JSON.stringify([...document.querySelectorAll('a')].map(a => ({text: a.textContent.trim(), href: a.href})))"
```

## Extract Table Data

```bash
npx agent-browser open "https://example.com/pricing"

# Use JavaScript to extract structured table data
npx agent-browser evaluate "JSON.stringify([...document.querySelectorAll('table tr')].map(tr => [...tr.cells].map(td => td.textContent.trim())))"
```

## Extract Metadata

```bash
npx agent-browser open "https://example.com"

# Page title
npx agent-browser title

# Current URL
npx agent-browser url

# Meta tags
npx agent-browser evaluate "JSON.stringify({title: document.title, description: document.querySelector('meta[name=description]')?.content, ogImage: document.querySelector('meta[property=\"og:image\"]')?.content})"
```

## Multi-Page Data Collection

```bash
# Crawl through paginated results
npx agent-browser open "https://example.com/products?page=1" --session crawl

# Page 1
npx agent-browser evaluate "JSON.stringify([...document.querySelectorAll('.product')].map(p => ({name: p.querySelector('h3')?.textContent, price: p.querySelector('.price')?.textContent})))"

# Navigate to page 2
npx agent-browser snapshot -i       # Find "Next" button
npx agent-browser click @e15        # Click Next
npx agent-browser wait 1000

# Page 2
npx agent-browser evaluate "JSON.stringify([...document.querySelectorAll('.product')].map(p => ({name: p.querySelector('h3')?.textContent, price: p.querySelector('.price')?.textContent})))"

npx agent-browser close --session crawl
```

## Tips

- **Use `snapshot`** (without `-i`) when you need to read all text, not just interactive elements
- **Use `innertext`** for extracting text from a specific element identified via snapshot
- **Use `evaluate`** for complex extraction logic (CSS selectors, JSON serialization)
- **Use `--session`** when crawling multiple pages to maintain state
