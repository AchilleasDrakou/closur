import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";

// ── Types ─────────────────────────────────────────────────────────────

export interface NudgeResult {
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
  speechActive?: boolean;
}

export interface ConversationState {
  turnCount: number;
  topicsCovered: string[];
  objectivesHit: string[];
  lastAnalysis: TranscriptAnalysis | null;
  recentAcoustic: AcousticSnapshot[];
}

interface ScenarioContext {
  objectives: string[];
  scoring: string[];
  name: string;
}

// ── Acoustic threshold nudges ─────────────────────────────────────────

export function checkAcousticNudges(acoustic: AcousticSnapshot): NudgeResult[] {
  const nudges: NudgeResult[] = [];

  if (acoustic.pace > 0.8) {
    nudges.push({ text: "Slow down — you're speaking too fast", urgency: "warning" });
  } else if (acoustic.pace < 0.15 && acoustic.energy > 0.05) {
    nudges.push({ text: "Pick up the pace a bit", urgency: "info" });
  }

  if (acoustic.energy < 0.02) {
    nudges.push({ text: "Speak up — your energy is dropping", urgency: "warning" });
  } else if (acoustic.energy > 0.8) {
    nudges.push({ text: "Good energy — keep it up", urgency: "positive" });
  }

  if (acoustic.pitch > 0.9) {
    nudges.push({ text: "Your pitch is high — take a breath", urgency: "info" });
  }

  return nudges;
}

// ── AI-powered transcript analysis ───────────────────────────────────

export async function analyzeTranscriptWithAI(
  ai: Ai,
  text: string,
  scenario: ScenarioContext,
  state: ConversationState,
): Promise<{ analysis: TranscriptAnalysis; nudges: NudgeResult[] }> {
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
  "new_objectives_hit": ["objective if newly achieved"],
  "nudges": [{"text": "short coaching tip", "urgency": "info"|"warning"|"positive"}]
}

Nudge rules:
- If hedging > 0.6: warn about hedging
- If confidence < 0.3: encourage more confidence
- If confidence > 0.7: positive reinforcement
- If they hit an objective: celebrate it
- If they missed an opening: point it out
- Keep nudges under 15 words, human and direct`,
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
    nudges?: NudgeResult[];
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
      nudges: [],
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

  const nudges: NudgeResult[] = parsed.nudges ?? [];

  // Add objective-hit nudges
  if (parsed.new_objectives_hit) {
    for (const obj of parsed.new_objectives_hit) {
      nudges.push({ text: `Objective hit: ${obj}`, urgency: "positive" });
    }
  }

  return { analysis, nudges };
}
