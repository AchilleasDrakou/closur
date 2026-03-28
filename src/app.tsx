import { useState, useCallback } from "react";
import { useAgent } from "agents/react";
import { PracticeArena, type SessionData } from "./components/PracticeArena";

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
  const [lastSession, setLastSession] = useState<SessionData | null>(null);

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
            <PracticeArena
              scenario={selectedScenario}
              onEnd={(data) => {
                setLastSession(data);
                setView("review");
              }}
            />
          )}
          {view === "review" && (
            <ReviewView session={lastSession} onBack={() => setView("scenarios")} />
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

// ── Review View ───────────────────────────────────────────────────────

function ReviewView({ session, onBack }: { session: SessionData | null; onBack: () => void }) {
  const [exportText, setExportText] = useState("");

  const generateExport = useCallback(() => {
    if (!session) return;

    const duration = Math.round(session.duration / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    const avgEnergy = session.acousticData.length > 0
      ? (session.acousticData.reduce((s, d) => s + d.energy, 0) / session.acousticData.length * 100).toFixed(0)
      : "N/A";

    let md = `# Session Review\n\n`;
    md += `**Duration:** ${minutes}m ${seconds}s\n`;
    md += `**Avg Energy:** ${avgEnergy}%\n`;
    md += `**Transcript turns:** ${session.transcript.length}\n\n`;
    md += `## Transcript\n\n`;

    for (const t of session.transcript) {
      md += `**${t.role === "user" ? "You" : "Them"}:** ${t.text}\n\n`;
    }

    if (session.nudges.length > 0) {
      md += `## Coaching Notes\n\n`;
      for (const n of session.nudges) {
        md += `- [${n.urgency}] ${n.text}\n`;
      }
    }

    setExportText(md);
  }, [session]);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(exportText);
  }, [exportText]);

  const openInClaude = useCallback(() => {
    const prompt = encodeURIComponent(
      `I just had a practice conversation. Here's the transcript and coaching notes. Give me specific feedback on how to improve:\n\n${exportText}`
    );
    window.open(`https://claude.ai/new?q=${prompt}`, "_blank");
  }, [exportText]);

  if (!session) {
    return (
      <div className="review-view">
        <h2 className="view-title">SESSION REVIEW</h2>
        <div className="review-placeholder">
          <p>No session data. Complete a practice session first.</p>
          <button className="back-btn" onClick={onBack}>BACK TO SCENARIOS</button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-view">
      <h2 className="view-title">SESSION REVIEW</h2>

      <div className="review-stats">
        <div className="stat-card">
          <div className="stat-value">{Math.round(session.duration / 1000)}s</div>
          <div className="stat-label">DURATION</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{session.transcript.length}</div>
          <div className="stat-label">TURNS</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {session.acousticData.length > 0
              ? (session.acousticData.reduce((s, d) => s + d.energy, 0) / session.acousticData.length * 100).toFixed(0) + "%"
              : "—"}
          </div>
          <div className="stat-label">AVG ENERGY</div>
        </div>
      </div>

      {/* Transcript */}
      <div className="review-transcript">
        <div className="panel-header">TRANSCRIPT</div>
        {session.transcript.map((t, i) => (
          <div key={i} className={`transcript-line transcript-${t.role}`}>
            <span className="transcript-role">{t.role === "user" ? "YOU" : "THEM"}</span>
            <span className="transcript-text">{t.text}</span>
          </div>
        ))}
      </div>

      {/* Export */}
      <div className="export-section">
        <div className="panel-header">EXPORT</div>
        <div className="export-buttons">
          <button className="export-btn" onClick={generateExport}>GENERATE MARKDOWN</button>
          {exportText && (
            <>
              <button className="export-btn" onClick={copyToClipboard}>COPY</button>
              <button className="export-btn export-claude" onClick={openInClaude}>OPEN IN CLAUDE</button>
            </>
          )}
        </div>
        {exportText && (
          <pre className="export-preview">{exportText}</pre>
        )}
      </div>

      <button className="back-btn" onClick={onBack}>BACK TO SCENARIOS</button>
    </div>
  );
}
