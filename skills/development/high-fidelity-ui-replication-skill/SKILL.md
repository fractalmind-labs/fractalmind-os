---
name: high-fidelity-ui-replication
description: Use when you need high-fidelity recreation of a reference UI, chart, animation, or interaction from screenshots, videos, or live products. Produces a replication spec, motion/state breakdown, implementation plan, and artifact-based acceptance process focused on timing, easing, spacing, responsive behavior, and interaction details.
license: MIT
---

# High-Fidelity UI Replication

Use this skill when “close enough” is not enough and the target is a near-match to a reference surface.

## Quick Start

**For first-time users**: Jump straight to a working example:
1. Read `examples/polymarket-btc-replication.md` for a complete end-to-end case study
2. Follow the 5-phase workflow: Reconnaissance → Architecture → Static → Animation → QA
3. Use the validation workflow at the end to compare your result

**Minimum viable workflow**:
```bash
# 1. Capture reference (10-15s video)
npx @playwright/cli@latest open <target-url>
npx @playwright/cli@latest video-start recording.webm
# ... interact with the UI ...
npx @playwright/cli@latest video-stop

# 2. Extract frames for analysis
ffmpeg -i recording.webm -vf “select=not(mod(n\,10))” frame_%03d.jpg

# 3. Build your replication (see Phase 2-4 below)

# 4. Validate with side-by-side comparison
npx @playwright/cli@latest goto http://localhost:5173
npx @playwright/cli@latest video-start clone.webm
# ... same interactions ...
npx @playwright/cli@latest video-stop
```

**Required outputs for acceptance**:
- ✅ Side-by-side screenshots (idle + hover states)
- ✅ Comparison video (original vs clone, same interactions)
- ✅ Frame checkpoints (key animation moments)
- ✅ Gap report (remaining deltas with measurements)

## What This Skill Optimizes For

- animation and motion parity, not just static layout
- reproducible breakdown of interaction states
- artifact-based acceptance instead of subjective “looks similar” claims
- implementation guidance that separates layout, state, and motion work
- **pixel-perfect visual fidelity through iterative video analysis**
- **systematic engineering approach**: from visual pixels to interaction logic to underlying architecture
- **complete mapping capability**: design tokens, component hierarchy, state machines, and performance optimization

## Core Competency Matrix

To achieve high-fidelity replication, you need mastery across four dimensions:

### 1. Visual Auditing & Deconstruction
- **Pixel-level restoration**: Identify and reproduce subtle differences in padding/margin (16px vs 18px), line-height, font-weight
- **Color system extraction**: Understand color semantics (Primary, Secondary, Surface, Error), extract complete Design Tokens from screenshots
- **Layout reverse engineering**: Instantly recognize Flexbox, Grid, or absolute positioning; identify responsive breakpoints
- **Asset analysis**: Identify image formats (WebP/AVIF), SVG icon structure, custom font loading strategies

### 2. Dynamic Interaction Capture
- **Micro-interactions**: Capture button hover states, click feedback (scale/color), loading skeletons, input focus animations
- **Transition animations**: Analyze page transitions, modal popups, list item insertions with easing functions (cubic-bezier) and durations
- **Scroll behavior**: Parallax scrolling, sticky headers, infinite scroll logic

### 3. Data Flow & State Simulation
- **Static to dynamic**: Transform static HTML into state-driven components (React/Vue)
- **Mock data construction**: Infer data structures (JSON Schema) from UI, generate realistic mock data (not hardcoded)
- **Async behavior simulation**: Simulate API delays, error states (404/500), empty states, loading states

### 4. Performance & Engineering
- **Semantic HTML**: Ensure correct usage of `<header>`, `<nav>`, `<article>` for SEO and accessibility (A11y)
- **Code reusability**: Extract common components (Button, Card, Input), avoid duplication
- **Responsive adaptation**: Perfect rendering across Mobile, Tablet, Desktop

## Required Tools

Before starting, ensure these tools are available:

### Required (Must Have)
- **playwright-cli**: Automated browser control, screenshots, video recording
- **ffmpeg**: Video frame extraction and analysis
- **Chrome DevTools**: Inspect elements, network panel, performance analysis
- **Vite or similar dev server**: Live preview and hot reload

### Recommended (Strongly Suggested)
- **ColorZilla**: Precise color picking, gradient analysis
- **WhatFont**: Identify font family, size, line-height
- **Tailwind CSS**: Rapid layout/style restoration
- **Framer Motion** or **GSAP**: Animation libraries (choose based on stack)

### Optional / Fallback
- **Wappalyzer**: Tech stack identification (can use DevTools instead)
- **PerfectPixel**: Chrome extension for overlay comparison (can use opacity layers instead)
- **MSW (Mock Service Worker)**: API mocking (can use static data initially)
- **Multimodal AI**: Gemini 1.5 Pro or Qwen2-VL for video understanding (helpful but not required)
- **Lighthouse**: Performance scoring (use for polish phase only)

## DESIGN.md Integration

This skill supports **bidirectional DESIGN.md integration** to ensure design system consistency:

### Input Mode: Respecting Existing Design Systems

**When to check for DESIGN.md:**
- Before starting any replication work
- When replicating into an existing project
- When the user mentions "keep our design language" or "match our style"

**What to do if DESIGN.md exists:**
1. **Read and parse** the DESIGN.md file at project root
2. **Extract constraints:**
   - Color palette (primary, secondary, accent colors with hex codes)
   - Typography rules (font families, weights, sizes, letter-spacing)
   - Component patterns (button styles, card treatments, shadows)
   - Spacing system (base units, margins, padding scales)
   - Border radius conventions (sharp, subtle, pill-shaped)
3. **Apply constraints during replication:**
   - Map original colors to project palette (e.g., original #3b82f6 → project primary #294056)
   - Use project fonts instead of original fonts
   - Match button/card styling to project conventions
   - Respect spacing system (convert arbitrary values to project scale)
4. **Document deviations:**
   - If original design conflicts with DESIGN.md, note in Delta List
   - Explain why certain elements couldn't match project system
   - Suggest DESIGN.md updates if original has superior patterns

**Example constraint application:**
```markdown
Original: Blue button (#3b82f6), rounded-lg (8px), shadow-md
DESIGN.md: "Deep Muted Teal-Navy (#294056)", "Subtly rounded corners (8px)", "Whisper-soft shadows"
Result: Use #294056, keep 8px radius, match shadow to project style
```

### Output Mode: Generating Design System Documentation

**When to generate DESIGN.md:**
- After completing a replication (optional deliverable)
- When user requests "document the design system"
- When replicating into a new project without existing DESIGN.md

**What to include:**
1. **Visual Theme & Atmosphere** - Descriptive mood and aesthetic philosophy
2. **Color Palette & Roles** - Descriptive names + hex codes + functional roles
3. **Typography Rules** - Font families, weights, hierarchy, spacing
4. **Component Stylings** - Buttons, cards, inputs, navigation patterns
5. **Layout Principles** - Grid system, whitespace strategy, responsive behavior

**Language guidelines:**
- Use **natural, descriptive language** not technical jargon
  - ✅ "Subtly rounded corners" ❌ "rounded-lg" or "8px"
  - ✅ "Whisper-soft diffused shadows" ❌ "shadow-sm"
  - ✅ "Deep Muted Teal-Navy (#294056)" ❌ "Primary blue"
- Include **exact values in parentheses** after descriptions
- Explain **functional roles** not just appearance
- Capture **atmosphere and mood** with evocative adjectives

**DESIGN.md structure:**
```markdown
# Design System: [Project Name]

## 1. Visual Theme & Atmosphere
(Mood, density, aesthetic philosophy)

## 2. Color Palette & Roles
- **Descriptive Name** (#HEX) – Functional role and usage context

## 3. Typography Rules
- Font families, weights, hierarchy, letter-spacing character

## 4. Component Stylings
- Buttons: Shape, colors, hover behavior
- Cards: Corners, shadows, padding
- Inputs: Borders, focus states, backgrounds

## 5. Layout Principles
- Grid system, whitespace strategy, responsive breakpoints
```

**Reference:** See `references/design-md-template.md` for complete template and examples.

## Required Inputs

Before implementation, lock as many of these as possible:

- reference surface: URL, video, screenshots, or all three
- exact target area: page section, modal, chart, hover card, sheet, etc.
- viewport(s): desktop/mobile widths
- theme: light/dark if relevant
- critical states: idle, hover, pressed, loading, empty, error, success
- fidelity bar: acceptable deltas for spacing, timing, and interaction feel

If the ask is specifically about animation, do **not** treat a single screenshot as sufficient evidence. Use video/live capture or multi-frame capture.

## Core Workflow

### Phase 1: Deep Reconnaissance

**Spend 30% of time observing and analyzing, 70% coding. Sharpening the axe doesn't delay chopping wood.**

**Step 0: Check for existing design system (CRITICAL)**
```bash
# Check if project has DESIGN.md
if [ -f "DESIGN.md" ]; then
  echo "✅ Found DESIGN.md - will respect project design system"
  # Read and parse constraints before proceeding
else
  echo "ℹ️  No DESIGN.md found - will extract design system from original"
fi
```

**If DESIGN.md exists:**
- Read and extract all design constraints (colors, fonts, spacing, components)
- Note any conflicts between original design and project system
- Plan how to adapt original to match project conventions
- Document constraint application strategy in replication spec

1. **Global capture and recording**
   - Don't just look at the homepage — record the entire user flow, capture all dynamic effects
   - Minimum 10-15 seconds of interaction video
   - Screenshot all critical states: idle, hover, active, loading, error, empty

2. **Tech stack detection**
   ```bash
   # Use Wappalyzer or browser extensions to identify:
   # - Framework: React/Vue/Next.js/Nuxt
   # - UI Library: Tailwind/Material/AntD
   # - Build tools: Vite/Webpack/Turbopack
   ```

3. **Resource extraction**
   - Download all font files, SVG icons, key background images
   - Extract color palette using ColorZilla
   - Identify font families with WhatFont

**Critical: For animation-heavy UIs, record video first**
```bash
# Open target page
npx @playwright/cli@latest open <URL>

# Close any popups/modals that block the view
npx @playwright/cli@latest press Escape

# Record 10-15 seconds of interaction
npx @playwright/cli@latest video-start recording.webm
# Wait for animations to play...
npx @playwright/cli@latest video-stop
```

### Phase 2: Architecture Setup

**Don't hardcode values — build a design system from day one.**

**If DESIGN.md exists, apply constraints:**
```javascript
// Example: Mapping original colors to project palette
// Original: #3b82f6 (blue), #22c55e (green)
// DESIGN.md: "Deep Muted Teal-Navy (#294056)", "Success Moss (#10B981)"

const colorMapping = {
  // Map original → project colors
  '#3b82f6': '#294056', // Primary action
  '#22c55e': '#10B981', // Success state
  // Keep original if no project equivalent
  '#ef4444': '#ef4444', // Error (no project color defined)
};

// Apply project typography
const typography = {
  fontFamily: 'Manrope', // From DESIGN.md, not original font
  weights: { normal: 400, medium: 500, semibold: 600 }, // Project scale
  letterSpacing: { tight: '0.01em', normal: '0', wide: '0.02em' },
};

// Apply project spacing system
const spacing = {
  base: 8, // Project uses 8px base unit
  scale: [0, 8, 16, 24, 32, 48, 64, 96, 128], // Convert arbitrary values to scale
};
```

1. **Design Tokens (Design Tokens)**
   - Establish `tailwind.config.js` or CSS Variables
   - Define colors, fonts, spacing, border-radius, shadows
   - **Key point**: Don't hardcode color values, define everything as `--color-primary` variables

   ```javascript
   // tailwind.config.js example
   module.exports = {
     theme: {
       extend: {
         colors: {
           primary: '#3b82f6',
           secondary: '#8b5cf6',
           surface: '#1a1a1a',
           error: '#ef4444',
         },
         spacing: {
           '18': '4.5rem', // Custom spacing
         },
         borderRadius: {
           'xl': '0.75rem',
         },
       },
     },
   };
   ```

2. **Component planning**
   - Draw component tree (Component Tree)
   - Distinguish atomic components (Atoms), molecular components (Molecules), page templates (Templates)
   - Follow Atomic Design principles for scalability

### Phase 3: Static Reconstruction

1. **Layout first**
   - Write HTML structure and basic Grid/Flex layout first
   - Ignore detail styles, ensure skeleton consistency
   - Validate structure before adding visual polish

2. **Style filling**
   - Gradually add colors, fonts, borders, shadows
   - Use browser DevTools to compare computed styles
   - Extract exact values from original site when possible

3. **Responsive debugging**
   - Switch device sizes constantly during development
   - Ensure breakpoint logic is correct
   - Test on actual devices, not just DevTools emulation

### Phase 4: Inject Soul (Animation & Logic)

**Focus on "feel" not just "numbers" — sometimes 0.35s feels right, not 0.3s.**

1. **State management**
   - Introduce State (useState/Context)
   - Handle form input, tab switching, modal display
   - Implement loading, error, and empty states

2. **Animation implementation**
   - Simple transitions: CSS `transition`
   - Complex sequence animations: CSS `keyframes` or Framer Motion/GSAP
   - **Critical**: Adjust `timing-function` until it matches original feel

   ```css
   /* Don't just copy duration — feel the rhythm */
   .button {
     transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
   }
   ```

3. **Data simulation**
   - Connect Mock data
   - Implement list rendering, pagination, search filtering logic
   - Use MSW for realistic API simulation

### Phase 5: Pixel-Perfect QA

**"Like" vs "Identical" — the difference is in the details.**

1. **Overlay comparison**
   - Use PerfectPixel to overlay original screenshot at 50% opacity
   - Check alignment pixel by pixel
   - Adjust until perfect overlap

2. **Interaction testing**
   - Test each Hover, Click, Focus, Scroll effect individually
   - Record side-by-side videos for comparison
   - Measure timing differences frame by frame

3. **Performance optimization**
   - Compress images, lazy loading, code splitting
   - Ensure Lighthouse score meets standards (>90)
   - GPU acceleration for animations (transform, opacity)

**Validation Workflow:**
```bash
# 1. Record both original and clone
npx @playwright/cli@latest open <original-url>
npx @playwright/cli@latest video-start original.webm
# ... wait 10s ...
npx @playwright/cli@latest video-stop

npx @playwright/cli@latest goto http://localhost:5173
npx @playwright/cli@latest video-start clone.webm
# ... wait 10s ...
npx @playwright/cli@latest video-stop

# 2. Extract comparison frames
ffmpeg -i original.webm -vf "select=eq(n\,50)" -frames:v 1 -update 1 original-mid.jpg
ffmpeg -i clone.webm -vf "select=eq(n\,50)" -frames:v 1 -update 1 clone-mid.jpg

# 3. Visual diff (use Read tool to compare)
```

### Replication Spec Framework

Split the reference into 4 layers:

1. **Static surface**
   - layout, spacing, radius, shadows, borders, typography, colors
2. **State machine**
   - idle, hover, active, loading, error, empty, expanded, collapsed
3. **Motion timeline**
   - duration, easing, delay, transform, opacity, stagger, clipping, interpolation
4. **Data coupling**
   - what user/system event triggers each visual transition

When helpful, express motion like this:

```text
Element: tooltip
Trigger: hover datapoint
Enter: 140ms, ease-out, opacity 0→1, translateY 6px→0
Exit: 100ms, ease-in, opacity 1→0
```

**Enhanced: Deep Visual Audit (for complex animations)**

Extract video frames for frame-by-frame analysis:
```bash
# Extract every Nth frame (e.g., every 10th frame for 30fps video)
ffmpeg -i recording.webm -vf “select=not(mod(n\,10))” frame_%03d.jpg

# Or extract specific frames
ffmpeg -i recording.webm -vf “select=eq(n\,0)+eq(n\,50)+eq(n\,100)” -frames:v 3 frame_%03d.jpg
```

Analyze frames for:
- **Number animation**: Does the number scroll/interpolate or jump instantly?
- **Easing curves**: Fast start + slow end (ease-out) vs linear
- **Color transitions**: Flash effects, opacity changes
- **Chart behavior**: Does it shift left, add points, or redraw?
- **Micro-interactions**: Button hover lift, shadow changes, border width

### Implementation Passes

Do not jump straight into “perfect animation.” Use this order:

1. **Static parity** (layout, colors, typography)
2. **State parity** (hover, active, disabled states)
3. **Motion parity** (animations, transitions)
4. **Responsive parity** (mobile, tablet breakpoints)
5. **Polish/perf cleanup** (GPU acceleration, will-change, debouncing)

This prevents motion work from hiding simpler layout/state mismatches.

**Key Implementation Patterns from Real-World Experience:**

#### Pattern 1: Smooth Number Scrolling
```javascript
class PriceAnimator {
  constructor(element) {
    this.element = element;
    this.current = 0;
    this.target = 0;
    this.animating = false;
  }

  update(newPrice) {
    this.target = newPrice;
    if (!this.animating) {
      this.animating = true;
      this.animate();
    }
  }

  animate() {
    const diff = this.target - this.current;
    if (Math.abs(diff) < 0.01) {
      this.current = this.target;
      this.animating = false;
      this.render();
      return;
    }

    // ease-out cubic: fast start, slow end
    this.current += diff * 0.15;
    this.render();
    requestAnimationFrame(() => this.animate());
  }

  render() {
    this.element.textContent = '$' + this.current.toFixed(2);
  }
}
```

#### Pattern 2: Flash Effect on Value Change
```css
@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.value-change {
  animation: flash 150ms ease-in-out;
}
```

```javascript
function updateValue(newValue) {
  element.classList.remove('value-change');
  void element.offsetWidth; // Force reflow
  element.classList.add('value-change');
  element.textContent = newValue;
}
```

#### Pattern 3: Real-time Chart Updates
```javascript
// Using Lightweight Charts
setInterval(() => {
  const newPoint = {
    time: lastPoint.time + 60,
    value: generateNewValue()
  };
  
  chartData.push(newPoint);
  if (chartData.length > 120) {
    chartData.shift(); // Keep fixed window
  }
  
  areaSeries.update(newPoint);
  
  // Auto-scroll to keep latest data visible
  chart.timeScale().scrollToPosition(3, false);
}, 1000);
```

#### Pattern 4: Hover Micro-interactions
```css
.button {
  transition: all 150ms ease-out;
  border: 2px solid #ccc;
}

.button:hover {
  border-width: 3px;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.button:active {
  transform: translateY(0);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
```

#### Pattern 5: Skeleton Loading States
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    #f0f0f0 25%,
    #e0e0e0 50%,
    #f0f0f0 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

#### Pattern 6: Staggered List Animations
```css
.list-item {
  opacity: 0;
  transform: translateY(20px);
  animation: fadeInUp 0.3s ease-out forwards;
}

.list-item:nth-child(1) { animation-delay: 0ms; }
.list-item:nth-child(2) { animation-delay: 50ms; }
.list-item:nth-child(3) { animation-delay: 100ms; }

@keyframes fadeInUp {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 4. Validate with artifacts

A high-fidelity claim should usually include:

- side-by-side screenshots for key states
- one recording/GIF for the critical interaction
- frame checkpoints for animation-heavy transitions
- notes on remaining deltas, if any

**Validation Workflow:**
```bash
# 1. Record both original and clone
npx @playwright/cli@latest open <original-url>
npx @playwright/cli@latest video-start original.webm
# ... wait 10s ...
npx @playwright/cli@latest video-stop

npx @playwright/cli@latest goto http://localhost:5173
npx @playwright/cli@latest video-start clone.webm
# ... wait 10s ...
npx @playwright/cli@latest video-stop

# 2. Extract comparison frames
ffmpeg -i original.webm -vf “select=eq(n\,50)” -frames:v 1 original-mid.jpg
ffmpeg -i clone.webm -vf “select=eq(n\,50)” -frames:v 1 clone-mid.jpg

# 3. Visual diff (use Read tool to compare)
```

If exact parity is not achieved, describe the remaining gap precisely:
- spacing delta (e.g., “padding 16px vs 20px”)
- timing delta (e.g., “300ms vs 400ms transition”)
- easing mismatch (e.g., “linear vs ease-out”)
- data/interaction mismatch (e.g., “missing hover tooltip”)
- mobile-only difference

## Output Contract

Every replication task must deliver these three artifacts:

### 1. Replication Spec (Required)
A structured breakdown of the target surface across 4 layers:
- **Static surface**: layout, spacing, radius, shadows, borders, typography, colors
- **State machine**: idle, hover, active, loading, error, empty, expanded, collapsed
- **Motion timeline**: duration, easing, delay, transform, opacity, stagger
- **Data coupling**: what triggers each visual transition

Example format:
```text
Element: tooltip
Trigger: hover datapoint
Enter: 140ms, ease-out, opacity 0→1, translateY 6px→0
Exit: 100ms, ease-in, opacity 1→0
```

### 2. Delta List (Required)
Precise measurements of any remaining gaps:
- Spacing deltas (e.g., "padding 16px vs 20px")
- Timing deltas (e.g., "300ms vs 400ms transition")
- Easing mismatches (e.g., "linear vs ease-out")
- Missing interactions (e.g., "no hover tooltip")
- Mobile-only differences

If perfect parity is achieved, state: "Zero deltas - pixel-perfect match confirmed."

### 3. Acceptance Pack (Required)
Visual proof of fidelity:
- Side-by-side screenshots (idle + hover states minimum)
- Comparison video (original vs clone, same interactions, 10-15s)
- Frame checkpoints (key animation moments extracted)
- Validation commands used (for reproducibility)

### Optional Deliverables
- Execution plan (implementation steps)
- Performance report (Lighthouse scores)
- Accessibility audit (A11y compliance)
- Component documentation (usage examples)
- **DESIGN.md** (design system documentation for future development)
  - Generate when: replicating into new project, or user requests documentation
  - Include: visual theme, color palette, typography, component patterns, layout principles
  - Use natural descriptive language (see DESIGN.md Integration section above)

## Execution Order

When using this skill, follow this sequence:

1. **Target summary** — what surface is being replicated
2. **Replication spec** — static/state/motion/data layers (required)
3. **Implementation** — build the replication
4. **Delta list** — precise gap measurements (required)
5. **Acceptance pack** — screenshots, videos, frame checks (required)

## Practical Rules

- Separate “visual match” from “behavior match.” Both matter.
- For charts, capture hover, range switch, loading, and empty/error behavior.
- For overlays/sheets, validate open and close motion separately.
- For micro-interactions, timing/easing usually matter more than raw pixel detail.
- Do not call something “high fidelity” if you only matched the idle frame.
- **Always record video for animation-heavy UIs** — screenshots lie about motion.
- **Extract and analyze video frames** — the only way to catch subtle timing/easing issues.
- **Use requestAnimationFrame for smooth animations** — not setInterval for visual updates.
- **Implement in passes** — static → state → motion → responsive → polish.

## Common Pitfalls and Solutions

### Pitfall 1: “It looks the same in screenshots but feels different”
**Solution**: Record video and extract frames. The issue is usually:
- Wrong easing curve (linear vs ease-out)
- Wrong duration (200ms vs 400ms)
- Missing intermediate states (flash effects, color transitions)

### Pitfall 2: “Numbers jump instead of scrolling”
**Solution**: Use requestAnimationFrame with interpolation:
```javascript
// ❌ Wrong: instant update
element.textContent = newValue;

// ✅ Right: smooth interpolation
animator.update(newValue); // Uses RAF internally
```

### Pitfall 3: “Chart updates are choppy”
**Solution**: 
- Use Canvas-based libraries (Lightweight Charts, Chart.js) not SVG
- Batch updates: don't redraw on every data point
- Use `scrollToPosition()` instead of `setVisibleRange()` for smooth scrolling

### Pitfall 4: “Colors don't match exactly”
**Solution**: Extract computed styles from the original:
```bash
npx @playwright/cli@latest eval “getComputedStyle(document.querySelector('.element')).backgroundColor”
```

### Pitfall 5: “Hover effects are too slow/fast”
**Solution**: Measure the original timing:
1. Record video at 60fps
2. Count frames from hover start to animation end
3. Calculate: duration = frame_count / 60 * 1000 (ms)

## Technology Stack Recommendations

Based on real-world replication experience:

### For Charts/Data Visualization
- **Lightweight Charts** (TradingView): Best for candlestick, line, area charts
- **Recharts**: Good for React apps, declarative API
- **D3.js + visx**: Maximum control, steeper learning curve
- **Chart.js**: Simple, good for basic charts

### For Animations
- **CSS Transitions**: Simple hover/active states (< 300ms)
- **CSS Animations**: Keyframe-based, repeating animations
- **requestAnimationFrame**: Smooth number interpolation, physics-based motion
- **Framer Motion**: React animations with spring physics
- **GSAP**: Complex timeline-based animations

### For Real-time Updates
- **WebSocket**: True real-time (< 100ms latency)
- **Server-Sent Events (SSE)**: One-way server → client
- **Polling (setInterval)**: Fallback, 1-5 second intervals

## Training Roadmap

Master this skill through progressive difficulty levels:

### Level 1: Static Component Replication (Beginner)
**Goal**: Replicate a complex card component (e.g., Airbnb listing card or Dribbble showcase)

**Requirements**:
- Perfectly matching border-radius, shadow layers
- Hover: image slight zoom, text color change
- Responsive: single column on mobile, multi-column on desktop

**Time**: 2-4 hours

**Success criteria**:
- PerfectPixel overlay shows < 2px deviation
- All spacing within 1px tolerance
- Hover timing matches original (±20ms)

### Level 2: Marketing Landing Page (Intermediate)
**Goal**: Replicate Apple product page (e.g., iPhone 15 Pro) or Stripe homepage

**Requirements**:
- Complex scroll parallax effects
- Text fade-in animations (Scroll Reveal)
- Sticky navigation bar with color change on scroll
- Perfect mobile adaptation

**Time**: 1-2 days

**Success criteria**:
- All animations feel identical to original
- Lighthouse performance score > 90
- Responsive breakpoints match exactly

### Level 3: Interactive Application (Expert)
**Goal**: Replicate functional interface (e.g., Spotify Web Player, Notion editor, trading terminal)

**Requirements**:
- **Real logic**: progress bar dragging, sidebar collapse, data filtering
- **Micro-interactions**: button ripple, list sort animations, toast notifications
- **Data flow**: Mock data simulating API delays and error handling

**Time**: 3-5 days

**Success criteria**:
- All interactive states work correctly
- State management follows best practices
- Code is production-ready (componentized, typed, tested)

### Level 4: Real-time Dashboard (Master)
**Goal**: Replicate live data dashboard (e.g., Grafana, Datadog, trading platform)

**Requirements**:
- Real-time data streaming (WebSocket or polling)
- Multiple synchronized charts
- Complex state management (filters, time ranges, alerts)
- Performance optimization for continuous updates

**Time**: 1 week

**Success criteria**:
- Handles 100+ data points/second without lag
- Memory usage stays stable over 1 hour
- All animations remain smooth during data updates

## Core Principles for Beginners

### 1. Don't Code Blindly
**Spend 30% time observing, 70% coding.** Sharpening the axe doesn't delay chopping wood.

- Record video first, watch it 3-5 times
- Extract key frames, analyze frame-by-frame
- Identify all states before writing code

### 2. Focus on "Feel" Not Just "Numbers"
Sometimes the original animation is 0.35s, not 0.3s — this tiny difference determines "like" vs "identical."

- Trust your eyes and muscle memory
- Test on real devices, not just DevTools
- Compare side-by-side videos, not just screenshots

### 3. Use Developer Tools Wisely
When stuck, F12 the original site (if not obfuscated) and learn from their CSS.

```bash
# Extract computed styles
npx @playwright/cli@latest eval "getComputedStyle(document.querySelector('.button')).transition"

# Get exact colors
npx @playwright/cli@latest eval "getComputedStyle(document.querySelector('.card')).backgroundColor"
```

### 4. Refactoring Mindset
Don't write "spaghetti code." Even for practice, follow engineering standards.

- Extract reusable components
- Use design tokens (CSS variables)
- Write semantic HTML
- Keep functions small and focused

### 5. Learn from the Best
Study how top companies implement their UIs:

- **Apple**: Masterclass in subtle animations and typography
- **Stripe**: Perfect balance of simplicity and sophistication
- **Linear**: Snappy interactions and keyboard shortcuts
- **Vercel**: Clean design system and performance optimization

## Advanced Techniques

### Technique 1: Reverse Engineering Easing Curves
```javascript
// Capture original timing by counting frames
// If animation takes 9 frames at 60fps: 9/60 = 0.15s

// Match the curve by testing different cubic-bezier values
transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1); // ease-out
transition: all 0.15s cubic-bezier(0.4, 0, 1, 1);   // ease-in-out
transition: all 0.15s cubic-bezier(0, 0, 0.2, 1);   // custom
```

### Technique 2: Extracting Design Tokens from Screenshots
```javascript
// Use Playwright to extract all CSS variables
npx @playwright/cli@latest eval `
  const styles = getComputedStyle(document.documentElement);
  const tokens = {};
  for (let i = 0; i < styles.length; i++) {
    const prop = styles[i];
    if (prop.startsWith('--')) {
      tokens[prop] = styles.getPropertyValue(prop);
    }
  }
  JSON.stringify(tokens, null, 2);
`
```

### Technique 3: Performance Profiling
```javascript
// Measure animation performance
const start = performance.now();
element.addEventListener('transitionend', () => {
  console.log(`Animation took ${performance.now() - start}ms`);
});
```

### Technique 4: Accessibility Compliance
```html
<!-- Don't just copy visuals — ensure A11y -->
<button 
  aria-label="Close modal"
  aria-pressed="false"
  role="button"
  tabindex="0"
>
  <svg aria-hidden="true">...</svg>
</button>
```

## Extra References

Read these only when needed:
- `references/replication-spec-template.md` — reusable spec template
- `references/acceptance-checklist.md` — artifact checklist for signoff
- `examples/chart-motion.md` — example for chart/tooltip/range-switch work
- `examples/polymarket-btc-replication.md` — real-world case study with video analysis
