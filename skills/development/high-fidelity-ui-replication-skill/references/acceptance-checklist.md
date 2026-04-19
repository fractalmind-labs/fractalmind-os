# Acceptance Checklist

Use this checklist before calling a replication "high fidelity".

## Evidence
- [ ] desktop screenshot for idle state
- [ ] mobile screenshot if mobile matters
- [ ] recording or GIF for the key interaction
- [ ] frame checkpoints for animation-heavy surfaces
- [ ] explicit list of any remaining deltas

## Static Match
- [ ] layout hierarchy matches
- [ ] spacing/radius/shadows are in family, not just approximate color blocks
- [ ] typography scale/weight/line-height feel aligned

## Behavioral Match
- [ ] hover/press/expand states exist and feel right
- [ ] loading/empty/error states are checked
- [ ] transitions are triggered by the correct event/data boundary

## Motion Match
- [ ] duration is close enough
- [ ] easing feels aligned
- [ ] directional movement matches
- [ ] stagger/sequence matches where applicable
- [ ] no visible flicker/reflow during transition
