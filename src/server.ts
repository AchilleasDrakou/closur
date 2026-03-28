import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { Hono } from "hono";
import { generateText } from "ai";

// ── Scenario type ─────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  description: string;
  persona: string;
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
    persona: "You are a busy VP of Engineering evaluating tools for your team. You're skeptical of new products, ask tough questions about ROI, and push back on pricing. You've seen many demos and are hard to impress.",
    tone: "professional, slightly impatient, probing",
    objectives: ["Handle pricing objections", "Demonstrate clear value", "Ask for next steps"],
    scoring: ["clarity", "confidence", "objection_handling", "pace"],
  },
  {
    id: "vc-pitch",
    name: "VC Pitch",
    description: "Practice your investor pitch with a tough VC partner",
    persona: "You are a partner at a top-tier VC firm. You've seen thousands of pitches and can spot weak points instantly. You care about market size, defensibility, and the team. You're direct and will challenge assumptions.",
    tone: "direct, analytical, occasionally encouraging",
    objectives: ["Articulate the market opportunity", "Handle valuation pushback", "Show traction"],
    scoring: ["clarity", "confidence", "storytelling", "pace"],
  },
  {
    id: "firing",
    name: "Letting Someone Go",
    description: "Practice having a termination conversation with empathy",
    persona: "You are an employee who has been underperforming but doesn't fully realize the severity. You're surprised and emotional when you hear the news. You ask 'why' and try to negotiate staying.",
    tone: "confused, emotional, defensive then accepting",
    objectives: ["Be direct and clear", "Show empathy", "Stay firm on the decision", "Cover logistics"],
    scoring: ["clarity", "empathy", "firmness", "pace"],
  },
  {
    id: "conflict",
    name: "Conflict Resolution",
    description: "Practice addressing a conflict with a colleague",
    persona: "You are a colleague who feels their work isn't being recognized. You've been passive-aggressive in meetings and are defensive when confronted. You need to feel heard before you'll engage constructively.",
    tone: "defensive, guarded, gradually opening up",
    objectives: ["Address the issue directly", "Listen actively", "Find common ground", "Agree on next steps"],
    scoring: ["empathy", "directness", "active_listening", "pace"],
  },
  {
    id: "negotiation",
    name: "Salary Negotiation",
    description: "Practice negotiating a raise or job offer",
    persona: "You are a hiring manager or boss. You like the person but have budget constraints. You'll try to offer less or defer the conversation. You respond well to data and confidence but not to ultimatums.",
    tone: "friendly but firm, budget-conscious",
    objectives: ["State your ask clearly", "Justify with evidence", "Handle pushback", "Reach agreement"],
    scoring: ["confidence", "preparation", "flexibility", "pace"],
  },
];

// ── CoachAgent (Durable Object) ───────────────────────────────────────

export class CoachAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 200;

  // Store acoustic data from client
  @callable()
  async sendAcousticData(data: {
    pitch: number;
    energy: number;
    pace: number;
    timestamp: number;
  }) {
    // Store in SQL for viz and analysis
    this.sql.exec(
      `INSERT OR IGNORE INTO acoustic_data (timestamp, pitch, energy, pace) VALUES (?, ?, ?, ?)`,
      data.timestamp,
      data.pitch,
      data.energy,
      data.pace,
    );

    // Broadcast viz data to connected clients
    this.broadcast(
      JSON.stringify({
        type: "viz-data",
        data,
      }),
    );
  }

  // Store a coaching nudge
  @callable()
  async sendNudge(nudge: { text: string; urgency: "info" | "warning" | "positive"; timestamp: number }) {
    this.sql.exec(
      `INSERT INTO nudges (timestamp, text, urgency) VALUES (?, ?, ?)`,
      nudge.timestamp,
      nudge.text,
      nudge.urgency,
    );

    this.broadcast(
      JSON.stringify({
        type: "nudge",
        nudge,
      }),
    );
  }

  // Analyze transcript chunk for sentiment
  @callable()
  async analyzeTranscript(text: string) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = await generateText({
      model: workersai("@cf/meta/llama-3.1-8b-instruct"),
      system: `You analyze speech transcripts for a conversation coach. Return JSON only.
Evaluate: confidence (0-1), hedging (0-1), filler_words (count), assertiveness (0-1), key_topics (array of strings).
Be concise.`,
      prompt: text,
    });

    let analysis;
    try {
      analysis = JSON.parse(result.text);
    } catch {
      analysis = { confidence: 0.5, hedging: 0.5, filler_words: 0, assertiveness: 0.5, key_topics: [] };
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
    };
  }

  // Initialize tables on start
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

  // Main chat handler — not used for voice but for text-based interactions
  async onChatMessage() {
    // Placeholder — voice conversations go through ElevenLabs Conversational AI directly
    // This handles any text-based coaching interactions
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
  const { url } = await c.req.json<{ url: string }>();
  if (!url) return c.json({ error: "URL required" }, 400);

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
