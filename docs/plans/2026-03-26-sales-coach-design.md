# Closur — Design Doc

> AI coach for every hard conversation.
> Practice pitches, confrontations, negotiations. Get live coaching. Export structured notes.

**Domain:** closur.ai
**Hackathon:** ElevenHacks (Cloudflare x ElevenLabs)
**Deadline:** ~April 1, 2026
**Stack:** Cloudflare Workers/Pages + ElevenLabs APIs
**UI Base:** Forked from session-dashboard (dark theme, 3D viz, panel layout)

---

## Product Vision

Smart people avoid hard conversations — sales calls, VC pitches, firing someone, confrontation, negotiation. Closur is an AI coach that lets you practice any hard conversation with a realistic AI counterpart and coaches you live when it counts.

Not a sales tool. A courage tool.

**Hook (5 seconds):** *"I avoid hard conversations. So I built an AI that lets me practice them first."*
**Tagline:** *"The life you want is on the other side of a few hard conversations."*

---

## Core Features (v1 — 5 days)

### Modular Conversation Engine

The engine is scenario-driven. Adding a new conversation type = adding a config, not code:

```
Scenario = {
  id:          "vc-pitch"
  name:        "VC Pitch"
  persona:     "skeptical Series A investor"
  context:     "{{product_markdown}}"  // injected from scrape
  objectives:  ["handle valuation pushback", "articulate moat"]
  tone:        "professional, probing, slightly impatient"
  voice:       "eleven_labs_voice_id"
  scoring:     ["clarity", "confidence", "objection_handling", "pace"]
}
```

Built-in scenarios: sales pitch, VC pitch, firing someone, giving tough feedback, negotiation, conflict resolution. Users can create custom scenarios.

### Module Breakdown

| Module | Responsibility | Tech |
|---|---|---|
| **Scenarios** | Scenario configs (persona, objectives, scoring) | JSON in KV |
| **Voice** | Full conversation loop: STT→LLM→TTS | ElevenLabs Conversational AI (Workers AI as LLM backend) |
| **Emotions** | Acoustic features: pitch, energy, pace, pauses | Browser Web Audio API (AnalyserNode) — client-side, free |
| **Sentiment** | Transcript analysis: confidence, hedging, filler words | Workers AI (Llama/Gemma) on user_transcript events |
| **Feedback** | Real-time on-screen nudges + post-session scorecard | DO state → WebSocket → React overlay |
| **Viz** | 3D terrain from tone/energy data — live + historic replay | Three.js (ported from session-dashboard) |
| **Export** | Markdown summary + "Open in Claude/ChatGPT" | Workers AI summarization |

### Feature 1: Context & Onboarding
- User pastes product URL (or describes their situation for non-sales scenarios)
- CF Browser Rendering `/markdown` converts site to markdown
- Workers AI summarizes into structured profile
- Generative UI: asks clarifying questions ("Who's your buyer?", "What's the hard part?")
- Final context (~1-2k tokens) stored in KV, injected into every scenario prompt

### Feature 2: Practice Arena (core loop)
- User picks a scenario (or creates custom)
- CoachAgent DO loads scenario config + product context from KV
- Configures ElevenLabs Conversational AI agent with scenario persona/voice/knowledge
- Voice module: browser mic ↔ ElevenLabs WebSocket (full STT→LLM→TTS loop)
- Emotions module: mic stream fork → Web Audio API extracts pitch/energy/pace in browser
- Sentiment module: each `user_transcript` event → Workers AI for confidence/hedging analysis
- Feedback module: DO aggregates acoustic + sentiment data, evaluates against scenario scoring rubric, pushes nudges to UI via WebSocket
- Viz module: receives live data stream, renders 3D terrain in real-time
- Post-session scorecard with transcript annotations, metrics, improvement suggestions

### Feature 3: Session Export
- Every session generates structured markdown:
  - Key moments / highlights
  - Action items
  - Coaching notes + score/metrics
- Export options:
  - Copy as markdown
  - "Open in Claude" — pre-formatted prompt with full context
  - "Open in ChatGPT" — same

### Nice-to-Have (later)
- **Live Coach on real calls** — two-stream audio capture (getUserMedia + getDisplayMedia), real-time nudges during actual calls. Moved to post-MVP due to UX complexity.
- Notion integration for session export
- Chrome extension for smoother live call audio capture

### Emotion Architecture (important — verified against ElevenLabs SDK)

ElevenLabs Conversational AI does NOT return emotion/sentiment data on user input. Scribe v2 Realtime does NOT return audio event tags (non-realtime only). No ElevenLabs API exists for voice emotion analysis.

**Our approach — two complementary sources:**

1. **Client-side acoustic features (Web Audio API):**
   - Fork mic stream → AnalyserNode
   - Extract: pitch (autocorrelation), energy/volume (RMS), speaking rate, pause duration
   - Send to CoachAgent DO via WebSocket
   - Feeds the 3D visualization directly
   - Zero API cost

2. **Server-side transcript sentiment (Workers AI):**
   - Each `user_transcript` from Conversational AI → Workers AI prompt
   - Analyze: confidence level, hedging language, filler words, assertiveness
   - Feeds the nudge engine
   - Stays on Cloudflare

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CF Pages (React + Vite)                │
│                                                           │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ Session   │  │ Practice      │  │ Feedback Overlay  │  │
│  │ History   │  │ Arena         │  │ (live nudges)     │  │
│  │ Sidebar   │  │               │  │                   │  │
│  └──────────┘  └───────────────┘  └──────────────────┘  │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 3D Tone/Energy Visualization (Three.js)           │    │
│  │ Mode A: sentiment + pace + energy (multi-dim)     │    │
│  │ Mode B: topic clusters on Z-axis                  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  CLIENT-SIDE MODULES:                                     │
│  ┌──────────────────┐  ┌────────────────────────────┐   │
│  │ Web Audio API     │  │ ElevenLabs Conversational   │   │
│  │ (AnalyserNode)    │  │ AI WebSocket                │   │
│  │ - Pitch           │  │ (browser mic ↔ AI voice)    │   │
│  │ - Energy/volume   │  │                              │   │
│  │ - Speaking rate    │  │ Returns: user_transcript,    │   │
│  │ - Pause duration  │  │ agent_response, agent audio  │   │
│  └────────┬─────────┘  └──────────┬─────────────────┘   │
│           │                        │                      │
└───────────┼────────────────────────┼──────────────────────┘
            │ acoustic features      │ user_transcript
            │ via WebSocket          │ via WebSocket
            ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│              CF Workers (Hono + Agents SDK)               │
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │ CoachAgent (Durable Object, per-user)              │   │
│  │                                                     │   │
│  │ LIVE STATE:              PERSISTED (SQLite):        │   │
│  │ - Transcript             - Full transcripts         │   │
│  │ - Acoustic data stream   - Scorecards               │   │
│  │ - Sentiment scores       - Session metadata         │   │
│  │ - Nudge history          - Scenario configs         │   │
│  │ - Scenario config                                   │   │
│  │ - Product context                                   │   │
│  │                                                     │   │
│  │ LOGIC:                                              │   │
│  │ - Aggregate acoustic + sentiment data               │   │
│  │ - Evaluate against scenario scoring rubric          │   │
│  │ - Generate nudges → push to UI via WebSocket        │   │
│  │ - Generate viz data → push to Three.js              │   │
│  └──────────────────────┬──────────────────────────┘   │
│                          │                               │
│  ┌───────────────────────▼──────────────────────────┐   │
│  │ Workers AI                                        │   │
│  │ - Summarization (Llama/Gemma)                     │   │
│  │ - Sentiment analysis on user_transcript           │   │
│  │ - Product scrape summarization                    │   │
│  │ - Post-session scorecard generation               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                           │
│  ┌──────────────┐  ┌───────────────────────────────┐    │
│  │ Hono Router   │  │ Browser Rendering              │    │
│  │ - REST API    │  │ - /markdown endpoint           │    │
│  │ - Scenarios   │  │ - Product URL → markdown       │    │
│  │ - Sessions    │  └───────────────────────────────┘    │
│  │ - Export      │                                        │
│  └──────────────┘  ┌───────────────────────────────┐    │
│                     │ KV                              │    │
│                     │ - Product profiles (JSON)       │    │
│                     │ - Scenario configs              │    │
│                     └───────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Storage Architecture (keep it simple)

No D1. No Vectorize. No embeddings. Two stores:

| Data | Store | Why |
|---|---|---|
| **Everything per-user** (sessions, transcripts, scorecards, preferences) | **DO SQLite** | Already built into each DO. Persists across hibernation. Each user's CoachAgent DO is their entire backend. |
| **Product profiles** (scraped site data, ICP, value props) | **KV** | JSON blob keyed by URL hash. Fast reads. No schema needed. |

Product knowledge is ~1-2k tokens of summarized markdown. Small enough to stuff directly into every prompt (ElevenLabs Conversational AI system prompt, Workers AI analysis calls). No RAG pipeline needed.

The DO *is* the database. Session history = `SELECT * FROM sessions ORDER BY created_at DESC`. Export = read from SQLite, format as markdown.

---

## CF Primitives Used

| Primitive | Purpose | Judges Care? |
|---|---|---|
| **Workers** | Compute, API orchestration | Table stakes |
| **Durable Objects** | Stateful agents (CoachAgent, ProductAgent) | YES — deep integration |
| **Workers AI** | Summarization, sentiment analysis on transcripts, product scrape | YES — on-platform AI |
| **Browser Rendering** | Product URL → markdown scraping | YES — creative use |
| **KV** | Product profiles (JSON blobs) | Lightweight, practical |
| **Pages** | Frontend hosting | Table stakes |
| **AI Gateway** | Route ElevenLabs calls for caching/logging | Bonus points |

## ElevenLabs APIs Used

| API | Purpose | Judges Care? |
|---|---|---|
| **Conversational AI** | Practice Arena — full voice roleplay (STT→LLM→TTS in one WebSocket). Uses CF Workers AI as LLM backend. Returns user_transcript for sentiment analysis. | YES — primary integration, bridges both platforms |
| **Text-to-Speech (v3)** | Emotionally expressive scenario voices via audio tags (`[skeptical]`, `[excited]`, `[frustrated]`) | YES — advanced feature use |
| **Voice Design** | Generate unique persona voices per scenario | Wow factor |

Note: Emotion detection is NOT available from ElevenLabs APIs. We use client-side Web Audio API (pitch, energy, pace) + Workers AI transcript sentiment instead.

---

## UI Design

### Base: session-dashboard fork
- Dark theme: `#0a0a0f` bg, `#b4e62e` green accent
- Fonts: Fira Code (mono) + Space Grotesk (sans)
- Corner bracket panel decorations
- Resizable panel layout

### Layout Mapping

```
┌──────────────────────────────────────────────────────┐
│  CLOSUR  │  Scenario: VC Pitch  │  Sessions: 12     │
├──────────┬───────────────────────────────────────────┤
│          │                                            │
│ SESSION  │  MAIN VIEW (switches between):             │
│ HISTORY  │                                            │
│          │  [Onboarding] — paste URL, setup context    │
│ • Sesh 1 │  [Scenario Pick] — choose conversation type│
│ • Sesh 2 │  [Practice Arena] — voice roleplay + nudges│
│ • Sesh 3 │  [Session Review] — scorecard + export     │
│          │                                            │
│          ├───────────────────────────────────────────┤
│          │  3D VISUALIZATION (live + historic)        │
│          │  Mode A: sentiment + pace + energy          │
│          │  Mode B: topic clusters on Z-axis           │
└──────────┴───────────────────────────────────────────┘
```

### Key Visual Components

1. **Session sidebar** — reuse session-card pattern (title, time, metrics badge, expandable details)
2. **3D terrain** — repurpose for tone/energy visualization:
   - X axis: time through the call
   - Z axis: topic clusters
   - Y axis: energy/confidence level
   - Contour lines show emotional flow
   - Peak markers flag key moments (objections, closes, wins)
3. **Activity grid** — practice frequency heatmap (GitHub-style)
4. **Live nudges** — floating overlay cards with coaching tips, color-coded by urgency
5. **Scorecard** — post-session metrics with radar chart or dot-grid badges

---

## Data Flow

### Product Scrape Flow
```
User pastes URL
  → CF Browser Rendering /markdown (get page content)
  → Workers AI: summarize into structured profile
    (value props, features, pricing, ICP, common objections)
  → Generative UI: show user the profile, ask clarifying questions
    ("Is this your pricing? Who's your ideal buyer?")
  → User confirms/edits → final product context (~1-2k tokens markdown)
  → Store in KV as JSON blob (keyed by URL hash)
  → This context gets stuffed into every prompt from here on
```

### Practice Arena Flow
```
User picks scenario + clicks "Start Practice"
  → CoachAgent (DO) creates session
  → Loads scenario config from KV (persona, objectives, scoring rubric)
  → Loads product context from KV (if applicable)
  → Configures ElevenLabs Conversational AI agent:
      - System prompt: scenario persona + product context
      - LLM: CF Workers AI as backend
      - Voice: scenario-specific voice (via Voice Design or preset)
      - Audio tags for emotional expressiveness
  → Browser:
      - getUserMedia() → mic stream
      - Stream fork 1 → ElevenLabs Conversational AI WebSocket
      - Stream fork 2 → Web Audio API AnalyserNode (pitch, energy, pace)
  → During session:
      - ElevenLabs returns user_transcript events → sent to CoachAgent DO
      - Web Audio features (pitch, energy, pace) → sent to CoachAgent DO
      - CoachAgent: Workers AI analyzes transcript sentiment/confidence
      - CoachAgent: aggregates acoustic + sentiment + scenario rubric
      - CoachAgent: pushes nudges to UI via WebSocket
      - CoachAgent: pushes viz data to Three.js via WebSocket
  → On session end:
      - Workers AI summarizes transcript + generates scorecard
      - Store in DO SQLite
      - Return review to UI
```

---

## 5-Day Build Plan (rough)

| Day | Focus | Deliverable |
|---|---|---|
| **1** | Scaffold + Onboarding | Hono Worker, Agents SDK setup, Browser Rendering product scrape, scenario configs in KV, basic React shell |
| **2** | Practice Arena core | ElevenLabs Conversational AI integration, CoachAgent DO, voice loop working end-to-end |
| **3** | Feedback + Emotions | Web Audio API acoustic features, Workers AI transcript sentiment, nudge engine, on-screen guidance overlay |
| **4** | 3D Viz + Polish | Port Three.js terrain (both modes), session history sidebar, scorecard, export, landing page |
| **5** | Video + Social | Record demo video, edit in CapCut, post to X/LinkedIn/IG/TikTok |

---

## Scoring Strategy

| Points | Source | Plan |
|---|---|---|
| +200 | Social posts (4 platforms x 50) | Post on X, LinkedIn, Instagram, TikTok |
| +400 | 1st place | Deep CF + ElevenLabs integration |
| +200 | Most Viral | "Dev who sucks at sales" angle is relatable |
| +200 | Most Popular | Shareable demo, real utility |

### Video Strategy
- **Hook:** "I avoid hard conversations. So I built an AI that lets me practice them first."
- **Demo:** Film a real practice session with the AI prospect pushing back
- **Wow moment:** Show the 3D tone visualization reacting in real-time
- **Payoff:** Show the scorecard + "export to Claude" flow
- **Length:** 60-75 seconds
- **Film on location** — coffee shop or real meeting room, not just screen recording

---

## Resolved Questions

1. **Workers AI as ElevenLabs LLM backend** — YES. Use CF Workers AI as the LLM for ElevenLabs Conversational AI agents. Bridges both platforms, more integration points for judges. Docs: [CF Workers AI as custom LLM](https://elevenlabs.io/docs/agents-platform/customization/llm/custom-llm/cloudflare)

2. **Emotion/sentiment** — ElevenLabs has NO real-time emotion detection API (verified against SDK source). Scribe v2 Realtime returns text only, no audio event tags (that's non-realtime only). Solution: client-side Web Audio API for acoustic features (pitch, energy, pace) + Workers AI prompt-based sentiment on transcript text. Two complementary sources, zero extra API cost.

3. **Audio routing** — Practice arena uses single mic stream forked to ElevenLabs Conversational AI + Web Audio API. Live coaching on real calls moved to nice-to-have.

4. **Name** — **Closur** (closur.ai). "Closure" = closing deals + getting closure on hard conversations + JavaScript closures (dev recognition). Registered on Cloudflare Registrar.

5. **3D viz** — Must-have. Non-negotiable for the demo. Allocate Day 4 fully to porting Three.js terrain from session-dashboard.

## Open Questions

1. ~~**Name**~~ — RESOLVED: **Closur** (closur.ai)
2. **Practice Arena voice selection** — should users pick from preset prospect personas (skeptical CTO, budget-conscious CFO, etc.) or just auto-generate from ICP?
3. **AI Gateway** — worth routing ElevenLabs calls through CF AI Gateway for extra integration points? Adds caching + logging + rate limiting.
