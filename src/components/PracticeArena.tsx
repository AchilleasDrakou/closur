import { useState, useCallback, useRef, useEffect } from "react";
import { useConversation } from "@elevenlabs/react";
import { useAgent } from "agents/react";

interface Scenario {
  id: string;
  name: string;
  description: string;
  persona: string;
  tone: string;
  objectives: string[];
  scoring: string[];
}

interface Nudge {
  text: string;
  urgency: "info" | "warning" | "positive";
  timestamp: number;
}

interface AcousticData {
  pitch: number;
  energy: number;
  pace: number;
  timestamp: number;
}

interface PracticeArenaProps {
  scenario: Scenario;
  onEnd: (sessionData: SessionData) => void;
}

export interface SessionData {
  transcript: Array<{ role: "user" | "agent"; text: string; timestamp: number }>;
  acousticData: AcousticData[];
  nudges: Nudge[];
  duration: number;
}

export function PracticeArena({ scenario, onEnd }: PracticeArenaProps) {
  const [isActive, setIsActive] = useState(false);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [transcript, setTranscript] = useState<SessionData["transcript"]>([]);
  const [acousticData, setAcousticData] = useState<AcousticData[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const startTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const acousticSendInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAcousticRef = useRef<AcousticData | null>(null);

  // Connect to CoachAgent DO
  const agent = useAgent({
    agent: "CoachAgent",
    onMessage: (message: unknown) => {
      try {
        const msg = typeof message === "string" ? JSON.parse(message) : (message as { data?: string });
        const data = typeof msg.data === "string" ? JSON.parse(msg.data) : msg;
        if (data.type === "nudge" && data.nudge) {
          addNudge(data.nudge.text, data.nudge.urgency);
        }
      } catch {
        // ignore parse errors
      }
    },
  });

  // ElevenLabs Conversational AI hook
  const conversation = useConversation({
    onConnect: () => {
      console.log("[Closur] Connected to ElevenLabs");
      addNudge("Connected. Start speaking.", "positive");
    },
    onDisconnect: () => {
      console.log("[Closur] Disconnected");
    },
    onMessage: (message: { source: string; message: string }) => {
      const now = Date.now();
      if (message.source === "user") {
        setTranscript((prev) => [...prev, { role: "user", text: message.message, timestamp: now }]);
        // Analyze user speech for coaching nudges
        if (message.message.trim().length > 10) {
          agent.call("analyzeTranscript", [message.message]).catch(console.error);
        }
      } else if (message.source === "ai") {
        setTranscript((prev) => [...prev, { role: "agent", text: message.message, timestamp: now }]);
      }
    },
    onError: (error: Error) => {
      console.error("[Closur] ElevenLabs error:", error);
      addNudge("Connection error. Try again.", "warning");
    },
    onModeChange: (mode: { mode: "speaking" | "listening" }) => {
      setAgentSpeaking(mode.mode === "speaking");
    },
  });

  const addNudge = useCallback((text: string, urgency: Nudge["urgency"]) => {
    const nudge: Nudge = { text, urgency, timestamp: Date.now() };
    setNudges((prev) => [...prev.slice(-4), nudge]);
    // Auto-remove after 5s
    setTimeout(() => {
      setNudges((prev) => prev.filter((n) => n !== nudge));
    }, 5000);
  }, []);

  // Web Audio API — extract acoustic features
  const startAudioAnalysis = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      const freqArray = new Uint8Array(bufferLength);

      let lastVoiceTime = Date.now();
      let wordCount = 0;

      const analyze = () => {
        analyser.getFloatTimeDomainData(dataArray);
        analyser.getByteFrequencyData(freqArray);

        // RMS energy
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const energy = Math.min(rms * 10, 1); // normalize 0-1

        // Pitch estimation (autocorrelation)
        let bestCorrelation = 0;
        let bestOffset = -1;
        for (let offset = 20; offset < bufferLength / 2; offset++) {
          let correlation = 0;
          for (let i = 0; i < bufferLength / 2; i++) {
            correlation += dataArray[i] * dataArray[i + offset];
          }
          if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestOffset = offset;
          }
        }
        const pitch = bestOffset > 0 ? ctx.sampleRate / bestOffset : 0;

        // Voice activity detection (simple threshold)
        const isVoiceActive = energy > 0.02;
        if (isVoiceActive) {
          wordCount++;
          lastVoiceTime = Date.now();
        }

        // Speaking pace (approximate WPM based on voice activity bursts)
        const elapsed = (Date.now() - startTimeRef.current) / 60000; // minutes
        const pace = elapsed > 0.1 ? Math.min(wordCount / elapsed / 10, 1) : 0; // normalized

        const data: AcousticData = {
          pitch: Math.min(pitch / 500, 1), // normalize 0-1
          energy,
          pace,
          timestamp: Date.now(),
        };

        setAcousticData((prev) => [...prev, data]);
        lastAcousticRef.current = data;

        animFrameRef.current = requestAnimationFrame(analyze);
      };

      // Sample at ~10fps instead of every frame
      const sampleLoop = () => {
        analyze();
        setTimeout(() => {
          if (analyserRef.current) sampleLoop();
        }, 100);
      };
      sampleLoop();
    } catch (err) {
      console.error("Failed to start audio analysis:", err);
    }
  }, []);

  const stopAudioAnalysis = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    analyserRef.current = null;
    audioContextRef.current = null;
    mediaStreamRef.current = null;
  }, []);

  // Start session
  const startSession = useCallback(async () => {
    setIsActive(true);
    startTimeRef.current = Date.now();
    setTranscript([]);
    setAcousticData([]);
    setNudges([]);

    // Set scenario on the CoachAgent
    agent.call("setScenario", [scenario]).catch(console.error);

    // Start audio analysis
    await startAudioAnalysis();

    // Periodically send acoustic data to the agent (every 2s)
    acousticSendInterval.current = setInterval(() => {
      const latest = lastAcousticRef.current;
      if (latest) {
        agent.call("sendAcousticData", [latest]).catch(console.error);
      }
    }, 2000);

    // Start ElevenLabs conversation
    try {
      const res = await fetch("/api/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id }),
      });
      const config = await res.json();

      if (config.signedUrl) {
        await conversation.startSession({ signedUrl: config.signedUrl });
      } else if (config.agentId) {
        await conversation.startSession({ agentId: config.agentId });
      } else {
        addNudge("No ElevenLabs agent configured. Set ELEVENLABS_AGENT_ID.", "warning");
      }
    } catch (err) {
      console.error("Failed to start ElevenLabs session:", err);
      addNudge("Failed to connect to voice agent.", "warning");
    }
  }, [scenario, conversation, startAudioAnalysis, addNudge, agent]);

  // End session
  const endSession = useCallback(async () => {
    await conversation.endSession();
    stopAudioAnalysis();
    if (acousticSendInterval.current) {
      clearInterval(acousticSendInterval.current);
      acousticSendInterval.current = null;
    }

    const duration = Date.now() - startTimeRef.current;
    setIsActive(false);

    onEnd({
      transcript,
      acousticData,
      nudges,
      duration,
    });
  }, [conversation, stopAudioAnalysis, transcript, acousticData, nudges, onEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioAnalysis();
      if (acousticSendInterval.current) {
        clearInterval(acousticSendInterval.current);
      }
    };
  }, [stopAudioAnalysis]);

  return (
    <div className="practice-view">
      <div className="practice-header">
        <h2 className="view-title">{scenario.name}</h2>
        <span className="scenario-tone">{scenario.tone}</span>
        {isActive && (
          <span className={`status-indicator ${agentSpeaking ? "speaking" : "listening"}`}>
            {agentSpeaking ? "AGENT SPEAKING" : "LISTENING..."}
          </span>
        )}
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
            {nudges.map((n, i) => (
              <div key={`${n.timestamp}-${i}`} className={`nudge nudge-${n.urgency}`}>
                {n.text}
              </div>
            ))}
          </div>

          {/* Live transcript */}
          <div className="live-transcript">
            <div className="panel-header">TRANSCRIPT</div>
            <div className="transcript-scroll">
              {transcript.map((t, i) => (
                <div key={i} className={`transcript-line transcript-${t.role}`}>
                  <span className="transcript-role">{t.role === "user" ? "YOU" : "THEM"}</span>
                  <span className="transcript-text">{t.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Viz placeholder — will be replaced with Three.js */}
          <div className="viz-container">
            <div className="viz-placeholder">
              {acousticData.length > 0
                ? `ENERGY: ${(acousticData[acousticData.length - 1].energy * 100).toFixed(0)}% | PITCH: ${(acousticData[acousticData.length - 1].pitch * 500).toFixed(0)}Hz`
                : "3D VISUALIZATION — waiting for audio..."}
            </div>
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
