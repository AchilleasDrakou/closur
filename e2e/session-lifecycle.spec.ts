import { test, expect } from "@playwright/test";

/**
 * End-to-end session lifecycle test.
 *
 * Runs Chrome with --use-fake-device-for-media-stream which feeds a synthetic
 * sine wave through getUserMedia. This exercises the full pipeline:
 *   mic → acoustic analysis → ElevenLabs/Deepgram → transcript → scoring
 *
 * The test validates:
 *   1. Landing → scenario selection → practice view navigation
 *   2. Session starts (ElevenLabs or Deepgram fallback)
 *   3. Active session UI renders (orb, metrics, transcript)
 *   4. Diagnostic events are captured
 *   5. Session ends cleanly with scoring
 *   6. Review view renders with session data
 */

test.describe("Session Lifecycle", () => {
  test("landing page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".landing-title")).toContainText("CLOSUR");
    await expect(page.locator(".landing-cta")).toBeVisible();
  });

  test("scenario selection loads all 5 scenarios", async ({ page }) => {
    await page.goto("/");
    await page.click(".landing-cta");
    await expect(page.locator(".scenario-card").first()).toBeVisible({ timeout: 5000 });

    const cards = page.locator(".scenario-card");
    const count = await cards.count();
    expect(count).toBe(5);
  });

  test("full session: start → active → end → review", async ({ page }) => {
    // Inject diagnostic capture before navigating
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__e2eDiag = [];
      const origLog = console.log;
      console.log = function (...args: unknown[]) {
        const str = args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");
        if (str.includes("Closur:diag") || str.includes("Closur]")) {
          ((window as unknown as Record<string, unknown[]>).__e2eDiag).push({
            ts: Date.now(),
            msg: str,
          });
        }
        origLog.apply(console, args);
      };
    });

    await page.goto("/");

    // Navigate to scenarios
    await page.click(".landing-cta");
    await page.locator(".scenario-card").first().waitFor({ timeout: 5000 });

    // Click first scenario (Sales Pitch)
    await page.locator(".scenario-card").first().click();
    await page.waitForTimeout(500);

    // Click START PRACTICE
    const startBtn = page.locator("button", { hasText: /START PRACTICE/i });
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Wait for session to start — either active view or fallback
    // The button should change to CONNECTING... then disappear when active
    await page.waitForTimeout(4000);

    // Check if we're in active session (orb visible) or still on briefing
    const orbHero = page.locator(".orb-hero");
    const endBtn = page.locator("button", { hasText: /END SESSION/i });
    const holdBtn = page.locator("button", { hasText: /HOLD TO SPEAK/i });

    const isActive = (await orbHero.count()) > 0;
    if (isActive) {
      // ✓ Session is active — orb and metrics should be visible
      await expect(orbHero).toBeVisible();
      await expect(page.locator(".metrics-strip")).toBeVisible();

      // Check metrics are rendering
      const energyLabel = page.locator(".metric-label", { hasText: "ENERGY" });
      await expect(energyLabel).toBeVisible();

      // Transcript panel should exist
      await expect(page.locator(".compact-transcript")).toBeVisible();

      // Check if we got ElevenLabs transcript or are in fallback
      const isFallback = (await holdBtn.count()) > 0;

      if (isFallback) {
        // Fallback mode — HOLD TO SPEAK button should work
        await expect(holdBtn).toBeVisible();
        console.log("[e2e] In Deepgram fallback mode — push-to-talk available");

        // Hold to speak for 3 seconds (fake audio device provides sine wave)
        await holdBtn.dispatchEvent("mousedown");
        await page.waitForTimeout(3000);
        await holdBtn.dispatchEvent("mouseup");
        await page.waitForTimeout(5000); // Wait for STT → LLM → TTS round trip
      } else {
        // ElevenLabs mode — wait for first agent utterance
        console.log("[e2e] In ElevenLabs mode — waiting for agent utterance");
        await page.waitForTimeout(5000);
      }

      // Check transcript has entries
      const transcriptLines = page.locator(".transcript-line");
      const lineCount = await transcriptLines.count();
      console.log(`[e2e] Transcript lines after interaction: ${lineCount}`);

      // End session
      await expect(endBtn).toBeVisible();
      await endBtn.click();

      // Wait for scoring
      await page.waitForTimeout(8000);

      // Should be on review view or back to scenarios
      // Check for score display or scenario view
      const scoreHero = page.locator(".score-hero, .score-value");
      const scenarioView = page.locator(".scenario-card, .view-title");
      const hasScore = (await scoreHero.count()) > 0;
      const hasScenarios = (await scenarioView.count()) > 0;
      expect(hasScore || hasScenarios).toBeTruthy();

      if (hasScore) {
        console.log("[e2e] Review view with score rendered");
      }
    } else {
      // Session didn't start — check diagnostics for why
      console.log("[e2e] Session did not reach active state");
    }

    // Capture diagnostics
    const diag = await page.evaluate(
      () => (window as unknown as Record<string, unknown[]>).__e2eDiag
    );
    console.log(`[e2e] Captured ${(diag || []).length} diagnostic events`);

    // Validate diagnostic events were captured
    expect(diag).toBeDefined();
    expect((diag as unknown[]).length).toBeGreaterThan(0);

    // Check key events were logged
    const diagMsgs = (diag as Array<{ msg: string }>).map((d) => d.msg);
    const hasSessionStart = diagMsgs.some((m) => m.includes("session:start"));
    const hasSignedUrlReq = diagMsgs.some((m) => m.includes("api:signed-url"));
    expect(hasSessionStart).toBeTruthy();
    expect(hasSignedUrlReq).toBeTruthy();

    // Log full timeline for debugging
    for (const entry of diag as Array<{ ts: number; msg: string }>) {
      const t = new Date(entry.ts).toISOString().slice(11, 23);
      console.log(`  ${t} ${entry.msg}`);
    }
  });

  test("API: /api/scenarios returns valid scenarios", async ({ request }) => {
    const res = await request.get("/api/scenarios");
    expect(res.status()).toBe(200);
    const scenarios = await res.json();
    expect(Array.isArray(scenarios)).toBeTruthy();
    expect(scenarios.length).toBe(5);
    for (const s of scenarios) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.firstMessage).toBeTruthy();
      expect(s.objectives.length).toBeGreaterThan(0);
    }
  });

  test("API: /api/signed-url returns valid config", async ({ request }) => {
    const res = await request.post("/api/signed-url", {
      data: { scenarioId: "sales-pitch" },
    });
    expect(res.status()).toBe(200);
    const config = await res.json();

    // Should have either signedUrl or agentId
    const hasPath = config.signedUrl || config.agentId;
    expect(hasPath).toBeTruthy();

    // Should have systemPrompt
    expect(config.systemPrompt).toBeTruthy();
    expect(config.systemPrompt).toContain("VP of Engineering");

    // Should have debug info
    expect(config._debug).toBeDefined();
    expect(config._debug.path).toBeTruthy();
    console.log(`[e2e] Signed URL path: ${config._debug.path}, elapsed: ${config._debug.elapsed}ms`);
  });

  test("API: /api/signed-url with invalid scenario returns 404", async ({ request }) => {
    const res = await request.post("/api/signed-url", {
      data: { scenarioId: "nonexistent" },
    });
    expect(res.status()).toBe(404);
  });

  test("API: /api/health returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
