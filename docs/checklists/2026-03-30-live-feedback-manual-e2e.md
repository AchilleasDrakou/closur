# Live Feedback Manual E2E Checklist

## Purpose

Use this checklist before promoting live-feedback changes.

The goal is to catch regressions that replay fixtures will miss:

- transcript timing issues
- agent turn-boundary issues
- distracting live nudges
- scenario-specific coaching mistakes

## Test Setup

- Use headphones to reduce echo.
- Start with a fresh session.
- Keep the browser console open.
- After each run, inspect the live event timeline from the CoachAgent.
- Record whether each shown nudge was helpful, neutral, or distracting.

## Scenario 1: Sales Pitch

- Start the sales scenario.
- Give a rushed answer with a pricing objection.
- Confirm the system nudges for the objection or pace, not random encouragement.
- Confirm no nudge appears while the agent is speaking.
- Confirm repeated pricing answers do not create duplicate nudges inside the cooldown window.

Pass if:
- the transcript captures the objection language
- the shown nudge is relevant
- no duplicate or late nudge appears

## Scenario 2: VC Pitch

- Start the VC pitch scenario.
- Give a broad, vague market story without specifics.
- Confirm the system asks for specificity instead of generic confidence advice.
- Repeat the same vague answer once.
- Confirm the second nudge is suppressed by cooldown or duplicate protection.

Pass if:
- the live nudge is short and specific
- the system does not spam the same advice
- the session remains smooth while the agent speaks back

## Scenario 3: Hard Conversation

- Start the hard-conversation scenario.
- Give a tense answer with low empathy.
- Confirm the system nudges for empathy or firmness, not sales-oriented advice.
- Pause for a few seconds and resume.
- Confirm the session still tracks voice starts and stops cleanly.

Pass if:
- the nudge matches the scenario
- pause handling does not produce noisy nudges
- the user can recover cleanly after silence

## Review Log

For each run, record:

- scenario
- transcript issue, if any
- expected nudge
- shown nudge
- timing issue, if any
- overall rating: helpful, neutral, or distracting

## Promotion Gate

Do not promote a live-feedback change unless:

- all three scenarios complete without session-state bugs
- shown nudges are mostly helpful or neutral
- no agent-speaking overlap bug appears
- no obvious duplicate-nudge spam appears
