import { useState, useCallback } from "react";
import { useAgent } from "agents/react";

// ── Types ─────────────────────────────────────────────────────────────

interface Scenario {
  id: string;
  name: string;
  description: string;
  persona: string;
  tone: string;
  objectives: string[];
  scoring: string[];
}

type View = "onboarding" | "scenarios" | "practice" | "review";

// ── App ───────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>("scenarios");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [productUrl, setProductUrl] = useState("");
  const [productProfile, setProductProfile] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Connect to CoachAgent DO
  const agent = useAgent({ agent: "CoachAgent" });

  // Load scenarios
  const loadScenarios = useCallback(async () => {
    const res = await fetch("/api/scenarios");
    const data = await res.json();
    setScenarios(data);
  }, []);

  // Scrape product URL
  const scrapeProduct = useCallback(async () => {
    if (!productUrl) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: productUrl }),
      });
      const data = await res.json();
      setProductProfile(data.profile);
    } catch (err) {
      console.error("Scrape failed:", err);
    }
    setIsLoading(false);
  }, [productUrl]);

  // Start practice session
  const startPractice = useCallback((scenario: Scenario) => {
    setSelectedScenario(scenario);
    setView("practice");
  }, []);

  // Load scenarios on mount
  useState(() => {
    loadScenarios();
  });

  return (
    <div className="app">
      {/* Top bar */}
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="logo">CLOSUR</span>
          <span className="tagline">the life you want is on the other side of a few hard conversations</span>
        </div>
        <nav className="top-bar-nav">
          <button className={view === "scenarios" ? "active" : ""} onClick={() => setView("scenarios")}>
            SCENARIOS
          </button>
          <button className={view === "onboarding" ? "active" : ""} onClick={() => setView("onboarding")}>
            CONTEXT
          </button>
        </nav>
      </header>

      {/* Main content */}
      <main className="main">
        {/* Left sidebar — session history */}
        <aside className="sidebar">
          <div className="panel-header">SESSION HISTORY</div>
          <div className="session-list">
            <div className="empty-state">No sessions yet. Pick a scenario and start practicing.</div>
          </div>
        </aside>

        {/* Main view */}
        <div className="content">
          {view === "scenarios" && (
            <ScenariosView
              scenarios={scenarios}
              onSelect={startPractice}
            />
          )}
          {view === "onboarding" && (
            <OnboardingView
              url={productUrl}
              setUrl={setProductUrl}
              profile={productProfile}
              onScrape={scrapeProduct}
              isLoading={isLoading}
            />
          )}
          {view === "practice" && selectedScenario && (
            <PracticeView
              scenario={selectedScenario}
              onEnd={() => setView("review")}
            />
          )}
          {view === "review" && (
            <ReviewView onBack={() => setView("scenarios")} />
          )}
        </div>
      </main>
    </div>
  );
}

// ── Scenarios View ────────────────────────────────────────────────────

function ScenariosView({ scenarios, onSelect }: { scenarios: Scenario[]; onSelect: (s: Scenario) => void }) {
  return (
    <div className="scenarios-view">
      <h2 className="view-title">CHOOSE YOUR CHALLENGE</h2>
      <div className="scenario-grid">
        {scenarios.map((s) => (
          <button key={s.id} className="scenario-card" onClick={() => onSelect(s)}>
            <div className="scenario-name">{s.name}</div>
            <div className="scenario-desc">{s.description}</div>
            <div className="scenario-objectives">
              {s.objectives.map((o, i) => (
                <span key={i} className="objective-tag">{o}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Onboarding View ───────────────────────────────────────────────────

function OnboardingView({
  url, setUrl, profile, onScrape, isLoading,
}: {
  url: string;
  setUrl: (u: string) => void;
  profile: Record<string, unknown> | null;
  onScrape: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="onboarding-view">
      <h2 className="view-title">ADD CONTEXT</h2>
      <p className="view-subtitle">Paste your product URL so the AI knows what you're selling</p>
      <div className="scrape-input">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourproduct.com"
          className="url-input"
        />
        <button onClick={onScrape} disabled={isLoading || !url} className="scrape-btn">
          {isLoading ? "SCANNING..." : "SCAN"}
        </button>
      </div>
      {profile && (
        <div className="product-profile">
          <h3>Product Profile</h3>
          <pre>{JSON.stringify(profile, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ── Practice View ─────────────────────────────────────────────────────

function PracticeView({ scenario, onEnd }: { scenario: Scenario; onEnd: () => void }) {
  const [isActive, setIsActive] = useState(false);
  const [nudges, setNudges] = useState<Array<{ text: string; urgency: string; timestamp: number }>>([]);

  const startSession = useCallback(() => {
    setIsActive(true);
    // TODO: Initialize ElevenLabs Conversational AI WebSocket
    // TODO: Initialize Web Audio API for acoustic features
  }, []);

  const endSession = useCallback(() => {
    setIsActive(false);
    // TODO: Close connections, generate scorecard
    onEnd();
  }, [onEnd]);

  return (
    <div className="practice-view">
      <div className="practice-header">
        <h2 className="view-title">{scenario.name}</h2>
        <span className="scenario-tone">{scenario.tone}</span>
      </div>

      {!isActive ? (
        <div className="practice-start">
          <div className="scenario-briefing">
            <h3>OBJECTIVES</h3>
            <ul>
              {scenario.objectives.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
          <button className="start-btn" onClick={startSession}>
            START PRACTICE
          </button>
        </div>
      ) : (
        <div className="practice-active">
          {/* Nudge overlay */}
          <div className="nudge-overlay">
            {nudges.slice(-3).map((n, i) => (
              <div key={i} className={`nudge nudge-${n.urgency}`}>
                {n.text}
              </div>
            ))}
          </div>

          {/* Viz placeholder */}
          <div className="viz-container">
            <div className="viz-placeholder">3D VISUALIZATION</div>
          </div>

          {/* Controls */}
          <div className="practice-controls">
            <button className="end-btn" onClick={endSession}>
              END SESSION
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Review View ───────────────────────────────────────────────────────

function ReviewView({ onBack }: { onBack: () => void }) {
  return (
    <div className="review-view">
      <h2 className="view-title">SESSION REVIEW</h2>
      <div className="review-placeholder">
        <p>Scorecard and export will appear here after a practice session.</p>
        <button className="back-btn" onClick={onBack}>BACK TO SCENARIOS</button>
      </div>
    </div>
  );
}
