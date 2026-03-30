import { evaluateReplayExpectations, replayLiveFeedbackFixture } from "../src/lib/live-feedback-replay";
import { liveFeedbackFixtures } from "../test_configs/live-feedback-fixtures";

let hasFailure = false;

for (const fixture of liveFeedbackFixtures) {
  const result = replayLiveFeedbackFixture(fixture);
  const evaluation = evaluateReplayExpectations(fixture, result);

  console.log(`\nFixture: ${fixture.id}`);
  console.log(`Description: ${fixture.description}`);
  console.log(`Shown nudges: ${result.shown.map((nudge) => `${nudge.type}@${nudge.timestamp}`).join(", ") || "none"}`);
  console.log(`Suppressed nudges: ${result.suppressed.map((nudge) => `${nudge.type}:${nudge.reason}@${nudge.timestamp}`).join(", ") || "none"}`);

  if (!evaluation.ok) {
    hasFailure = true;
    for (const error of evaluation.errors) {
      console.error(`FAIL: ${error}`);
    }
  } else {
    console.log("PASS");
  }
}

if (hasFailure) {
  process.exitCode = 1;
}
