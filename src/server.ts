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
  type NudgeResult,
} from "./lib/nudge-engine";

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
    persona: "You are a busy VP of Engineering evaluating tools for your team. You're skeptical of new products, ask tough questions about ROI, and push back on pricing. You've seen many demos and are hard to impress. Never break character. Never acknowledge you're an AI.",
    firstMessage: "Thanks for getting on the call. I've got about fifteen minutes — what have you got for me?",
    tone: "professional, slightly impatient, probing",
    objectives: ["Handle pricing objections", "Demonstrate clear value", "Ask for next steps"],
    scoring: ["clarity", "confidence", "objection_handling", "pace"],
  },
  {
    id: "vc-pitch",
    name: "VC Pitch",
    description: "Practice your investor pitch with a tough VC partner",
    persona: "You are a partner at a top-tier VC firm. You've seen thousands of pitches and can spot weak points instantly. You care about market size, defensibility, and the team. You're direct and will challenge assumptions. Never break character. Never acknowledge you're an AI.",
    firstMessage: "Good to meet you. Our mutual friend spoke highly of what you're building. Walk me through it — what's the opportunity here?",
    tone: "direct, analytical, occasionally encouraging",
    objectives: ["Articulate the market opportunity", "Handle valuation pushback", "Show traction"],
    scoring: ["clarity", "confidence", "storytelling", "pace"],
  },
  {
    id: "firing",
    name: "Letting Someone Go",
    description: "Practice having a termination conversation with empathy",
    persona: "You are an employee who has been underperforming but doesn't fully realize the severity. You're surprised and emotional when you hear the news. You ask 'why' and try to negotiate staying. Never break character. Never acknowledge you're an AI.",
    firstMessage: "Hey, you wanted to grab some time? What's going on?",
    tone: "confused, emotional, defensive then accepting",
    objectives: ["Be direct and clear", "Show empathy", "Stay firm on the decision", "Cover logistics"],
    scoring: ["clarity", "empathy", "firmness", "pace"],
  },
  {
    id: "conflict",
    name: "Conflict Resolution",
    description: "Practice addressing a conflict with a colleague",
    persona: "You are a colleague who feels their work isn't being recognized. You've been passive-aggressive in meetings and are defensive when confronted. You need to feel heard before you'll engage constructively. Never break character. Never acknowledge you're an AI.",
    firstMessage: "Oh, you wanted to talk? Sure. What about?",
    tone: "defensive, guarded, gradually opening up",
    objectives: ["Address the issue directly", "Listen actively", "Find common ground", "Agree on next steps"],
    scoring: ["empathy", "directness", "active_listening", "pace"],
  },
  {
    id: "negotiation",
    name: "Salary Negotiation",
    description: "Practice negotiating a raise or job offer",
    persona: "You are a hiring manager or boss. You like the person but have budget constraints. You'll try to offer less or defer the conversation. You respond well to data and confidence but not to ultimatums. Never break character. Never acknowledge you're an AI.",
    firstMessage: "Thanks for setting up time. You mentioned you wanted to discuss something — go ahead.",
    tone: "friendly but firm, budget-conscious",
    objectives: ["State your ask clearly", "Justify with evidence", "Handle pushback", "Reach agreement"],
    scoring: ["confidence", "preparation", "flexibility", "pace"],
  },
];

// ── CoachAgent (Durable Object) ───────────────────────────────────────

export class CoachAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 200;

  // Conversation state tracked across the session
  private convState: ConversationState = {
    turnCount: 0,
    topicsCovered: [],
    objectivesHit: [],
    lastAnalysis: null,
    recentAcoustic: [],
  };

  private activeScenario: Scenario | null = null;
  private lastAcousticNudgeTime = 0;

  // Set scenario for this session
  @callable()
  async setScenario(scenario: Scenario) {
    this.activeScenario = scenario;
    this.convState = {
      turnCount: 0,
      topicsCovered: [],
      objectivesHit: [],
      lastAnalysis: null,
      recentAcoustic: [],
    };
  }

  // Store acoustic data + check thresholds for nudges
  @callable()
  async sendAcousticData(data: {
    pitch: number;
    energy: number;
    pace: number;
    timestamp: number;
  }) {
    this.sql.exec(
      `INSERT OR IGNORE INTO acoustic_data (timestamp, pitch, energy, pace) VALUES (?, ?, ?, ?)`,
      data.timestamp,
      data.pitch,
      data.energy,
      data.pace,
    );

    // Track recent acoustic data
    const snapshot: AcousticSnapshot = { pitch: data.pitch, energy: data.energy, pace: data.pace };
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
      const avg: AcousticSnapshot = {
        pitch: recent.reduce((s, d) => s + d.pitch, 0) / recent.length,
        energy: recent.reduce((s, d) => s + d.energy, 0) / recent.length,
        pace: recent.reduce((s, d) => s + d.pace, 0) / recent.length,
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
  async sendNudge(nudge: { text: string; urgency: "info" | "warning" | "positive"; timestamp: number }) {
    this.sql.exec(
      `INSERT INTO nudges (timestamp, text, urgency) VALUES (?, ?, ?)`,
      nudge.timestamp,
      nudge.text,
      nudge.urgency,
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
        name: this.activeScenario.name,
      },
      this.convState,
    );

    // Update conversation state
    this.convState.lastAnalysis = analysis;
    for (const topic of analysis.key_topics) {
      if (!this.convState.topicsCovered.includes(topic)) {
        this.convState.topicsCovered.push(topic);
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
    const acousticRows = this.sql.exec(`SELECT * FROM acoustic_data ORDER BY timestamp`).toArray();
    const nudgeRows = this.sql.exec(`SELECT * FROM nudges ORDER BY timestamp`).toArray();

    return {
      acousticData: acousticRows,
      nudges: nudgeRows,
      messageCount: this.messages.length,
      conversationState: this.convState,
    };
  }

  // Helper: emit a nudge (persist + broadcast)
  private emitNudge(nudge: NudgeResult) {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO nudges (timestamp, text, urgency) VALUES (?, ?, ?)`,
      now,
      nudge.text,
      nudge.urgency,
    );
    this.broadcast(
      JSON.stringify({
        type: "nudge",
        nudge: { ...nudge, timestamp: now },
      }),
    );
  }

  onStart() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS acoustic_data (
        timestamp INTEGER PRIMARY KEY,
        pitch REAL,
        energy REAL,
        pace REAL
      )
    `);
    this.sql.exec(`
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
    if (parsed.protocol !== "https:") return c.json({ error: "HTTPS URLs only" }, 400);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.startsWith("127.") || host.startsWith("10.") ||
        host.startsWith("192.168.") || host.startsWith("172.") || host === "169.254.169.254" ||
        host.endsWith(".internal") || host.endsWith(".local")) {
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
          Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
        },
        body: JSON.stringify({ url }),
      },
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
      prompt: markdown.slice(0, 4000), // limit context
    });

    let profile;
    try {
      profile = JSON.parse(summary.text);
    } catch {
      profile = { name: "Unknown", description: markdown.slice(0, 200), valueProps: [], pricing: "Not found", targetAudience: "Unknown", commonObjections: [] };
    }

    // Store in KV
    const key = `product:${btoa(url).slice(0, 40)}`;
    await c.env.KV.put(key, JSON.stringify(profile));

    return c.json({ profile, key });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Get product profile
api.get("/api/product/:key", async (c) => {
  const value = await c.env.KV.get(c.req.param("key"));
  if (!value) return c.json({ error: "Not found" }, 404);
  return c.json(JSON.parse(value));
});

// Generate ElevenLabs agent config for a scenario
api.post("/api/agent-config", async (c) => {
  const { scenarioId, productKey } = await c.req.json<{ scenarioId: string; productKey?: string }>();
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
    agentId: c.env.ELEVENLABS_AGENT_ID || "",
  });
});

// Get signed URL for ElevenLabs Conversational AI
api.post("/api/signed-url", async (c) => {
  const { scenarioId, productKey } = await c.req.json<{ scenarioId: string; productKey?: string }>();
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

  // Create a signed URL via ElevenLabs API
  const response = await fetch("https://api.elevenlabs.io/v1/convai/conversation/get_signed_url", {
    method: "GET",
    headers: {
      "xi-api-key": c.env.ELEVENLABS_API_KEY,
    },
  });

  if (!response.ok) {
    // Fallback: return agent config for direct agentId connection
    return c.json({
      agentId: c.env.ELEVENLABS_AGENT_ID || "",
      systemPrompt,
      scenario,
    });
  }

  const data = await response.json() as { signed_url: string };
  return c.json({
    signedUrl: data.signed_url,
    systemPrompt,
    scenario,
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
  },
} satisfies ExportedHandler<Env>;
