import type { AcousticSnapshot, LiveFeatureBundle, NudgeType } from "../src/lib/nudge-engine";

export interface AcousticPolicyCase {
  id: string;
  kind: "acoustic";
  input: AcousticSnapshot;
  expected: NudgeType;
}

export interface TranscriptPolicyCase {
  id: string;
  kind: "transcript";
  input: LiveFeatureBundle;
  expected: NudgeType;
}

export type LiveFeedbackPolicyCase = AcousticPolicyCase | TranscriptPolicyCase;

export const liveFeedbackPolicyCases: LiveFeedbackPolicyCase[] = [
  {
    id: "pace-fast",
    kind: "acoustic",
    input: { pitch: 0.35, energy: 0.42, pace: 0.92 },
    expected: "pace_fast",
  },
  {
    id: "low-energy",
    kind: "acoustic",
    input: { pitch: 0.28, energy: 0.01, pace: 0.22 },
    expected: "low_energy",
  },
  {
    id: "hedging",
    kind: "transcript",
    input: {
      scenarioId: "sales-pitch",
      text: "Maybe we could sort of explore this if you think it might help.",
      pace: 0.3,
      energy: 0.35,
      pitch: 0.32,
      turnCount: 2,
      confidence: 0.41,
      hedging: 0.82,
      fillerWords: 2,
      assertiveness: 0.48,
      sentiment: "neutral",
      newObjectivesHit: [],
    },
    expected: "hedging",
  },
  {
    id: "rambling",
    kind: "transcript",
    input: {
      scenarioId: "sales-pitch",
      text: "We cover a lot of things for a lot of teams and there are many areas where the product can help, and there are different workflows, and it can support onboarding, reporting, collaboration, and all kinds of internal operations across the company.",
      pace: 0.46,
      energy: 0.37,
      pitch: 0.31,
      turnCount: 3,
      confidence: 0.52,
      hedging: 0.34,
      fillerWords: 5,
      assertiveness: 0.42,
      sentiment: "neutral",
      newObjectivesHit: [],
    },
    expected: "rambling",
  },
  {
    id: "answer-directly",
    kind: "transcript",
    input: {
      scenarioId: "sales-pitch",
      text: "Let me give you a lot more background before I answer that, because there are several moving pieces, some history with the team, and a few ways we might think about it before getting to your question.",
      pace: 0.34,
      energy: 0.33,
      pitch: 0.3,
      turnCount: 3,
      confidence: 0.38,
      hedging: 0.2,
      fillerWords: 1,
      assertiveness: 0.22,
      sentiment: "neutral",
      newObjectivesHit: [],
    },
    expected: "answer_directly",
  },
  {
    id: "missing-ask",
    kind: "transcript",
    input: {
      scenarioId: "sales-pitch",
      text: "The ROI is strong, the implementation is light, and the team could get value quickly once the rollout begins.",
      pace: 0.39,
      energy: 0.41,
      pitch: 0.29,
      turnCount: 4,
      confidence: 0.69,
      hedging: 0.08,
      fillerWords: 0,
      assertiveness: 0.71,
      sentiment: "positive",
      newObjectivesHit: [],
    },
    expected: "make_the_ask",
  },
];
