# Example: Chart Motion Replication

Use this pattern for market charts, dashboards, or any animation-heavy data view.

## Capture set
- idle chart screenshot
- hover tooltip screenshot
- range-switch recording
- mobile chart screenshot
- loading/error state screenshot if they exist

## Spec focus
- chart container spacing and hierarchy
- line/candle style and grid visibility
- hover guideline / tooltip entry motion
- range capsule active/inactive state
- loading -> ready transition

## Common failure modes
- matching the static chart but missing tooltip motion
- matching desktop only and ignoring mobile truncation
- claiming parity without checking range-switch animation
- validating with screenshots only even though the critical gap is motion
