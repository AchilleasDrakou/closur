---
title: Live Feedback MVP
type: feat
status: proposed
created: 2026-03-30
---

# Live Feedback MVP

## Problem

Live feedback is currently the weakest part of Closur.

The product already has:

- live transcript events from the voice conversation
- browser-side acoustic features
- a nudge overlay
- server-side session state in the CoachAgent Durable Object

But the current system is too open-ended. It can generate nudges that are:

- too frequent
- too vague
- too late
- not clearly tied to the scenario

The MVP needs to make live feedback feel fast, sparse, and relevant.

## Goal

Ship a rule-first live nudge system that answers three questions in real time:

1. Should we nudge now?
2. What is the most important issue right now?
3. What is the shortest useful thing we should say?

## Non-Goals

This MVP does not include:

- a browser LLM for coaching
- custom model training
- full emotion classification in real time
- freeform nudge generation every turn
- high-granularity scoring during the live session

## Product Principle

For live feedback, relevance beats intelligence.

A good live system should:

- interrupt rarely
- say one thing
- say it clearly
- say it at the right time

## Proposed Architecture

### Browser responsibilities

The browser owns low-latency signals:

- rolling transcript window
- speech rate estimate
- pause ratio
- energy
- pitch stability
- user / agent speaking state

The browser should continue to compute fast acoustic features directly inside `PracticeArena.tsx`.

### CoachAgent responsibilities

The Durable Object owns live policy state:

- rolling session context
- scenario-specific rubric
- nudge cooldowns
- suppression logic
- chosen nudge history
- logging for later analysis

The Durable Object should choose a nudge category, not generate long text.

### Workers AI responsibilities

Workers AI is optional and secondary during the live loop.

Use it only for lightweight transcript enrichment, not for deciding every nudge in the first version.

Examples:

- hedging estimate from the latest transcript chunk
- directness estimate
- objective-hit detection after the turn ends

## Nudge Taxonomy

The MVP uses a fixed taxonomy with short templates.

### Delivery nudges

- `pace_fast`
- `pace_slow`
- `low_energy`
- `high_tension`
- `pause_before_next_point`

### Conversation-quality nudges

- `hedging`
- `rambling`
- `be_specific`
- `answer_directly`
- `ask_question`

### Scenario-progress nudges

- `handle_objection`
- `make_the_ask`
- `show_empathy`
- `stay_firm`
- `land_next_step`

### Positive nudges

- `good_energy`
- `good_pause`
- `good_answer`
- `objective_hit`

## Nudge Copy Library

Each nudge type maps to a fixed short message.

Examples:

- `pace_fast` -> "Slow down."
- `low_energy` -> "Bring your energy up."
- `hedging` -> "Cut the hedge."
- `rambling` -> "Shorter answer."
- `answer_directly` -> "Answer the question first."
- `make_the_ask` -> "Make the ask clearly."
- `show_empathy` -> "Acknowledge their reaction."
- `good_answer` -> "Good direct answer."

No live freeform generation in MVP.

## Core Trigger Logic

Use rolling windows of recent activity:

- transcript window: last 1 to 2 user utterances
- acoustic window: last 8 to 12 seconds

Each window produces a compact feature bundle.

### Feature bundle

- `pace`
- `energy`
- `pitch_stability`
- `pause_ratio`
- `filler_count`
- `hedging_score`
- `directness_score`
- `user_turn_seconds`
- `agent_last_prompt_type`
- `scenario_id`

### Trigger rules

Only show a nudge when all of these are true:

1. The issue score exceeds a threshold.
2. The issue persists for at least 2 consecutive checks.
3. No nudge has been shown in the last 8 to 10 seconds.
4. The agent is not currently speaking.
5. The candidate nudge is not the same as the last shown nudge unless severity increased.

### Suppression rules

Suppress nudges when:

- the transcript confidence is too low
- the user is already correcting course
- the conversation just started
- there is no strong winner among candidate issues

Silence is better than a weak nudge.

## Scenario-Specific Logic

Each scenario adds 1 to 3 special triggers.

### Sales pitch

- if the user talks about features for too long without value -> `be_specific`
- if pricing pushback is detected but not answered -> `handle_objection`
- if the turn ends without a CTA -> `make_the_ask`

### VC pitch

- if the user never states market / traction clearly -> `be_specific`
- if pushback arrives and the user drifts away -> `answer_directly`
- if the user ends without a next step -> `land_next_step`

### Hard conversation

- if the user is too indirect -> `answer_directly`
- if emotion is high and empathy signal is low -> `show_empathy`
- if the user backs away from the core message -> `stay_firm`

## Implementation Plan

### Phase 1: Replace freeform live nudges

Refactor `src/lib/nudge-engine.ts` so it becomes a policy engine instead of a live text generator.

Add:

- `NudgeType`
- `NudgeDecision`
- `LiveFeatureBundle`
- `evaluateLiveNudgePolicy`

Keep:

- transcript analysis helpers
- acoustic signal helpers

Remove from the live path:

- arbitrary nudge strings returned by the LLM

### Phase 2: Add rolling state to CoachAgent

Update `src/server.ts` to track:

- `lastNudgeType`
- `lastNudgeAt`
- recent user utterances
- recent feature bundles
- nudge event log

### Phase 3: Tighten browser signal extraction

Update `src/components/PracticeArena.tsx` to send:

- rolling filler count
- utterance duration
- pause count
- latest transcript chunk metadata

Keep browser work cheap and deterministic.

## Proposed Types

```ts
export type NudgeType =
  | "pace_fast"
  | "pace_slow"
  | "low_energy"
  | "high_tension"
  | "pause_before_next_point"
  | "hedging"
  | "rambling"
  | "be_specific"
  | "answer_directly"
  | "ask_question"
  | "handle_objection"
  | "make_the_ask"
  | "show_empathy"
  | "stay_firm"
  | "land_next_step"
  | "good_energy"
  | "good_pause"
  | "good_answer"
  | "objective_hit";

export interface LiveFeatureBundle {
  scenarioId: string;
  pace: number;
  energy: number;
  pitchStability: number;
  pauseRatio: number;
  fillerCount: number;
  hedgingScore: number;
  directnessScore: number;
  userTurnSeconds: number;
  agentSpeaking: boolean;
}

export interface NudgeDecision {
  shouldNudge: boolean;
  nudgeType?: NudgeType;
  urgency?: "info" | "warning" | "positive";
  reason?: string;
}
```

## File-Level Changes

### `src/lib/nudge-engine.ts`

Turn this file into the live policy core:

- fixed nudge taxonomy
- copy lookup table
- deterministic trigger scoring
- optional transcript enrichment helper

### `src/server.ts`

Use the CoachAgent as the live policy owner:

- accept richer feature payloads
- apply cooldown and suppression
- emit one chosen nudge event
- log every shown and suppressed nudge

### `src/components/PracticeArena.tsx`

Tighten signal collection and nudge display:

- send recent transcript metadata with acoustic snapshots
- suppress duplicate visible nudges
- record user feedback on nudges later

## Acceptance Criteria

### Functional

- [ ] Live feedback uses a fixed nudge taxonomy, not freeform LLM text
- [ ] No more than one visible nudge is active at a time
- [ ] Corrective nudges respect a cooldown
- [ ] Positive nudges are less frequent than corrective nudges
- [ ] Scenario-specific triggers exist for sales, VC pitch, and hard conversations

### Quality

- [ ] Average nudge rate is below 6 per 10 minutes
- [ ] Duplicate nudges are suppressed
- [ ] At least 80% of internal test nudges are rated "helpful" or "neutral"
- [ ] False-positive nudges are easy to audit from logs

### Technical

- [ ] The browser path remains lightweight
- [ ] The CoachAgent contains the live policy state
- [ ] Nudge events are logged for later training

## Metrics To Capture

For every live nudge event, log:

- session id
- scenario id
- timestamp
- shown or suppressed
- nudge type
- urgency
- feature bundle snapshot
- transcript snippet

This log becomes the training data for the first learned nudge policy later.

## Rollout Strategy

### MVP

- deterministic policy
- fixed copy
- manual tuning of thresholds

### v1.1

- thumbs up / thumbs down on nudges
- threshold calibration from logs

### v1.2

- small learned reranker for candidate nudge selection

## Summary

The MVP should not try to be a smart live coach.

It should be:

- structured
- fast
- quiet
- easy to tune

If it can reliably say the right short thing at the right time, the live experience will improve immediately.
