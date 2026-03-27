# Closur — Architecture

## Stack
- **Runtime:** Cloudflare Workers (edge compute)
- **Framework:** Cloudflare Agents SDK (Durable Objects-based stateful agents)
- **Frontend:** React + Vite + Tailwind, deployed to CF Pages
- **AI:** Workers AI (Llama/Gemma for summarization + sentiment), ElevenLabs (Conversational AI, Scribe v2, TTS v3)
- **Storage:** DO SQLite (per-user sessions/transcripts) + KV (product profiles)
- **3D Viz:** Three.js (ported from session-dashboard)

## Architecture Pattern
- `AIChatAgent` (Durable Object) per user — handles session state, real-time analysis, WebSocket to browser
- `ProductAgent` (Durable Object) — handles URL scraping via Browser Rendering, profile extraction
- Frontend uses `useAgentChat` React hook for WebSocket comms
- ElevenLabs Conversational AI uses CF Workers AI as LLM backend
- ElevenLabs Scribe v2 Realtime for live transcription + audio event tags
- Two-stream audio capture in Chrome: getUserMedia (mic) + getDisplayMedia (call tab)

## Deployment
- Single `wrangler.toml` with Workers + Pages + bindings
- All storage on Cloudflare (DO SQLite + KV)
- Domain: closur.ai (Cloudflare Registrar)

## UI Base
- Forked from ~/Documents/GitHub/session-dashboard
- Dark theme, 3D terrain visualization, resizable panel layout
- Heavy refactor needed for coaching UI
