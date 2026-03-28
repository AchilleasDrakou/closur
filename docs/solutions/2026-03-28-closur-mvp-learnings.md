# Closur MVP — Learnings

## ElevenLabs Integration

- **No real-time emotion detection** — ElevenLabs Conversational AI returns plain text transcripts only. Scribe v2 Realtime also text-only (audio event tags are non-realtime Scribe only). Had to build emotion layer ourselves.
- **Client-side Web Audio API is the emotion source** — AnalyserNode for pitch/energy/pace is free, zero API cost, and feeds the 3D viz directly. Combined with Workers AI text sentiment = good enough.
- **`@elevenlabs/react` useConversation hook** — clean API. `startSession({ agentId })` or `startSession({ signedUrl })`. Callbacks: onMessage, onConnect, onDisconnect, onModeChange.
- **Signed URL flow** — server generates it to keep API key server-side. Fallback to agentId if signed URL fails.

## Cloudflare Architecture

- **Agents SDK AIChatAgent** — good base class but we mostly use it for WebSocket + SQLite. The chat message handler isn't used (voice goes through ElevenLabs directly).
- **@callable decorator** — clean RPC from browser to DO. Used for sendAcousticData, analyzeTranscript, setScenario.
- **DO SQLite** — perfect for session data. No need for D1 or external DB. Each user's DO is their entire backend.
- **KV** — good for scenario configs and product profiles. Simple JSON blobs.
- **Hono + routeAgentRequest coexist** — Hono handles /api/* routes, routeAgentRequest handles /agents/* WebSocket upgrades.

## Performance Gotchas

- **Acoustic data state updates** — must throttle React state updates from Web Audio. ~10fps raw → 2fps for viz is the sweet spot. Use refs for the raw buffer, state for the display.
- **Three.js in React** — dispose everything on rebuild. Geometries, materials, textures. Live mode rebuilds terrain on every data update = lots of GPU allocations.
- **Math.max(...largeArray)** — use reduce instead. Spread hits call stack limit.
- **Stale closures in useCallback** — when endSession captures transcript/acousticData from closure, it gets stale data. Use refs for values that change rapidly.

## SSRF

- Always validate user-supplied URLs. Block private IPs, localhost, metadata endpoints.
- CF Browser Rendering will fetch anything you tell it to.
