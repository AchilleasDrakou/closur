# Closur Live Feedback Delivery Spec

## Purpose

This document defines how Closur should improve live feedback in a practical sequence.

The goal is not to jump straight to a trained model. The goal is to make live feedback:

- timely
- sparse
- relevant
- testable

This spec sits above the feature spec in [context/specs/2026-03-30-feat-live-feedback-mvp.md](/Users/achilleasdrakou/Documents/GitHub/closur/context/specs/2026-03-30-feat-live-feedback-mvp.md).

That feature spec defines the product behavior.

This document defines how we deliver it safely, including:

- implementation order
- evaluation method
- end-to-end testing strategy
- promotion criteria for each phase

## Delivery Principles

### 1. Reliability before intelligence

If transcript events arrive late or duplicate, better prompting will not save the product.

Fix order:

1. event flow
2. transcript quality
3. nudge policy
4. prompt quality
5. model tuning

### 2. Test every layer separately

Do not treat "live feedback" as one black box.

Evaluate:

- transcription
- event timing
- policy decisions
- prompt outputs
- full end-to-end user experience

### 3. Use fixed outputs before freeform outputs

The first live system should classify the situation and pick from an approved nudge library.

Do not start with unconstrained live coaching text.

### 4. Promote only after confidence

Each phase should have:

- implementation work
- direct tests
- E2E verification
- a clear go/no-go rule

## Phase Plan

## Phase 0: Baseline Instrumentation

### Goal

Make the current system observable before changing behavior.

### Deliverables

- log every incoming user transcript chunk
- log every incoming agent transcript chunk
- log every shown live nudge
- log every suppressed live nudge
- log the timestamps for:
  - user starts speaking
  - transcript received
  - agent starts speaking
  - nudge shown

### Why

Without a baseline timeline, it is impossible to know whether prompt changes improved the system or only changed the failure mode.

## Phase 1: Transcript and Event Reliability

### Goal

Make sure the live system reacts to the correct text at the correct time.

### Scope

- improve ElevenLabs event handling
- distinguish partial vs final transcript if available
- prevent duplicate user turns
- prevent nudges while the agent is speaking
- ensure session start / end is clean

### Success criteria

- no duplicate transcript-triggered nudges in test sessions
- no nudges while the agent is speaking
- user transcript chunks appear in the correct order
- failed voice connections do not leave the session in a bad state

## Phase 2: Deterministic Live Nudge Policy

### Goal

Replace broad live coaching with deterministic nudge selection.

### Scope

- fixed nudge taxonomy
- fixed message library
- rolling feature bundle
- cooldowns
- suppression rules
- scenario-specific triggers

### Success criteria

- average nudge rate stays under the target budget
- repeated nudges are suppressed
- obvious issues are caught consistently
- weak situations prefer silence over bad nudges

## Phase 3: Prompt-Guided Enrichment

### Goal

Use models narrowly for ambiguity, not for the whole live loop.

### Scope

- prompt for hedging score
- prompt for directness score
- prompt for objective-hit detection
- keep output structured and constrained

### Success criteria

- enriched scores improve human-rated nudge relevance
- latency remains acceptable
- prompt failures degrade safely to deterministic behavior

## Phase 4: End-to-End Quality Sweep

### Goal

Verify that the full product experience feels better, not just isolated components.

### Scope

- manual scenario walkthroughs
- repeated session tests
- prompt comparisons
- nudge usefulness review

### Success criteria

- internal testers rate live feedback as mostly helpful or neutral
- false-positive nudges are clearly reduced
- the system remains stable over repeated sessions

## Evaluation Framework

## A. Transcription

Measure:

- transcript correctness
- transcript latency
- turn segmentation quality

Test set:

- 20 to 30 short internal mock sessions
- include sales, VC pitch, and hard conversation
- include fast speech, interruptions, and hesitation

Review questions:

- did the transcript capture the important words?
- did the transcript arrive in time to matter?
- were user and agent turns separated correctly?

## B. Prompt Quality

Measure:

- correct issue selection
- output brevity
- actionability
- false-positive rate

Test set:

- fixed transcript windows with expected issue labels

Review questions:

- did the prompt identify the biggest issue?
- was the output short enough?
- should the system have stayed silent instead?

## C. Policy Quality

Measure:

- nudge precision
- duplicate suppression
- cooldown behavior
- scenario relevance

Test set:

- replayable feature bundles derived from real sessions

Review questions:

- did the policy show a nudge only when needed?
- did it choose the right category?
- did it avoid repeating itself?

## D. End-to-End Experience

Measure:

- user-perceived usefulness
- annoyance rate
- visible latency
- overall smoothness

Test set:

- real full-session practice runs

Review questions:

- did the feedback help in the moment?
- was it distracting?
- did it arrive too late?

## E2E Test Strategy

## Test layers

### 1. Unit-level policy tests

Create deterministic cases for:

- fast pace
- low energy
- heavy hedging
- repeated objection without direct answer
- missing CTA
- empathy gap in hard conversation

These should test only the policy engine.

### 2. Integration tests for event flow

Validate:

- transcript ingestion
- acoustic payload ingestion
- cooldown logic
- no nudge while agent speaking
- session reset between runs

These should test the Durable Object behavior and browser event mapping.

### 3. Replay-based E2E tests

Build fixtures from captured sessions:

- transcript sequence
- timestamps
- acoustic snapshots

Replay them through the live-feedback pipeline and assert:

- expected nudges appear
- unexpected nudges do not appear
- nudge timing falls inside acceptable windows

### 4. Manual E2E runs

For every promoted change:

- run one sales scenario
- run one VC pitch scenario
- run one hard conversation scenario

Record:

- transcript quality
- nudge quality
- timing issues
- regressions

## Promotion Gates

Do not move to the next phase until the current phase is verified.

### Phase 1 gate

- event timing is stable
- transcript duplication is controlled
- session lifecycle is reliable

### Phase 2 gate

- deterministic policy behaves predictably
- no obvious over-nudging
- scenario-specific rules work in replay tests

### Phase 3 gate

- prompts improve relevance without hurting latency or stability

### Phase 4 gate

- live feedback is materially better in internal manual sessions

## Deliverables

At the end of this workstream, the repo should contain:

- one product-facing feature spec
- one delivery spec
- one task tracker
- policy tests
- replay fixtures
- a simple E2E checklist for manual verification

## Immediate Next Steps

1. Land the delivery docs and task tracker.
2. Add baseline instrumentation tasks.
3. Implement deterministic nudge taxonomy and policy.
4. Create the first replayable fixture set.
5. Add manual E2E checklist and promotion gates.
