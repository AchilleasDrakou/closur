---
title: Audio Visualizer Overhaul
type: feat
status: in-progress
created: 2026-03-29
---

# Audio Visualizer Overhaul

## Problem
Current practice view has a flat terrain that doesn't look good with sparse data. Need audio-reactive 3D visuals that respond to voice in real-time, plus annotated audio playback in review.

## Solution
Port the icosahedron anomaly visualizer from the provided codepen reference. Adapt for Closur's color scheme and data model.

## Acceptance Criteria
- [ ] AudioReactiveOrb component: Three.js icosahedron with noise distortion, reacts to mic energy
- [ ] CircularVisualizer: canvas rings that pulse with frequency data around the orb
- [ ] Replace terrain-hero in practice view with the orb + circular visualizer
- [ ] Compact metrics panel showing live confidence/pace/energy during practice
- [ ] WaveformPlayer component for review view: audio playback with annotation markers
- [ ] Annotations clickable to jump to that point in the audio
- [ ] Color scheme: green (#b4e62e) accent instead of red (#ff4e42)
- [ ] Build passes, deploy works

## Technical Approach
- Port Three.js icosahedron + shader from reference JS to React component
- Use existing Web Audio API analyser (already in PracticeArena) to feed frequency data
- CircularVisualizer as a 2D canvas overlay on the orb
- WaveformPlayer: canvas-based waveform with clickable annotation markers from judge.ts
- Smaller terrain moves to review view as historic overview (optional)
