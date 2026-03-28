---
title: Closur MVP
type: feat
status: in-progress
created: 2026-03-27
---

# Closur MVP

## Problem
Smart people avoid hard conversations — sales, VC pitches, firing, confrontation, negotiation. No affordable tool exists that lets individuals practice these conversations with realistic AI and get real-time coaching on HOW they sound, not just what they say.

## Solution
Modular conversation engine on Cloudflare + ElevenLabs. Scenario-driven practice arena with voice AI roleplay, real-time acoustic + sentiment feedback, 3D visualization, and session export.

## Acceptance Criteria

### Day 1: Scaffold + Onboarding
- [x] Hono Worker project scaffolded with wrangler.toml (Workers AI, KV, DO bindings)
- [x] React + Vite + Tailwind frontend shell deployed to CF Pages
- [x] Browser Rendering /markdown endpoint working (paste URL → get markdown)
- [x] Workers AI summarizes product markdown into structured profile
- [x] Product profile stored in KV
- [x] Scenario configs (JSON) stored in KV (sales pitch, VC pitch, firing, conflict, negotiation)
- [x] Basic UI: onboarding flow + scenario picker

### Day 2: Practice Arena Core
- [x] CoachAgent Durable Object with SQLite session storage
- [x] ElevenLabs Conversational AI integration (WebSocket from browser)
- [ ] Workers AI configured as LLM backend for ElevenLabs agent (needs ElevenLabs agent setup)
- [x] Scenario config injects persona/context into ElevenLabs agent system prompt
- [ ] End-to-end voice loop working: speak → AI responds → speak (needs API key)
- [x] user_transcript events captured and stored in DO

### Day 3: Feedback + Emotions
- [x] Web Audio API module: mic stream fork → AnalyserNode → pitch, energy, pace, pauses
- [x] Acoustic data sent to CoachAgent DO via WebSocket
- [x] Workers AI sentiment analysis on user_transcript chunks
- [x] Nudge engine: aggregates acoustic + sentiment + scenario rubric → generates coaching tips
- [x] On-screen guidance overlay (floating cards, color-coded by urgency)
- [x] Post-session scorecard generation (Workers AI summarization)

### Day 4: 3D Viz + Polish
- [x] Three.js terrain visualization ported from session-dashboard
- [x] Viz Mode A: multi-dimensional (sentiment + pace + energy over time)
- [x] Viz Mode B: topic clusters on Z-axis
- [x] Live data feed during practice session
- [ ] Historic replay for past sessions (terrain component supports it, needs wiring in review view)
- [x] Session history sidebar
- [x] Session export: markdown copy, "Open in Claude", "Open in ChatGPT"
- [x] Landing page with hero tagline

### Day 5: Video + Social
- [ ] Demo video recorded (60-75s)
- [ ] Captions + background music added
- [ ] Posted to X, LinkedIn, Instagram, TikTok
- [ ] Submission form completed

## Technical Approach

### Stack
- **Worker:** Hono + Cloudflare Agents SDK (TypeScript)
- **Frontend:** React + Vite + Tailwind (CF Pages)
- **AI:** Workers AI (Llama/Gemma) + ElevenLabs Conversational AI
- **Storage:** DO SQLite (sessions) + KV (product profiles, scenario configs)
- **Viz:** Three.js (ported from ~/Documents/GitHub/session-dashboard)
- **Scraping:** CF Browser Rendering /markdown endpoint

### Key Modules
1. **Scenarios** — JSON configs in KV, easy to add new conversation types
2. **Voice** — ElevenLabs Conversational AI WebSocket (STT→LLM→TTS)
3. **Emotions** — Browser Web Audio API (pitch, energy, pace)
4. **Sentiment** — Workers AI on user_transcript events
5. **Feedback** — Nudge engine in CoachAgent DO
6. **Viz** — Three.js terrain, two rendering modes
7. **Export** — Markdown + "Open in Claude/ChatGPT"

### Architecture
- CoachAgent DO per user — owns session state, WebSocket to browser, nudge logic
- Hono Worker — REST routes for onboarding, scenarios, session history
- Browser — manages ElevenLabs WebSocket + Web Audio API + Three.js rendering
- All storage on Cloudflare (DO SQLite + KV)

## References
- docs/plans/2026-03-26-sales-coach-design.md
- docs/brand-guidelines.md
- docs/competitive-landscape.md
- ~/Documents/GitHub/session-dashboard/session-dashboard.html (UI source)
