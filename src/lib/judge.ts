import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";

// ── Types ─────────────────────────────────────────────────────────────

export interface ScoreCriterion {
  name: string;
  score: number; // 1-10
  feedback: string; // one sentence
}

export interface SessionScore {
  overall: number; // 1-10
  criteria: ScoreCriterion[];
  summary: string; // 2-3 sentence overall assessment
  strengths: string[]; // top 2-3
  improvements: string[]; // top 2-3
  annotations: SessionAnnotation[];
}

export interface SessionAnnotation {
  timestamp: number; // ms from session start
  type: "positive" | "negative" | "neutral";
  label: string; // short label for timeline marker
  detail: string; // longer explanation
}

export interface JudgeInput {
  scenario: {
    name: string;
    objectives: string[];
    scoring: string[];
    persona: string;
  };
  transcript: Array<{ role: "user" | "agent"; text: string; timestamp: number }>;
  duration: number; // ms
  acousticSummary?: {
    avgEnergy: number;
    avgPace: number;
    avgPitch: number;
  };
}

// ── Judge ──────────────────────────────────────────────────────────────

export async function judgeSession(ai: Ai, input: JudgeInput): Promise<SessionScore> {
  const workersai = createWorkersAI({ binding: ai });

  // Format transcript for the judge
  const transcriptText = input.transcript
    .map((t) => `${t.role === "user" ? "USER" : "AI_PARTNER"}: ${t.text}`)
    .join("\n");

  const durationSecs = Math.round(input.duration / 1000);
  const criteriaList = input.scenario.scoring.join(", ");
  const objectivesList = input.scenario.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n");

  const acousticNote = input.acousticSummary
    ? `\nAcoustic data: avg energy ${(input.acousticSummary.avgEnergy * 100).toFixed(0)}%, avg pace ${(input.acousticSummary.avgPace * 100).toFixed(0)}%, avg pitch ${(input.acousticSummary.avgPitch * 100).toFixed(0)}%`
    : "";

  const prompt = `You are an expert conversation coach judging a practice session.

SCENARIO: ${input.scenario.name}
AI PARTNER'S ROLE: ${input.scenario.persona}
DURATION: ${durationSecs} seconds
${acousticNote}

OBJECTIVES the user was trying to achieve:
${objectivesList}

SCORING CRITERIA (rate each 1-10):
${criteriaList}

TRANSCRIPT:
${transcriptText}

Rate this conversation. Return ONLY valid JSON, no markdown:
{
  "overall": <1-10 integer>,
  "criteria": [
    {"name": "<criterion>", "score": <1-10>, "feedback": "<one sentence>"}
  ],
  "summary": "<2-3 sentence assessment>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"],
  "annotations": [
    {"timestamp_pct": <0-1 float, position in conversation>, "type": "<positive|negative|neutral>", "label": "<2-3 words>", "detail": "<one sentence>"}
  ]
}

Be honest and specific. Don't inflate scores. A 5 is average. Most first attempts score 3-6.
Provide 3-6 annotations marking key moments (good openings, missed opportunities, strong rebuttals, weak responses, etc).`;

  const result = await generateText({
    model: workersai("@cf/moonshotai/kimi-k2.5"),
    prompt,
    maxTokens: 2000,
  });

  try {
    const parsed = JSON.parse(result.text);

    // Convert timestamp_pct to actual timestamps
    const annotations: SessionAnnotation[] = (parsed.annotations || []).map(
      (a: { timestamp_pct: number; type: string; label: string; detail: string }) => ({
        timestamp: Math.round(a.timestamp_pct * input.duration),
        type: a.type as "positive" | "negative" | "neutral",
        label: a.label,
        detail: a.detail,
      }),
    );

    return {
      overall: Math.min(10, Math.max(1, Math.round(parsed.overall || 5))),
      criteria: (parsed.criteria || []).map(
        (c: { name: string; score: number; feedback: string }) => ({
          name: c.name,
          score: Math.min(10, Math.max(1, Math.round(c.score || 5))),
          feedback: c.feedback || "",
        }),
      ),
      summary: parsed.summary || "No summary available.",
      strengths: parsed.strengths || [],
      improvements: parsed.improvements || [],
      annotations,
    };
  } catch {
    // Fallback if LLM returns bad JSON
    return {
      overall: 5,
      criteria: input.scenario.scoring.map((name) => ({
        name,
        score: 5,
        feedback: "Unable to evaluate — try a longer session.",
      })),
      summary: "Session was too short or transcript was unclear for detailed evaluation.",
      strengths: [],
      improvements: ["Try speaking more clearly and for longer"],
      annotations: [],
    };
  }
}
