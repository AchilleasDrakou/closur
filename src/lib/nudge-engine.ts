import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";

// ── Types ─────────────────────────────────────────────────────────────

export type NudgeType =
  | "pace_fast"
  | "pace_slow"
  | "low_energy"
  | "high_tension"
  | "hedging"
  | "rambling"
  | "be_specific"
  | "answer_directly"
  | "handle_objection"
  | "make_the_ask"
  | "show_empathy"
  | "stay_firm"
  | "good_energy"
  | "good_answer"
  | "objective_hit";

export interface NudgeResult {
  type: NudgeType;
  text: string;
  urgency: "info" | "warning" | "positive";
}

export interface TranscriptAnalysis {
  confidence: number;
  hedging: number;
  filler_words: number;
  assertiveness: number;
  key_topics: string[];
  sentiment: "positive" | "neutral" | "negative";
}

export interface AcousticSnapshot {
  pitch: number;
  energy: number;
  pace: number;
}

export interface ConversationState {
  turnCount: number;
  topicsCovered: string[];
  objectivesHit: string[];
  lastAnalysis: TranscriptAnalysis | null;
  recentAcoustic: AcousticSnapshot[];
}

interface ScenarioContext {
  id: string;
  objectives: string[];
  scoring: string[];
  name: string;
}

export interface LiveFeatureBundle {
  scenarioId: string;
  text: string;
  pace: number;
  energy: number;
  pitch: number;
  turnCount: number;
  confidence: number;
  hedging: number;
  fillerWords: number;
  assertiveness: number;
  sentiment: TranscriptAnalysis["sentiment"];
  newObjectivesHit: string[];
}

const NUDGE_LIBRARY: Record<NudgeType, Omit<NudgeResult, "type">> = {
  pace_fast: { text: "Slow down.", urgency: "warning" },
  pace_slow: { text: "Pick up the pace.", urgency: "info" },
  low_energy: { text: "Bring your energy up.", urgency: "warning" },
  high_tension: { text: "Take a breath.", urgency: "info" },
  hedging: { text: "Cut the hedge.", urgency: "warning" },
  rambling: { text: "Shorter answer.", urgency: "info" },
  be_specific: { text: "Be more specific.", urgency: "info" },
  answer_directly: { text: "Answer the question first.", urgency: "warning" },
  handle_objection: { text: "Handle the objection directly.", urgency: "warning" },
  make_the_ask: { text: "Make the ask clearly.", urgency: "info" },
  show_empathy: { text: "Acknowledge their reaction.", urgency: "info" },
  stay_firm: { text: "Stay clear and firm.", urgency: "warning" },
  good_energy: { text: "Good energy.", urgency: "positive" },
  good_answer: { text: "Good direct answer.", urgency: "positive" },
  objective_hit: { text: "Objective hit.", urgency: "positive" },
};

function makeNudge(type: NudgeType): NudgeResult {
  return { type, ...NUDGE_LIBRARY[type] };
}

// ── Acoustic threshold nudges ─────────────────────────────────────────

export function checkAcousticNudges(acoustic: AcousticSnapshot): NudgeResult[] {
  const nudges: NudgeResult[] = [];

  if (acoustic.pace > 0.8) {
    nudges.push(makeNudge("pace_fast"));
  } else if (acoustic.pace < 0.15 && acoustic.energy > 0.05) {
    nudges.push(makeNudge("pace_slow"));
  }

  if (acoustic.energy < 0.02) {
    nudges.push(makeNudge("low_energy"));
  } else if (acoustic.energy > 0.8) {
    nudges.push(makeNudge("good_energy"));
  }

  if (acoustic.pitch > 0.9) {
    nudges.push(makeNudge("high_tension"));
  }

  return nudges;
}

export function evaluateLiveNudgePolicy(bundle: LiveFeatureBundle): NudgeResult[] {
  const trimmed = bundle.text.trim();
  const lower = trimmed.toLowerCase();
  const candidates: Array<{ score: number; nudge: NudgeResult }> = [];

  if (bundle.newObjectivesHit.length > 0) {
    candidates.push({ score: 1.0, nudge: makeNudge("objective_hit") });
  }

  if (bundle.hedging > 0.62 || /\b(maybe|kind of|sort of|i think|probably)\b/.test(lower)) {
    candidates.push({ score: 0.92, nudge: makeNudge("hedging") });
  }

  if ((bundle.fillerWords >= 4 || lower.split(/\s+/).length > 45) && bundle.assertiveness < 0.55) {
    candidates.push({ score: 0.9, nudge: makeNudge("rambling") });
  }

  if (bundle.assertiveness < 0.35 && trimmed.length > 80) {
    candidates.push({ score: 0.88, nudge: makeNudge("answer_directly") });
  }

  if (bundle.energy < 0.03) {
    candidates.push({ score: 0.86, nudge: makeNudge("low_energy") });
  }

  if (bundle.pace > 0.8) {
    candidates.push({ score: 0.84, nudge: makeNudge("pace_fast") });
  }

  if (bundle.pace < 0.15 && bundle.energy > 0.05) {
    candidates.push({ score: 0.72, nudge: makeNudge("pace_slow") });
  }

  if (bundle.pitch > 0.9) {
    candidates.push({ score: 0.7, nudge: makeNudge("high_tension") });
  }

  const salesOrPitch = bundle.scenarioId === "sales-pitch" || bundle.scenarioId === "vc-pitch" || bundle.scenarioId === "negotiation";
  if (salesOrPitch && bundle.turnCount >= 3 && !/\b(next step|follow up|pilot|trial|demo|meeting|send|ask|close)\b/.test(lower)) {
    candidates.push({
      score: bundle.scenarioId === "vc-pitch" ? 0.73 : 0.81,
      nudge: makeNudge(bundle.scenarioId === "vc-pitch" ? "be_specific" : "make_the_ask"),
    });
  }

  if (bundle.scenarioId === "sales-pitch" && /\b(price|pricing|budget|cost|expensive)\b/.test(lower)) {
    candidates.push({ score: 0.89, nudge: makeNudge("handle_objection") });
  }

  if ((bundle.scenarioId === "firing" || bundle.scenarioId === "conflict") && bundle.sentiment === "negative" && bundle.confidence < 0.45) {
    candidates.push({ score: 0.83, nudge: makeNudge("show_empathy") });
  }

  if ((bundle.scenarioId === "firing" || bundle.scenarioId === "conflict") && bundle.assertiveness < 0.35) {
    candidates.push({ score: 0.79, nudge: makeNudge("stay_firm") });
  }

  if (bundle.confidence > 0.72 && bundle.assertiveness > 0.68 && bundle.hedging < 0.35) {
    candidates.push({ score: 0.65, nudge: makeNudge("good_answer") });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.nudge);
}

// ── AI-powered transcript analysis ───────────────────────────────────

export async function analyzeTranscriptWithAI(
  ai: Ai,
  text: string,
  scenario: ScenarioContext,
  state: ConversationState,
): Promise<{ analysis: TranscriptAnalysis; newObjectivesHit: string[] }> {
  const workersai = createWorkersAI({ binding: ai });

  const scoringCriteria = scenario.scoring.join(", ");
  const objectives = scenario.objectives.join(", ");
  const coveredTopics = state.topicsCovered.length > 0 ? state.topicsCovered.join(", ") : "none yet";
  const hitObjectives = state.objectivesHit.length > 0 ? state.objectivesHit.join(", ") : "none yet";

  const result = await generateText({
    model: workersai("@cf/meta/llama-3.1-8b-instruct"),
    system: `You are a conversation coach analyzing speech in real-time. Return ONLY valid JSON, no markdown.

Scenario: ${scenario.name}
Scoring criteria: ${scoringCriteria}
Objectives: ${objectives}
Topics covered so far: ${coveredTopics}
Objectives hit so far: ${hitObjectives}
Turn number: ${state.turnCount}

Analyze the user's speech and return JSON with:
{
  "confidence": 0.0-1.0,
  "hedging": 0.0-1.0,
  "filler_words": number,
  "assertiveness": 0.0-1.0,
  "key_topics": ["topic1"],
  "sentiment": "positive"|"neutral"|"negative",
  "new_objectives_hit": ["objective if newly achieved"]
}

Do not write coaching copy.
Only return the structured analysis values.`,
    prompt: text,
  });

  let parsed: {
    confidence?: number;
    hedging?: number;
    filler_words?: number;
    assertiveness?: number;
    key_topics?: string[];
    sentiment?: string;
    new_objectives_hit?: string[];
  };

  try {
    parsed = JSON.parse(result.text);
  } catch {
    // Fallback
    return {
      analysis: {
        confidence: 0.5,
        hedging: 0.5,
        filler_words: 0,
        assertiveness: 0.5,
        key_topics: [],
        sentiment: "neutral",
      },
      newObjectivesHit: [],
    };
  }

  const analysis: TranscriptAnalysis = {
    confidence: parsed.confidence ?? 0.5,
    hedging: parsed.hedging ?? 0.5,
    filler_words: parsed.filler_words ?? 0,
    assertiveness: parsed.assertiveness ?? 0.5,
    key_topics: parsed.key_topics ?? [],
    sentiment: (parsed.sentiment as TranscriptAnalysis["sentiment"]) ?? "neutral",
  };

  return { analysis, newObjectivesHit: parsed.new_objectives_hit ?? [] };
}
