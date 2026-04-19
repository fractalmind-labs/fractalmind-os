# Design System: Polymarket Bitcoin 5-Minute Market

**Project ID/URL:** polymarket-clone

**Generated from:** https://polymarket.com/event/btc-updown-5m-1776588600

**Date:** 2026-04-XX

---

## 1. Visual Theme & Atmosphere

The Polymarket Bitcoin market interface embodies a **high-stakes financial dashboard** that merges the precision of trading platforms with the immediacy of real-time data visualization. The interface feels **dense yet focused**, prioritizing live data and actionable insights above decorative elements. The design philosophy is data-first and performance-oriented, allowing traders to make split-second decisions with confidence.

The overall mood is **urgent yet controlled**, creating a professional trading environment that remains accessible to newcomers. The interface feels **utilitarian in its efficiency** but polished in its execution, with every element serving a clear functional purpose. The atmosphere evokes the focused intensity of a trading floor where every second and every pixel matters.

**Key Characteristics:**
- Dark mode optimized for extended viewing sessions and reduced eye strain
- Real-time data updates with smooth animations that don't distract
- High-contrast color coding for instant yes/no decision recognition
- Minimal chrome and UI decoration to maximize data density
- Responsive feedback for every interaction (hover, click, data update)
- Professional trading aesthetic with consumer-friendly approachability

---

## 2. Color Palette & Roles

### Primary Foundation
- **Deep Charcoal Black** (#0a0a0a) – Primary background color. Creates a professional dark canvas that reduces eye strain during extended trading sessions and makes data visualizations pop.
- **Elevated Dark Gray** (#1a1a1a) – Secondary surface color used for card backgrounds and elevated panels. Provides subtle visual hierarchy while maintaining the dark aesthetic.

### Accent & Interactive
- **Vibrant Success Green** (#10b981) – The primary bullish/positive indicator. Used for "Yes" buttons, upward price movements, positive percentages, and the area chart fill. Signals opportunity and positive outcomes.
- **Alert Danger Red** (#ef4444) – The bearish/negative indicator. Used for "No" buttons, downward movements, and negative states. Creates immediate visual contrast with green for binary decision-making.

### Typography & Text Hierarchy
- **Pure Crisp White** (#ffffff) – Primary text color for headlines, prices, and critical data points. Provides maximum contrast and readability against dark backgrounds.
- **Soft Neutral Gray** (#9ca3af) – Secondary text used for labels, timestamps, and supporting metadata. Creates clear typographic hierarchy without harsh contrast.
- **Muted Slate Gray** (#6b7280) – Tertiary color for subtle UI elements, disabled states, and background text.

### Chart & Data Visualization
- **Electric Lime Green** (#22c55e) – Chart line color for real-time price data. Slightly brighter than the success green to stand out against the dark background.
- **Translucent Green Gradient** (rgba(16, 185, 129, 0.2) → rgba(16, 185, 129, 0.0)) – Area chart fill creating depth without overwhelming the line data.
- **Subtle Grid Gray** (#1f2937) – Chart grid lines and axis markers. Barely visible but provides essential reference points.

---

## 3. Typography Rules

**Primary Font Family:** Inter  
**Character:** Modern geometric sans-serif optimized for screen readability. Clean, neutral letterforms with excellent legibility at small sizes. Designed specifically for UI/data display.

### Hierarchy & Weights
- **Display Prices (Hero):** Semi-bold weight (600), tight letter-spacing (-0.02em for density), 2.5-3rem size. Used for current price and "Price To Beat" values that demand immediate attention.
- **Section Headers (H2):** Medium weight (500), normal letter-spacing, 1.25-1.5rem size. Labels like "Price To Beat" and "Current Price" that establish data zones.
- **Data Values:** Semi-bold weight (600), tabular numbers, 1-1.25rem size. Prices, percentages, and numeric data requiring precision and quick scanning.
- **Body Labels:** Regular weight (400), normal letter-spacing, 0.875-1rem size. Descriptive text and metadata that supports primary data.
- **Small Meta:** Regular weight (400), tight line-height (1.4), 0.75-0.875rem size. Timestamps, disclaimers, and tertiary information.
- **CTA Buttons:** Semi-bold weight (600), subtle letter-spacing (0.01em), 1rem size. "Yes" and "No" buttons demand confident, decisive typography.

### Spacing Principles
- Tight vertical rhythm (1-1.5rem) between related data points for information density
- Generous padding around interactive elements (minimum 44px touch targets)
- Tabular number alignment for easy price comparison
- Consistent 0.5-1rem gaps between label and value pairs

---

## 4. Component Stylings

### Buttons
- **Shape:** Moderately rounded corners (6px/0.375rem radius) – modern and approachable without being playful
- **Yes Button (Primary):** Vibrant Success Green (#10b981) background with pure white text, comfortable padding (0.75rem vertical, 2rem horizontal)
- **No Button (Secondary):** Alert Danger Red (#ef4444) background with pure white text, matching padding
- **Hover State:** Subtle brightening (10% lighter) with smooth 150ms ease-out transition
- **Active State:** Slight scale down (0.98) for tactile feedback
- **Focus State:** 2px outline in button color with 2px offset for keyboard navigation

### Cards & Price Containers
- **Corner Style:** Gently rounded corners (8px/0.5rem radius) creating modern, refined edges
- **Background:** Elevated Dark Gray (#1a1a1a) with subtle border in Muted Slate Gray
- **Shadow Strategy:** Flat by default. No shadows to maintain clean, data-focused aesthetic
- **Border:** Hairline 1px border in rgba(255,255,255,0.1) for subtle definition
- **Internal Padding:** Comfortable 1.5rem creating breathing room without wasting space
- **Data Layout:** Vertical stack with label above value, left-aligned for scannability

### Chart Component
- **Container:** Full-width responsive container with 16:9 aspect ratio on mobile, 2:1 on desktop
- **Line Style:** 2px solid stroke in Electric Lime Green, smooth bezier curves
- **Area Fill:** Linear gradient from translucent green (20% opacity) to transparent
- **Grid Lines:** Subtle horizontal lines in Subtle Grid Gray, no vertical lines to reduce clutter
- **Crosshair:** Thin 1px lines in white (50% opacity) appearing on hover
- **Tooltip:** Dark elevated card with white text, 4px rounded corners, appears above cursor
- **Animation:** Smooth 300ms ease-out transitions for data updates, chart auto-scrolls left as new data arrives

### Price Display Cards
- **Layout:** Two-column grid on desktop, stacked on mobile
- **Label Typography:** Soft Neutral Gray, uppercase, 0.75rem, letter-spacing 0.05em
- **Value Typography:** Pure Crisp White, semi-bold, 2rem, tabular numbers
- **Percentage Badge:** Inline with value, smaller size (1.25rem), color-coded (green/red)
- **Update Animation:** 150ms flash effect (opacity pulse) when value changes
- **Hover Behavior:** Subtle background lightening (5% lighter) to indicate interactivity

---

## 5. Layout Principles

### Grid & Structure
- **Max Content Width:** 1200px for optimal readability on large displays
- **Grid System:** Flexible single-column layout with responsive breakpoints
- **Content Zones:**
  - Header: Market title and metadata (full-width)
  - Price Cards: Two-column grid (desktop) / stacked (mobile)
  - Chart: Full-width responsive container
  - Action Buttons: Two-column grid (equal width)
- **Breakpoints:**
  - Mobile: <640px (single column, stacked layout)
  - Tablet: 640-1024px (transitional, some two-column)
  - Desktop: >1024px (full two-column layout)

### Whitespace Strategy
- **Base Unit:** 4px for micro-spacing, 8px for component spacing
- **Vertical Rhythm:** Tight 1rem (16px) between related elements for data density
- **Section Margins:** Moderate 2-3rem (32-48px) between major sections
- **Edge Padding:** 1rem (16px) mobile, 2rem (32px) desktop for comfortable framing
- **Chart Padding:** Minimal internal padding to maximize data visualization area

### Alignment & Visual Balance
- **Text Alignment:** Left-aligned for all content (optimal for data scanning)
- **Chart to Controls Ratio:** 60-40 split favoring chart visualization
- **Symmetric Balance:** Equal visual weight for Yes/No buttons
- **Visual Weight Distribution:** Chart dominates upper half, actions anchor bottom
- **Reading Flow:** Top-to-bottom: Title → Price Data → Chart → Actions

### Responsive Behavior & Touch
- **Mobile-First Foundation:** Core experience designed for mobile trading on-the-go
- **Progressive Enhancement:** Larger chart, side-by-side cards added at desktop breakpoints
- **Touch Targets:** Minimum 44x44px for all buttons and interactive elements
- **Chart Optimization:** Simplified tooltip on mobile (tap to show), full crosshair on desktop (hover)
- **Collapsing Strategy:** Two-column grids collapse to single column, padding scales proportionally

---

## 6. Animation & Motion

### Timing & Easing
- **Default Transition:** 150ms ease-out for most UI interactions
- **Price Updates:** 300ms ease-out for smooth number transitions
- **Chart Data:** 500ms ease-out for new data point insertion
- **Hover Effects:** 150ms ease-in-out for button and card hovers

### Common Patterns
- **Price Number Scrolling:** Smooth interpolation using requestAnimationFrame, cubic easing
- **Percentage Flash:** 150ms opacity pulse (1.0 → 0.7 → 1.0) on value change
- **Chart Auto-Scroll:** Continuous left translation as new data arrives, maintains 120 data points visible
- **Button Hover:** Subtle color brightening + slight scale (1.02) for tactile feedback
- **Data Point Fade-In:** New chart points fade in over 200ms to avoid jarring updates

### Performance Considerations
- Use CSS transforms (translateX, scale) instead of position changes
- Leverage requestAnimationFrame for smooth 60fps animations
- Debounce rapid data updates to avoid animation overload
- Use will-change: transform on animated elements

---

## 7. Usage Guidelines for AI Generation

When creating new screens or components for this project, use this language:

### Atmosphere References
- "High-stakes financial dashboard with data-first focus"
- "Dark mode optimized for extended trading sessions"
- "Urgent yet controlled professional trading environment"

### Color References
Always use descriptive names with hex codes:
- Primary actions: "Vibrant Success Green (#10b981)" for Yes/bullish
- Secondary actions: "Alert Danger Red (#ef4444)" for No/bearish
- Backgrounds: "Deep Charcoal Black (#0a0a0a)" or "Elevated Dark Gray (#1a1a1a)"
- Text: "Pure Crisp White (#ffffff)" or "Soft Neutral Gray (#9ca3af)"
- Chart: "Electric Lime Green (#22c55e)" with "Translucent Green Gradient"

### Component Prompts
- "Create a price card with elevated dark gray background, white semi-bold value, and subtle gray label"
- "Design a Yes button in Vibrant Success Green (#10b981) with moderately rounded corners and confident semi-bold text"
- "Add a real-time chart with electric lime green line, translucent gradient fill, and smooth auto-scrolling behavior"
- "Implement price number with smooth scrolling animation using requestAnimationFrame and cubic easing"

### Incremental Iteration
When refining existing screens:
1. Focus on ONE component at a time (e.g., "Update the chart line thickness")
2. Be specific about what to change (e.g., "Increase line width from 1.5px to 2px")
3. Reference this design system language consistently
4. Test animations at 60fps before considering complete

---

## Notes

**Design Philosophy:**
This design system prioritizes **function over form** while maintaining visual polish. Every animation serves a functional purpose (communicating state changes, guiding attention) rather than decoration. The dark theme reduces cognitive load during extended use, and the binary green/red color system enables instant decision-making.

**Deviations from Original:**
- Simplified chart controls (removed time range selector for MVP)
- Reduced animation complexity for performance on lower-end devices
- Slightly larger touch targets (44px vs original ~40px) for better mobile accessibility

**Future Considerations:**
- Add order book visualization component
- Implement multi-timeframe chart switching
- Add price alert notification system
- Consider light mode variant for daytime trading
