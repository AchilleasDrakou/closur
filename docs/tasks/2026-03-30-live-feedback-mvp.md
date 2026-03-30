# Live Feedback MVP Tasks

## Purpose

Track the live-feedback workstream from planning through implementation and verification.

This file should be updated as tasks move from planned to verified.

Related docs:

- [Feature spec](/Users/achilleasdrakou/Documents/GitHub/closur/context/specs/2026-03-30-feat-live-feedback-mvp.md)
- [Delivery spec](/Users/achilleasdrakou/Documents/GitHub/closur/docs/specs/2026-03-30-live-feedback-delivery-spec.md)

## Status Key

- `planned`
- `in_progress`
- `blocked`
- `done`
- `verified`

## Workstream Summary

Current focus:

- run the replay and policy harness against captured sessions
- tune transcript quality and structured prompt enrichment
- expand fixture coverage as new live-feedback failures appear

## Tasks

### Task 0: Feature spec for live feedback MVP

- Status: `done`
- Output:
  - [context/specs/2026-03-30-feat-live-feedback-mvp.md](/Users/achilleasdrakou/Documents/GitHub/closur/context/specs/2026-03-30-feat-live-feedback-mvp.md)
- Notes:
  - defines taxonomy, architecture, and acceptance criteria

### Task 1: Delivery spec and E2E strategy

- Status: `done`
- Output:
  - [docs/specs/2026-03-30-live-feedback-delivery-spec.md](/Users/achilleasdrakou/Documents/GitHub/closur/docs/specs/2026-03-30-live-feedback-delivery-spec.md)
- Notes:
  - defines phase sequencing
  - defines evaluation and promotion gates
  - defines replay and manual E2E test strategy

### Task 2: Baseline instrumentation plan

- Status: `done`
- Goal:
  - log transcript, timing, shown nudges, and suppressed nudges
- Target files:
  - [src/server.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/server.ts)
  - [src/components/PracticeArena.tsx](/Users/achilleasdrakou/Documents/GitHub/closur/src/components/PracticeArena.tsx)
- Done means:
  - event and nudge timeline is observable in logs
- Notes:
  - adds `live_events` storage in the CoachAgent Durable Object
  - records session lifecycle, transcript events, agent speaking state, shown nudges, and cooldown suppressions
  - adds `getLiveEventTimeline` for inspection

### Task 3: Deterministic nudge taxonomy in code

- Status: `done`
- Goal:
  - replace freeform live nudges with fixed nudge types and fixed copy
- Target files:
  - [src/lib/nudge-engine.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/lib/nudge-engine.ts)
  - [src/server.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/server.ts)
- Done means:
  - live policy chooses categories instead of arbitrary text
- Notes:
  - adds `NudgeType`, fixed copy, and `evaluateLiveNudgePolicy`
  - keeps Workers AI for structured transcript analysis only
  - emits only the top deterministic live nudge instead of freeform coaching text

### Task 4: Cooldown and suppression logic

- Status: `done`
- Goal:
  - prevent duplicate, late, or noisy nudges
- Target files:
  - [src/server.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/server.ts)
  - [src/lib/nudge-engine.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/lib/nudge-engine.ts)
- Done means:
  - no nudges while agent is speaking
  - no immediate duplicate nudges
  - silence is preferred over low-confidence nudges
- Notes:
  - centralizes suppression in the CoachAgent
  - suppresses nudges while the agent is speaking
  - suppresses by cooldown and duplicate type
  - records suppression reasons in `live_events`

### Task 5: Richer browser signal bundle

- Status: `done`
- Goal:
  - send filler count, pause count, utterance duration, and transcript metadata
- Target files:
  - [src/components/PracticeArena.tsx](/Users/achilleasdrakou/Documents/GitHub/closur/src/components/PracticeArena.tsx)
  - [src/server.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/server.ts)
- Done means:
  - live policy receives a richer feature bundle than pace/energy/pitch alone
- Notes:
  - extends browser acoustic payloads with pause count, filler count, transcript length, and utterance duration
  - tracks transcript filler density from the latest user transcript window
  - keeps the richer signal bundle flowing into the Durable Object for later replay and policy tuning

### Task 6: Replay fixtures for live-feedback E2E

- Status: `done`
- Goal:
  - create replayable fixtures from real or mock sessions
- Target output:
  - [test_configs/live-feedback-fixtures.ts](/Users/achilleasdrakou/Documents/GitHub/closur/test_configs/live-feedback-fixtures.ts)
  - [src/lib/live-feedback-replay.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/lib/live-feedback-replay.ts)
  - [scripts/replay-live-feedback.ts](/Users/achilleasdrakou/Documents/GitHub/closur/scripts/replay-live-feedback.ts)
- Done means:
  - at least one sales, one VC, and one hard-conversation fixture can be replayed
- Notes:
  - adds a replay helper that applies the same live policy and suppression rules used in the product
  - adds three scenario fixtures covering sales, VC, and hard-conversation flows
  - adds a script entry point for replaying the fixtures in one pass

### Task 7: Policy tests

- Status: `done`
- Goal:
  - create deterministic tests for key nudge decisions
- Coverage:
  - pace fast
  - low energy
  - hedging
  - rambling
  - missed direct answer
  - missing ask
- Output:
  - [test_configs/live-feedback-policy-cases.ts](/Users/achilleasdrakou/Documents/GitHub/closur/test_configs/live-feedback-policy-cases.ts)
  - [scripts/test-live-feedback-policy.ts](/Users/achilleasdrakou/Documents/GitHub/closur/scripts/test-live-feedback-policy.ts)
- Done means:
  - policy logic is testable without a live browser session
- Notes:
  - covers both acoustic and transcript-driven policy paths
  - asserts the top-ranked deterministic nudge for each core case

### Task 8: Manual E2E checklist

- Status: `done`
- Goal:
  - define a repeatable manual verification flow before promotion
- Output:
  - [docs/checklists/2026-03-30-live-feedback-manual-e2e.md](/Users/achilleasdrakou/Documents/GitHub/closur/docs/checklists/2026-03-30-live-feedback-manual-e2e.md)
- Done means:
  - one checklist covers sales, VC, and hard-conversation sessions
- Notes:
  - includes scenario-by-scenario pass criteria
  - captures transcript timing, nudge usefulness, and overlap bugs

## Verification Log

### 2026-03-30

- Added feature spec for live-feedback MVP.
- Added delivery spec for implementation order and E2E testing.
- Added this task tracker as the execution log.
- Implemented baseline instrumentation for live feedback timeline and nudge observability.
- Implemented deterministic nudge taxonomy and policy selection in code.
- Implemented centralized cooldown and suppression logic for live nudges.
- Implemented richer browser signal payloads for pauses, fillers, transcript length, and utterance duration.
- Added replay helpers and three replayable live-feedback fixtures.
- Added the manual E2E checklist for sales, VC, and hard-conversation runs.
- Added deterministic policy cases and a policy test runner.
- Verified `bun run lint` passes.
- Verified `bun run test:live-feedback-policy` passes all six policy cases.
- Verified `bun run replay:live-feedback` passes all three replay fixtures.
- Verified `bun run check` still fails on pre-existing repo-wide `oxfmt --check` drift outside the live-feedback changes.

## Next Recommended Task

Run the replay and policy scripts against real captured sessions, then start prompt and transcript-quality tuning.

Reason:

- the core live-feedback scaffolding is now in place
- the next leverage is tuning transcript quality, prompt enrichment, and real captured-session coverage against this harness
