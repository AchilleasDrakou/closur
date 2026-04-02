import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { Hono } from "hono";
import { generateText } from "ai";
import {
  analyzeTranscriptWithAI,
  checkAcousticNudges,
  type ConversationState,
  type AcousticSnapshot,
  type NudgeResult
} from "./lib/nudge-engine";
import { judgeSession, type SessionScore, type JudgeInput } from "./lib/judge";

// ── Scenario type ─────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  description: string;
  persona: string;
  firstMessage: string;
  tone: string;
  objectives: string[];
  scoring: string[];
  voiceId?: string;
}

// ── Default scenarios ─────────────────────────────────────────────────

export const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: "sales-pitch",
    name: "Sales Pitch",
    description: "Practice pitching your product to a skeptical buyer",
    persona:
      "You are a busy VP of Engineering evaluating tools for your team. You're skeptical of new products, ask tough questions about ROI, and push back on pricing. You've seen many demos and are hard to impress. Never break character. Never acknowledge you're an AI.",
    firstMessage:
      "Thanks for getting on the call. I've got about fifteen minutes — what have you got for me?",
    tone: "professional, slightly impatient, probing",
    objectives: [
      "Handle pricing objections",
      "Demonstrate clear value",
      "Ask for next steps"
    ],
    scoring: ["clarity", "confidence", "objection_handling", "pace"]
  },
  {
    id: "vc-pitch",
    name: "VC Pitch",
    description: "Practice your investor pitch with a tough VC partner",
    persona:
      "You are a partner at a top-tier VC firm. You've seen thousands of pitches and can spot weak points instantly. You care about market size, defensibility, and the team. You're direct and will challenge assumptions. Never break character. Never acknowledge you're an AI.",
    firstMessage:
      "Good to meet you. Our mutual friend spoke highly of what you're building. Walk me through it — what's the opportunity here?",
    tone: "direct, analytical, occasionally encouraging",
    objectives: [
      "Articulate the market opportunity",
      "Handle valuation pushback",
      "Show traction"
    ],
    scoring: ["clarity", "confidence", "storytelling", "pace"]
  },
  {
    id: "firing",
    name: "Letting Someone Go",
    description: "Practice having a termination conversation with empathy",
    persona:
      "You are an employee who has been underperforming but doesn't fully realize the severity. You're surprised and emotional when you hear the news. You ask 'why' and try to negotiate staying. Never break character. Never acknowledge you're an AI.",
    firstMessage: "Hey, you wanted to grab some time? What's going on?",
    tone: "confused, emotional, defensive then accepting",
    objectives: [
      "Be direct and clear",
      "Show empathy",
      "Stay firm on the decision",
      "Cover logistics"
    ],
    scoring: ["clarity", "empathy", "firmness", "pace"]
  },
  {
    id: "conflict",
    name: "Conflict Resolution",
    description: "Practice addressing a conflict with a colleague",
    persona:
      "You are a colleague who feels their work isn't being recognized. You've been passive-aggressive in meetings and are defensive when confronted. You need to feel heard before you'll engage constructively. Never break character. Never acknowledge you're an AI.",
    firstMessage: "Oh, you wanted to talk? Sure. What about?",
    tone: "defensive, guarded, gradually opening up",
    objectives: [
      "Address the issue directly",
      "Listen actively",
      "Find common ground",
      "Agree on next steps"
    ],
    scoring: ["empathy", "directness", "active_listening", "pace"]
  },
  {
    id: "negotiation",
    name: "Salary Negotiation",
    description: "Practice negotiating a raise or job offer",
    persona:
      "You are a hiring manager or boss. You like the person but have budget constraints. You'll try to offer less or defer the conversation. You respond well to data and confidence but not to ultimatums. Never break character. Never acknowledge you're an AI.",
    firstMessage:
      "Thanks for setting up time. You mentioned you wanted to discuss something — go ahead.",
    tone: "friendly but firm, budget-conscious",
    objectives: [
      "State your ask clearly",
      "Justify with evidence",
      "Handle pushback",
      "Reach agreement"
    ],
    scoring: ["confidence", "preparation", "flexibility", "pace"]
  }
];

// ── CoachAgent (Durable Object) ───────────────────────────────────────

export class CoachAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 200;
  private static readonly NUDGE_COOLDOWN_MS = 15_000;

  // Conversation state tracked across the session
  private convState: ConversationState = {
    turnCount: 0,
    topicsCovered: [],
    objectivesHit: [],
    lastAnalysis: null,
    recentAcoustic: []
  };

  private activeScenario: Scenario | null = null;
  private lastAcousticNudgeTime = 0;
  private nudgeCooldowns = new Map<string, number>();

  // Set scenario for this session
  @callable()
  async setScenario(scenario: Scenario) {
    this.activeScenario = scenario;
    this.lastAcousticNudgeTime = 0;
    this.nudgeCooldowns.clear();
    this.convState = {
      turnCount: 0,
      topicsCovered: [],
      objectivesHit: [],
      lastAnalysis: null,
      recentAcoustic: []
    };
    this.ctx.storage.sql.exec(`DELETE FROM acoustic_data`);
    this.ctx.storage.sql.exec(`DELETE FROM nudges`);
  }

  // Store acoustic data + check thresholds for nudges
  @callable()
  async sendAcousticData(data: {
    pitch: number;
    energy: number;
    pace: number;
    speechActive: boolean;
    timestamp: number;
  }) {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO acoustic_data (timestamp, pitch, energy, pace) VALUES (?, ?, ?, ?)`,
      data.timestamp,
      data.pitch,
      data.energy,
      data.pace
    );

    // Track recent acoustic data
    const snapshot: AcousticSnapshot = {
      pitch: data.pitch,
      energy: data.energy,
      pace: data.pace,
      speechActive: data.speechActive
    };
    this.convState.recentAcoustic.push(snapshot);
    if (this.convState.recentAcoustic.length > 30) {
      this.convState.recentAcoustic = this.convState.recentAcoustic.slice(-30);
    }

    // Broadcast viz data
    this.broadcast(JSON.stringify({ type: "viz-data", data }));

    // Check acoustic thresholds (throttle to every 5s)
    const now = Date.now();
    if (now - this.lastAcousticNudgeTime > 5000) {
      // Average recent acoustic data for smoother nudges
      const recent = this.convState.recentAcoustic.slice(-10);
      const activeRecent = recent.filter((frame) => frame.speechActive);
      if (activeRecent.length < 3) {
        return;
      }
      const avg: AcousticSnapshot = {
        pitch:
          activeRecent.reduce((s, d) => s + d.pitch, 0) / activeRecent.length,
        energy:
          activeRecent.reduce((s, d) => s + d.energy, 0) / activeRecent.length,
        pace:
          activeRecent.reduce((s, d) => s + d.pace, 0) / activeRecent.length,
        speechActive: true
      };

      const nudges = checkAcousticNudges(avg);
      for (const nudge of nudges) {
        this.emitNudge(nudge);
      }
      if (nudges.length > 0) this.lastAcousticNudgeTime = now;
    }
  }

  // Store and broadcast a nudge
  @callable()
  async sendNudge(nudge: {
    text: string;
    urgency: "info" | "warning" | "positive";
    timestamp: number;
  }) {
    this.ctx.storage.sql.exec(
      `INSERT INTO nudges (timestamp, text, urgency) VALUES (?, ?, ?)`,
      nudge.timestamp,
      nudge.text,
      nudge.urgency
    );
    this.broadcast(JSON.stringify({ type: "nudge", nudge }));
  }

  // Analyze transcript and generate nudges
  @callable()
  async analyzeTranscript(text: string) {
    this.convState.turnCount++;

    if (!this.activeScenario) {
      // No scenario set — do basic analysis only
      return { confidence: 0.5, hedging: 0.5, key_topics: [] };
    }

    const { analysis, nudges } = await analyzeTranscriptWithAI(
      this.env.AI,
      text,
      {
        objectives: this.activeScenario.objectives,
        scoring: this.activeScenario.scoring,
        name: this.activeScenario.name
      },
      this.convState
    );

    // Update conversation state
    this.convState.lastAnalysis = analysis;
    for (const topic of analysis.key_topics) {
      if (!this.convState.topicsCovered.includes(topic)) {
        this.convState.topicsCovered.push(topic);
      }
    }
    for (const nudge of nudges) {
      if (
        nudge.urgency === "positive" &&
        nudge.text.startsWith("Objective hit: ")
      ) {
        const objective = nudge.text.replace("Objective hit: ", "");
        if (!this.convState.objectivesHit.includes(objective)) {
          this.convState.objectivesHit.push(objective);
        }
      }
    }

    // Emit nudges
    for (const nudge of nudges) {
      this.emitNudge(nudge);
    }

    return analysis;
  }

  // Get session summary
  @callable()
  async getSessionSummary() {
    const acousticRows = this.ctx.storage.sql
      .exec(`SELECT * FROM acoustic_data ORDER BY timestamp`)
      .toArray();
    const nudgeRows = this.ctx.storage.sql
      .exec(`SELECT * FROM nudges ORDER BY timestamp`)
      .toArray();

    return {
      acousticData: acousticRows,
      nudges: nudgeRows,
      messageCount: this.messages.length,
      conversationState: this.convState
    };
  }

  // Score session via LLM judge (kimi-k2.5)
  @callable()
  async scoreSession(
    transcript: JudgeInput["transcript"],
    duration: number
  ): Promise<SessionScore> {
    if (!this.activeScenario) {
      return {
        overall: 5,
        criteria: [],
        summary: "No scenario set for scoring.",
        strengths: [],
        improvements: [],
        annotations: []
      };
    }

    // Get acoustic summary
    const acousticRows = this.ctx.storage.sql
      .exec(`SELECT * FROM acoustic_data`)
      .toArray() as Array<{ pitch: number; energy: number; pace: number }>;
    const acousticSummary =
      acousticRows.length > 0
        ? {
            avgEnergy:
              acousticRows.reduce((s, r) => s + r.energy, 0) /
              acousticRows.length,
            avgPace:
              acousticRows.reduce((s, r) => s + r.pace, 0) /
              acousticRows.length,
            avgPitch:
              acousticRows.reduce((s, r) => s + r.pitch, 0) /
              acousticRows.length
          }
        : undefined;

    return judgeSession(this.env.AI, {
      scenario: {
        name: this.activeScenario.name,
        objectives: this.activeScenario.objectives,
        scoring: this.activeScenario.scoring,
        persona: this.activeScenario.persona
      },
      transcript,
      duration,
      acousticSummary
    });
  }

  // Helper: emit a nudge (persist + broadcast)
  private emitNudge(nudge: NudgeResult) {
    const now = Date.now();
    const key = this.getNudgeKey(nudge.text);
    const lastSent = this.nudgeCooldowns.get(key);
    if (lastSent && now - lastSent < CoachAgent.NUDGE_COOLDOWN_MS) {
      return;
    }
    this.nudgeCooldowns.set(key, now);
    this.ctx.storage.sql.exec(
      `INSERT INTO nudges (timestamp, text, urgency) VALUES (?, ?, ?)`,
      now,
      nudge.text,
      nudge.urgency
    );
    this.broadcast(
      JSON.stringify({
        type: "nudge",
        nudge: { ...nudge, timestamp: now }
      })
    );
  }

  private getNudgeKey(text: string) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  onStart() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS acoustic_data (
        timestamp INTEGER PRIMARY KEY,
        pitch REAL,
        energy REAL,
        pace REAL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS nudges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        text TEXT,
        urgency TEXT
      )
    `);
  }

  async onChatMessage() {
    return new Response("OK");
  }
}

// ── Rate limiter ─────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 30; // requests per window
const RATE_WINDOW = 60_000; // 1 minute

function rateLimit(c: {
  req: { header: (name: string) => string | undefined };
  json: (data: unknown, status: number) => Response;
}) {
  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for") ||
    "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.reset) {
    rateLimitMap.set(ip, { count: 1, reset: now + RATE_WINDOW });
    return null;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }
  return null;
}

// ── Hono API routes ───────────────────────────────────────────────────

const api = new Hono<{ Bindings: Env }>();

// Health check
api.get("/api/health", (c) => c.json({ status: "ok", name: "closur" }));

// List scenarios
api.get("/api/scenarios", (c) => {
  return c.json(DEFAULT_SCENARIOS);
});

// Get single scenario
api.get("/api/scenarios/:id", (c) => {
  const scenario = DEFAULT_SCENARIOS.find((s) => s.id === c.req.param("id"));
  if (!scenario) return c.json({ error: "Not found" }, 404);
  return c.json(scenario);
});

// Scrape product URL
api.post("/api/scrape", async (c) => {
  const limited = rateLimit(c);
  if (limited) return limited;
  let body: { url?: string };
  try {
    body = await c.req.json<{ url: string }>();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const { url } = body;
  if (!url) return c.json({ error: "URL required" }, 400);

  // SSRF protection: only allow https, block private/reserved IPs
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:")
      return c.json({ error: "HTTPS URLs only" }, 400);
    const host = parsed.hostname.toLowerCase();
    // Strip brackets from IPv6
    const bare = host.replace(/^\[|\]$/g, "");
    // Block IPv6 loopback, mapped, and link-local
    if (
      bare === "::1" ||
      bare.startsWith("::ffff:") ||
      bare.startsWith("0:") ||
      bare.startsWith("fe80:") ||
      bare.startsWith("fc00:") ||
      bare.startsWith("fd")
    ) {
      return c.json({ error: "Private/reserved hosts not allowed" }, 400);
    }
    // Block private IPv4, link-local, metadata, localhost, octal/decimal tricks
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith(".internal") ||
      host.endsWith(".local") ||
      // Block numeric IPs (decimal/octal bypass)
      /^\d+$/.test(host) ||
      /^0\d/.test(host) ||
      /^0x/i.test(host)
    ) {
      return c.json({ error: "Private/reserved hosts not allowed" }, 400);
    }
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  try {
    // Use CF Browser Rendering to get markdown
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/browser-rendering/markdown`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.env.CF_API_TOKEN}`
        },
        body: JSON.stringify({ url })
      }
    );

    const markdown = await response.text();

    // Summarize with Workers AI
    const ai = createWorkersAI({ binding: c.env.AI });
    const summary = await generateText({
      model: ai("@cf/meta/llama-3.1-8b-instruct"),
      system: `You extract product information from website content. Return JSON with these fields:
- name: product name
- description: one-sentence description
- valueProps: array of 3-5 key value propositions
- pricing: pricing info if found, or "Not found"
- targetAudience: who this product is for
- commonObjections: array of 3-5 likely objections a buyer would raise`,
      prompt: markdown.slice(0, 4000) // limit context
    });

    let profile;
    try {
      profile = JSON.parse(summary.text);
    } catch {
      profile = {
        name: "Unknown",
        description: markdown.slice(0, 200),
        valueProps: [],
        pricing: "Not found",
        targetAudience: "Unknown",
        commonObjections: []
      };
    }

    // Store in KV (SHA-256 hash to avoid collisions)
    const hashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(url)
    );
    const hashHex = [...new Uint8Array(hashBuf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const key = `product:${hashHex}`;
    await c.env.KV.put(key, JSON.stringify(profile));

    return c.json({ profile, key });
  } catch (error) {
    console.error("[scrape] failed:", error);
    return c.json({ error: "Failed to process URL" }, 500);
  }
});

// Get product profile
api.get("/api/product/:key", async (c) => {
  const key = c.req.param("key");
  if (!key.startsWith("product:")) return c.json({ error: "Invalid key" }, 400);
  const value = await c.env.KV.get(key);
  if (!value) return c.json({ error: "Not found" }, 404);
  return c.json(JSON.parse(value));
});

// Generate ElevenLabs agent config for a scenario
api.post("/api/agent-config", async (c) => {
  const limited = rateLimit(c);
  if (limited) return limited;
  const { scenarioId, productKey } = await c.req.json<{
    scenarioId: string;
    productKey?: string;
  }>();
  const scenario = DEFAULT_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) return c.json({ error: "Scenario not found" }, 404);

  let productContext = "";
  if (productKey) {
    const product = await c.env.KV.get(productKey);
    if (product) {
      productContext = `\n\nProduct context for this conversation:\n${product}`;
    }
  }

  // Build the system prompt for ElevenLabs Conversational AI
  const systemPrompt = `${scenario.persona}

Tone: ${scenario.tone}

The user is practicing this conversation with you. Play your role realistically.
Push back, ask tough questions, and react authentically.
Don't break character. Don't acknowledge you're an AI.
${productContext}`;

  return c.json({
    systemPrompt,
    scenario,
    agentId: c.env.ELEVENLABS_AGENT_ID || ""
  });
});

// Get signed URL for ElevenLabs Conversational AI
api.post("/api/signed-url", async (c) => {
  const limited = rateLimit(c);
  if (limited) return limited;
  const { scenarioId, productKey } = await c.req.json<{
    scenarioId: string;
    productKey?: string;
  }>();
  const scenario = DEFAULT_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) return c.json({ error: "Scenario not found" }, 404);

  let productContext = "";
  if (productKey) {
    const product = await c.env.KV.get(productKey);
    if (product) {
      productContext = `\n\nProduct context for this conversation:\n${product}`;
    }
  }

  const systemPrompt = `${scenario.persona}

Tone: ${scenario.tone}

The user is practicing this conversation with you. Play your role realistically.
Push back, ask tough questions, and react authentically.
Don't break character. Don't acknowledge you're an AI.
${productContext}`;

  const agentId = c.env.ELEVENLABS_AGENT_ID?.trim();
  if (!agentId) {
    console.warn("[signed-url] ELEVENLABS_AGENT_ID not set, returning empty config");
    return c.json({
      agentId: "",
      systemPrompt,
      scenario,
      _debug: { path: "no-agent-id" },
    });
  }

  // Create a signed URL via ElevenLabs API
  const signedUrlEndpoint = new URL(
    "https://api.elevenlabs.io/v1/convai/conversation/get_signed_url"
  );
  signedUrlEndpoint.searchParams.set("agent_id", agentId);

  console.log("[signed-url] requesting signed URL for agent:", agentId);
  const elStart = Date.now();
  let response: Response;
  try {
    response = await fetch(signedUrlEndpoint, {
      method: "GET",
      headers: {
        "xi-api-key": c.env.ELEVENLABS_API_KEY,
      },
    });
  } catch (err) {
    console.error("[signed-url] ElevenLabs fetch failed:", err);
    return c.json({
      agentId,
      systemPrompt,
      scenario,
      _debug: { path: "fetch-error", error: String(err), elapsed: Date.now() - elStart },
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn("[signed-url] ElevenLabs returned", response.status, body.slice(0, 200));
    return c.json({
      agentId,
      systemPrompt,
      scenario,
      _debug: { path: "agentId-fallback", status: response.status, elapsed: Date.now() - elStart },
    });
  }

  const data = (await response.json()) as { signed_url: string };
  console.log("[signed-url] got signed URL, elapsed:", Date.now() - elStart, "ms");
  return c.json({
    signedUrl: data.signed_url,
    systemPrompt,
    scenario,
    _debug: { path: "signedUrl", elapsed: Date.now() - elStart },
  });
});

// Deepgram voice turn: STT → LLM → TTS pipeline (fallback when ElevenLabs unavailable)
api.post("/api/voice-turn", async (c) => {
  const limited = rateLimit(c);
  if (limited) return limited;

  const formData = await c.req.formData();
  const audioBlob = formData.get("audio") as File | null;
  const systemPrompt = formData.get("systemPrompt") as string | null;
  const conversationHistory = formData.get("history") as string | null;

  if (!audioBlob) return c.json({ error: "Audio required" }, 400);

  const audioBuffer = await audioBlob.arrayBuffer();

  // 1. STT — Deepgram nova-3 via Workers AI
  let userText = "";
  try {
    const sttResult = await c.env.AI.run("@cf/deepgram/nova-3" as Parameters<typeof c.env.AI.run>[0], {
      audio: [...new Uint8Array(audioBuffer)],
    } as never) as { text?: string; results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };

    userText = sttResult.text
      || sttResult.results?.channels?.[0]?.alternatives?.[0]?.transcript
      || "";
  } catch (err) {
    console.error("[voice-turn] STT failed:", err);
    return c.json({ error: "Speech recognition failed" }, 500);
  }

  if (!userText.trim()) {
    return c.json({ text: "", agentText: "", audioUrl: null });
  }

  // 2. LLM — generate agent response
  let agentText = "";
  try {
    const history = conversationHistory ? JSON.parse(conversationHistory) as Array<{ role: string; text: string }> : [];
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    for (const msg of history.slice(-10)) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.text,
      });
    }
    messages.push({ role: "user", content: userText });

    const ai = createWorkersAI({ binding: c.env.AI });
    const result = await generateText({
      model: ai("@cf/meta/llama-3.1-8b-instruct"),
      messages,
      maxOutputTokens: 200,
    });
    agentText = result.text;
  } catch (err) {
    console.error("[voice-turn] LLM failed:", err);
    agentText = "I'm sorry, I'm having trouble thinking right now. Could you repeat that?";
  }

  // 3. TTS — Deepgram aura-2-en via Workers AI
  let audioBase64 = "";
  try {
    const ttsResult = await c.env.AI.run("@cf/deepgram/aura-2-en" as Parameters<typeof c.env.AI.run>[0], {
      text: agentText,
    } as never) as ReadableStream | ArrayBuffer;

    let audioBytes: Uint8Array;
    if (ttsResult instanceof ReadableStream) {
      const reader = ttsResult.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      audioBytes = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        audioBytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      audioBytes = new Uint8Array(ttsResult as ArrayBuffer);
    }
    audioBase64 = btoa(String.fromCharCode(...audioBytes));
  } catch (err) {
    console.error("[voice-turn] TTS failed:", err);
    // Return text-only if TTS fails
  }

  return c.json({
    text: userText,
    agentText,
    audio: audioBase64 || null,
  });
});

// ── Main export ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Route API requests through Hono
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env);
    }

    // Route agent WebSocket requests
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
