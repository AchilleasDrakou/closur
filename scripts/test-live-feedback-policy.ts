import assert from "node:assert/strict";
import { checkAcousticNudges, evaluateLiveNudgePolicy } from "../src/lib/nudge-engine";
import { liveFeedbackPolicyCases } from "../test_configs/live-feedback-policy-cases";

for (const testCase of liveFeedbackPolicyCases) {
  const nudges = testCase.kind === "acoustic"
    ? checkAcousticNudges(testCase.input)
    : evaluateLiveNudgePolicy(testCase.input);

  const first = nudges[0]?.type;
  assert.equal(first, testCase.expected, `Case ${testCase.id} expected ${testCase.expected} but got ${first ?? "none"}.`);
  console.log(`PASS ${testCase.id} -> ${testCase.expected}`);
}
