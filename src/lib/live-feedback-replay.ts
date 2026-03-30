import {
  checkAcousticNudges,
  evaluateLiveNudgePolicy,
  type AcousticSnapshot,
  type LiveFeatureBundle,
  type NudgeResult,
  type NudgeType,
} from "./nudge-engine";

export interface ReplayShownNudge extends NudgeResult {
  source: "acoustic" | "transcript";
  timestamp: number;
}

export interface ReplaySuppressedNudge extends ReplayShownNudge {
  reason: "agent_speaking" | "cooldown" | "duplicate";
}

export interface AcousticReplayEvent {
  kind: "acoustic";
  timestamp: number;
  acoustic: AcousticSnapshot;
}

export interface TranscriptReplayEvent {
  kind: "transcript";
  timestamp: number;
  bundle: LiveFeatureBundle;
}

export interface ModeReplayEvent {
  kind: "mode";
  timestamp: number;
  agentSpeaking: boolean;
}

export type LiveFeedbackReplayEvent =
  | AcousticReplayEvent
  | TranscriptReplayEvent
  | ModeReplayEvent;

export interface ReplayExpectation {
  type: NudgeType;
  minTimestamp: number;
  maxTimestamp: number;
}

export interface LiveFeedbackReplayFixture {
  id: string;
  scenarioId: string;
  description: string;
  events: LiveFeedbackReplayEvent[];
  expectedShown: ReplayExpectation[];
  unexpected?: NudgeType[];
}

export interface ReplayResult {
  shown: ReplayShownNudge[];
  suppressed: ReplaySuppressedNudge[];
}

export interface ReplayExpectationResult {
  ok: boolean;
  errors: string[];
}

function applySuppression(
  candidate: NudgeResult,
  source: "acoustic" | "transcript",
  timestamp: number,
  agentSpeaking: boolean,
  lastNudgeAt: number,
  lastNudgeType: NudgeType | null,
): { shown?: ReplayShownNudge; suppressed?: ReplaySuppressedNudge } {
  const reason =
    agentSpeaking ? "agent_speaking"
    : timestamp - lastNudgeAt < 8000 ? "cooldown"
    : lastNudgeType === candidate.type && timestamp - lastNudgeAt < 15000 ? "duplicate"
    : null;

  const event = { ...candidate, source, timestamp };
  if (reason) {
    return { suppressed: { ...event, reason } };
  }
  return { shown: event };
}

export function replayLiveFeedbackFixture(fixture: LiveFeedbackReplayFixture): ReplayResult {
  let agentSpeaking = false;
  let lastNudgeAt = Number.NEGATIVE_INFINITY;
  let lastNudgeType: NudgeType | null = null;
  const shown: ReplayShownNudge[] = [];
  const suppressed: ReplaySuppressedNudge[] = [];

  for (const event of [...fixture.events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.kind === "mode") {
      agentSpeaking = event.agentSpeaking;
      continue;
    }

    const candidates = event.kind === "acoustic"
      ? checkAcousticNudges(event.acoustic)
      : evaluateLiveNudgePolicy(event.bundle);

    for (const candidate of candidates) {
      const result = applySuppression(
        candidate,
        event.kind,
        event.timestamp,
        agentSpeaking,
        lastNudgeAt,
        lastNudgeType,
      );

      if (result.suppressed) {
        suppressed.push(result.suppressed);
        continue;
      }

      if (result.shown) {
        shown.push(result.shown);
        lastNudgeAt = event.timestamp;
        lastNudgeType = candidate.type;
        break;
      }
    }
  }

  return { shown, suppressed };
}

export function evaluateReplayExpectations(
  fixture: LiveFeedbackReplayFixture,
  result: ReplayResult,
): ReplayExpectationResult {
  const errors: string[] = [];

  for (const expected of fixture.expectedShown) {
    const match = result.shown.find((nudge) => (
      nudge.type === expected.type
      && nudge.timestamp >= expected.minTimestamp
      && nudge.timestamp <= expected.maxTimestamp
    ));
    if (!match) {
      errors.push(`Missing expected nudge ${expected.type} between ${expected.minTimestamp} and ${expected.maxTimestamp}.`);
    }
  }

  for (const unexpected of fixture.unexpected ?? []) {
    const match = result.shown.find((nudge) => nudge.type === unexpected);
    if (match) {
      errors.push(`Unexpected nudge ${unexpected} shown at ${match.timestamp}.`);
    }
  }

  return { ok: errors.length === 0, errors };
}
