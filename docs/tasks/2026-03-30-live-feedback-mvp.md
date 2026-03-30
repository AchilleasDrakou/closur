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

- define the implementation sequence
- define the test strategy
- prepare for deterministic live nudge policy work

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

- Status: `planned`
- Goal:
  - log transcript, timing, shown nudges, and suppressed nudges
- Target files:
  - [src/server.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/server.ts)
  - [src/components/PracticeArena.tsx](/Users/achilleasdrakou/Documents/GitHub/closur/src/components/PracticeArena.tsx)
- Done means:
  - event and nudge timeline is observable in logs

### Task 3: Deterministic nudge taxonomy in code

- Status: `planned`
- Goal:
  - replace freeform live nudges with fixed nudge types and fixed copy
- Target files:
  - [src/lib/nudge-engine.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/lib/nudge-engine.ts)
  - [src/server.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/server.ts)
- Done means:
  - live policy chooses categories instead of arbitrary text

### Task 4: Cooldown and suppression logic

- Status: `planned`
- Goal:
  - prevent duplicate, late, or noisy nudges
- Target files:
  - [src/server.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/server.ts)
  - [src/lib/nudge-engine.ts](/Users/achilleasdrakou/Documents/GitHub/closur/src/lib/nudge-engine.ts)
- Done means:
  - no nudges while agent is speaking
  - no immediate duplicate nudges
  - silence is preferred over low-confidence nudges

### Task 5: Richer browser signal bundle

- Status: `planned`
- Goal:
  - send filler count, pause count, utterance duration, and transcript metadata
- Target files:
  - [src/components/PracticeArena.tsx](/Users/achilleasdrakou/Documents/GitHub/closur/src/components/PracticeArena.tsx)
- Done means:
  - live policy receives a richer feature bundle than pace/energy/pitch alone

### Task 6: Replay fixtures for live-feedback E2E

- Status: `planned`
- Goal:
  - create replayable fixtures from real or mock sessions
- Target output:
  - fixture files under a future `tests/fixtures/` or similar directory
- Done means:
  - at least one sales, one VC, and one hard-conversation fixture can be replayed

### Task 7: Policy tests

- Status: `planned`
- Goal:
  - create deterministic tests for key nudge decisions
- Coverage:
  - pace fast
  - low energy
  - hedging
  - rambling
  - missed direct answer
  - missing ask
- Done means:
  - policy logic is testable without a live browser session

### Task 8: Manual E2E checklist

- Status: `planned`
- Goal:
  - define a repeatable manual verification flow before promotion
- Done means:
  - one checklist covers sales, VC, and hard-conversation sessions

## Verification Log

### 2026-03-30

- Added feature spec for live-feedback MVP.
- Added delivery spec for implementation order and E2E testing.
- Added this task tracker as the execution log.

## Next Recommended Task

Start with `Task 2: Baseline instrumentation plan`.

Reason:

- it reduces guesswork
- it improves every later debugging pass
- it makes replay-based E2E tests possible
