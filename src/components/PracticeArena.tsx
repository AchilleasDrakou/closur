import { useState, useCallback, useRef, useEffect } from "react";
import { useConversation } from "@elevenlabs/react";
import { useAgent } from "agents/react";
import { AudioReactiveOrb } from "./AudioReactiveOrb";
import { CircularVisualizer } from "./CircularVisualizer";

interface Scenario {
  id: string;
  name: string;
  description: string;
  persona: string;
  firstMessage: string;
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
  speechActive: boolean;
  timestamp: number;
}

interface PracticeArenaProps {
  scenario: Scenario;
  productKey?: string | null;
  onEnd: (sessionData: SessionData) => void;
}

export interface SessionScore {
  overall: number;
  criteria: Array<{ name: string; score: number; feedback: string }>;
  summary: string;
  strengths: string[];
  improvements: string[];
  annotations: Array<{
    timestamp: number;
    type: "positive" | "negative" | "neutral";
    label: string;
    detail: string;
  }>;
}

export interface SessionData {
  transcript: Array<{
    role: "user" | "agent";
    text: string;
    timestamp: number;
  }>;
  acousticData: AcousticData[];
  nudges: Nudge[];
  duration: number;
  score?: SessionScore;
}

interface AgentConfigResponse {
  agentId: string;
  systemPrompt: string;
  signedUrl?: string;
  _debug?: { path: string; status?: number; elapsed?: number; error?: string };
}

interface DiagnosticEvent {
  ts: number;
  event: string;
  detail?: unknown;
}

function createDiagnostics() {
  const events: DiagnosticEvent[] = [];
  return {
    log(event: string, detail?: unknown) {
      const entry = { ts: Date.now(), event, detail };
      events.push(entry);
      console.log(`[Closur:diag] ${event}`, detail ?? "");
    },
    events() { return events; },
    dump() {
      console.group("[Closur] Session Diagnostics");
      for (const e of events) {
        const t = new Date(e.ts).toISOString().slice(11, 23);
        console.log(`${t} ${e.event}`, e.detail ?? "");
      }
      console.groupEnd();
    },
  };
}

export function PracticeArena({
  scenario,
  productKey,
  onEnd
}: PracticeArenaProps) {
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [transcript, setTranscript] = useState<SessionData["transcript"]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const startTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const analysisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const acousticSendInterval = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const lastAcousticRef = useRef<AcousticData | null>(null);
  const hasConnectedRef = useRef(false);
  const isEndingSessionRef = useRef(false);
  const sessionRuntimeStartedRef = useRef(false);
  const hasInitiatedConnectionRef = useRef(false);
  const voiceFallbackRef = useRef(false);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const systemPromptRef = useRef<string>("");
  // Refs for latest values (fixes stale closure in endSession)
  const transcriptRef = useRef<SessionData["transcript"]>([]);
  const acousticRef = useRef<AcousticData[]>([]);
  const nudgesRef = useRef<Nudge[]>([]);
  const lastVizUpdate = useRef<number>(0);
  const [frequencyData, setFrequencyData] = useState<Uint8Array | null>(null);
  const [liveEnergy, setLiveEnergy] = useState(0);
  const [livePace, setLivePace] = useState(0);
  const [liveConfidence, setLiveConfidence] = useState(0);
  const diagRef = useRef(createDiagnostics());

  // Connect to CoachAgent DO
  const agent = useAgent({
    agent: "CoachAgent",
    onOpen: () => {
      diagRef.current.log("do:open");
    },
    onClose: (event: unknown) => {
      diagRef.current.log("do:close", event);
    },
    onError: (event: unknown) => {
      diagRef.current.log("do:error", event);
    },
    onMessage: (message: unknown) => {
      try {
        const msg =
          typeof message === "string"
            ? JSON.parse(message)
            : (message as { data?: string });
        const data = typeof msg.data === "string" ? JSON.parse(msg.data) : msg;
        if (data.type === "nudge" && data.nudge) {
          addNudge(data.nudge.text, data.nudge.urgency);
        }
      } catch {
        // ignore parse errors
      }
    }
  });

  const trackClientEvent = useCallback((type: string, payload?: Record<string, unknown>) => {
    agent.call("trackClientEvent", [{
      type,
      timestamp: Date.now(),
      payload,
    }]).catch(console.error);
  }, [agent]);

  // ElevenLabs Conversational AI hook
  const conversation = useConversation({
    onConnect: () => {
      diagRef.current.log("el:connected");
      hasConnectedRef.current = true;
      setIsStarting(false);
      setIsActive(true);
      addNudge("Connected. Start speaking.", "positive");
      startSessionRuntime();
    },
    onDisconnect: (details: unknown) => {
      diagRef.current.log("el:disconnected", details);
      setAgentSpeaking(false);
      // Detect quota exhaustion
      const d = details as Record<string, unknown> | undefined;
      const reason = String(d?.message || d?.closeReason || "");
      if (reason.toLowerCase().includes("quota")) {
        addNudge("ElevenLabs quota exceeded — switching to Deepgram voice.", "warning");
        voiceFallbackRef.current = true;
      }
    },
    onMessage: (message: unknown) => {
      try {
        const msg = message as Record<string, unknown>;
        const source = (msg.source || msg.role || "") as string;
        const text = (msg.message || msg.text || msg.content || "") as string;
        if (!text) return;
        const now = Date.now();
        if (source === "user" || source === "human") {
          const entry = { role: "user" as const, text, timestamp: now };
          transcriptRef.current = [...transcriptRef.current, entry];
          setTranscript([...transcriptRef.current]);
          lastTranscriptMetricsRef.current = {
            fillerCount: countFillers(text),
            transcriptChars: text.length,
          };
          trackClientEvent("user_transcript_received", {
            source,
            length: text.length,
            fillerCount: lastTranscriptMetricsRef.current.fillerCount,
            text: text.slice(0, 500),
          });
          if (text.trim().length > 10) {
            agent.call("analyzeTranscript", [text]).catch(console.error);
          }
        } else {
          const entry = { role: "agent" as const, text, timestamp: now };
          transcriptRef.current = [...transcriptRef.current, entry];
          setTranscript([...transcriptRef.current]);
          trackClientEvent("agent_transcript_received", {
            source,
            length: text.length,
            text: text.slice(0, 500),
          });
        }
      } catch {
        /* ignore malformed messages */
      }
    },
    onError: (error: unknown) => {
      diagRef.current.log("el:error", error instanceof Error ? error.message : error);
      const msg = error instanceof Error ? error.message : String(error);
      addNudge(`Error: ${msg.slice(0, 80)}`, "warning");
    },
    onStatusChange: (status: unknown) => {
      diagRef.current.log("el:status", status);
    },
    onDebug: (info: unknown) => {
      diagRef.current.log("el:debug", info);
    },
    onModeChange: (mode: { mode: "speaking" | "listening" }) => {
      setAgentSpeaking(mode.mode === "speaking");
    }
  });

  const addNudge = useCallback((text: string, urgency: Nudge["urgency"]) => {
    const nudge: Nudge = { text, urgency, timestamp: Date.now() };
    nudgesRef.current = [...nudgesRef.current.slice(-4), nudge];
    setNudges([...nudgesRef.current]);
    // Auto-remove from display after 5s
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
        if (isVoiceActive && !userVoiceActiveRef.current) {
          userVoiceActiveRef.current = true;
          utteranceStartRef.current = Date.now();
          trackClientEvent("user_voice_started", {
            energy,
            pitch: Math.min(pitch / 500, 1),
          });
        } else if (!isVoiceActive && userVoiceActiveRef.current) {
          userVoiceActiveRef.current = false;
          const utteranceDurationMs = utteranceStartRef.current ? Date.now() - utteranceStartRef.current : 0;
          utteranceStartRef.current = null;
          lastUtteranceDurationRef.current = utteranceDurationMs;
          pauseCountRef.current += 1;
          trackClientEvent("user_voice_stopped", { energy, utteranceDurationMs });
        }
        if (isVoiceActive) {
          wordCount++;
        }

        // Speaking pace (approximate WPM based on voice activity bursts)
        const elapsed = (Date.now() - startTimeRef.current) / 60000; // minutes
        const pace = elapsed > 0.1 ? Math.min(wordCount / elapsed / 10, 1) : 0; // normalized

        const data: AcousticData = {
          pitch: Math.min(pitch / 500, 1), // normalize 0-1
          energy,
          pace,
          speechActive: isVoiceActive,
          timestamp: Date.now()
        };

        // Store in ref always (for endSession), throttle React state to 2fps for viz
        acousticRef.current = [...acousticRef.current, data];
        lastAcousticRef.current = data;
        lastVizUpdate.current = Date.now();

        // Update live metrics + frequency data for visualizers
        setLiveEnergy(energy);
        setLivePace(pace);
        // Confidence: inverse of pitch variance (stable pitch = confident)
        setLiveConfidence(Math.max(0, 1 - Math.abs(data.pitch - 0.4) * 2));
        const freqCopy = new Uint8Array(freqArray.length);
        freqCopy.set(freqArray);
        setFrequencyData(freqCopy);
      };

      // Sample at ~10fps instead of every frame
      const sampleLoop = () => {
        analyze();
        analysisTimeoutRef.current = setTimeout(() => {
          if (analyserRef.current) sampleLoop();
        }, 100);
      };
      sampleLoop();
    } catch (err) {
      console.error("Failed to start audio analysis:", err);
      throw err;
    }
  }, [trackClientEvent]);

  const stopAudioAnalysis = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (analysisTimeoutRef.current) {
      clearTimeout(analysisTimeoutRef.current);
      analysisTimeoutRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    analyserRef.current = null;
    audioContextRef.current = null;
    mediaStreamRef.current = null;
  }, []);

  const stopSessionRuntime = useCallback(() => {
    sessionRuntimeStartedRef.current = false;
    stopAudioAnalysis();
    if (acousticSendInterval.current) {
      clearInterval(acousticSendInterval.current);
      acousticSendInterval.current = null;
    }
    setAgentSpeaking(false);
    setLiveEnergy(0);
    setLivePace(0);
    setLiveConfidence(0);
    setFrequencyData(null);
  }, [stopAudioAnalysis]);

  const startSessionRuntime = useCallback(() => {
    if (sessionRuntimeStartedRef.current) {
      return;
    }
    sessionRuntimeStartedRef.current = true;

    startAudioAnalysis().catch((err) => {
      console.error("Failed to start local audio analysis:", err);
      addNudge(
        "Mic analysis unavailable — continuing without live coaching.",
        "warning"
      );
    });

    acousticSendInterval.current = setInterval(() => {
      const latest = lastAcousticRef.current;
      if (latest) {
        agent.call("sendAcousticData", [latest]).catch(console.error);
      }
    }, 2000);
  }, [startAudioAnalysis, addNudge, agent]);

  // Fallback: record user audio and send to Deepgram pipeline
  const startRecording = useCallback(() => {
    if (!mediaStreamRef.current || isProcessingTurn) return;
    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(mediaStreamRef.current, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    diagRef.current.log("fallback:recording-start");
  }, [isProcessingTurn]);

  const stopRecordingAndSend = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    setIsProcessingTurn(true);
    setAgentSpeaking(true);
    diagRef.current.log("fallback:recording-stop");

    // Stop recorder and wait for data
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const audioBlob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
    if (audioBlob.size < 1000) {
      setIsProcessingTurn(false);
      setAgentSpeaking(false);
      return;
    }

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    formData.append("systemPrompt", systemPromptRef.current);
    formData.append("history", JSON.stringify(transcriptRef.current.slice(-10)));

    try {
      const res = await fetch("/api/voice-turn", { method: "POST", body: formData });
      const data = await res.json() as { text: string; agentText: string; audio: string | null };

      // Add to transcript
      if (data.text) {
        const userEntry = { role: "user" as const, text: data.text, timestamp: Date.now() };
        transcriptRef.current = [...transcriptRef.current, userEntry];
        setTranscript([...transcriptRef.current]);
        agent.call("analyzeTranscript", [data.text]).catch(console.error);
      }
      if (data.agentText) {
        const agentEntry = { role: "agent" as const, text: data.agentText, timestamp: Date.now() };
        transcriptRef.current = [...transcriptRef.current, agentEntry];
        setTranscript([...transcriptRef.current]);
      }

      // Play TTS audio
      if (data.audio) {
        try {
          const audioBytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
          const audioCtx = new AudioContext();
          const buffer = await audioCtx.decodeAudioData(audioBytes.buffer);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          source.onended = () => {
            setAgentSpeaking(false);
            audioCtx.close();
          };
          source.start();
          diagRef.current.log("fallback:playing-tts", { duration: buffer.duration });
        } catch (audioErr) {
          diagRef.current.log("fallback:tts-playback-failed", audioErr);
          setAgentSpeaking(false);
        }
      } else {
        setAgentSpeaking(false);
      }
    } catch (err) {
      diagRef.current.log("fallback:turn-failed", err);
      addNudge("Voice turn failed.", "warning");
      setAgentSpeaking(false);
    } finally {
      setIsProcessingTurn(false);
    }
  }, [agent, addNudge]);

  useEffect(() => {
    if (conversation.status === "connected") {
      setIsStarting(false);
      return;
    }

    if (conversation.status === "error") {
      diagRef.current.log("el:status-effect:error");
      diagRef.current.dump();
      stopSessionRuntime();
      setIsStarting(false);
      setIsActive(false);
      return;
    }

    if (conversation.status === "disconnected" && hasInitiatedConnectionRef.current && (isStarting || isActive)) {
      diagRef.current.log("el:status-effect:unexpected-disconnect", {
        wasStarting: isStarting,
        wasActive: isActive,
        hadConnected: hasConnectedRef.current,
        isEnding: isEndingSessionRef.current,
        fallback: voiceFallbackRef.current,
      });

      // If quota exceeded, switch to fallback mode instead of tearing down
      if (voiceFallbackRef.current && !isEndingSessionRef.current) {
        diagRef.current.log("fallback:activating");
        setIsFallbackMode(true);
        setIsStarting(false);
        setIsActive(true);
        // Keep audio analysis running for viz + coaching
        if (!sessionRuntimeStartedRef.current) {
          startSessionRuntime();
        }
        return;
      }

      if (!isEndingSessionRef.current) {
        diagRef.current.dump();
      }
      stopSessionRuntime();
      setIsStarting(false);
      setIsActive(false);

      if (!isEndingSessionRef.current && hasConnectedRef.current) {
        addNudge("Voice session disconnected.", "warning");
      }
    }
  }, [conversation.status, isActive, isStarting, stopSessionRuntime, startSessionRuntime, addNudge]);

  // Start session
  const startSession = useCallback(async () => {
    if (
      isStarting ||
      isActive ||
      conversation.status === "connecting" ||
      conversation.status === "connected"
    ) {
      return;
    }

    startTimeRef.current = Date.now();
    setTranscript([]);
    setNudges([]);
    setIsStarting(true);
    setIsActive(false);
    hasConnectedRef.current = false;
    isEndingSessionRef.current = false;
    hasInitiatedConnectionRef.current = false;
    transcriptRef.current = [];
    acousticRef.current = [];
    nudgesRef.current = [];
    lastAcousticRef.current = null;
    sessionRuntimeStartedRef.current = false;

    // Fresh diagnostics per session
    diagRef.current = createDiagnostics();
    const diag = diagRef.current;
    diag.log("session:start", { scenarioId: scenario.id, hasProductKey: !!productKey });

    try {
      // Set scenario on the CoachAgent before starting voice session
      diag.log("do:setScenario");
      await agent.call("setScenario", [scenario]);
      diag.log("do:setScenario:ok");

      // Prefer server-generated signed URLs for session startup
      diag.log("api:signed-url:request");
      const res = await fetch("/api/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id, productKey })
      });

      if (!res.ok) {
        diag.log("api:signed-url:http-error", { status: res.status });
        throw new Error("Failed to load voice agent configuration.");
      }

      const config = (await res.json()) as AgentConfigResponse;
      const signedUrl = config.signedUrl?.trim();
      const agentId = config.agentId?.trim() || "";
      const startupPath = signedUrl ? "signedUrl" : agentId ? "agentId-fallback" : "none";
      systemPromptRef.current = config.systemPrompt || "";
      diag.log("api:signed-url:response", {
        startupPath,
        serverDebug: config._debug,
        hasSystemPrompt: !!config.systemPrompt,
      });

      if (!signedUrl && !agentId) {
        throw new Error(
          "No ElevenLabs agent configured. Set ELEVENLABS_AGENT_ID."
        );
      }

      // Build session options — overrides sent on both paths per SDK behavior
      const sessionOpts = {
        ...(signedUrl ? { signedUrl } : { agentId }),
        overrides: {
          agent: {
            prompt: { prompt: config.systemPrompt },
            firstMessage: scenario.firstMessage
          }
        }
      };
      diag.log("el:startSession", { startupPath });
      hasInitiatedConnectionRef.current = true;
      conversation.startSession(sessionOpts);
    } catch (err) {
      diag.log("session:start:error", err instanceof Error ? err.message : err);
      diag.dump();
      conversation.endSession();
      stopSessionRuntime();
      setIsStarting(false);
      setIsActive(false);
      addNudge(
        err instanceof Error
          ? err.message
          : "Failed to connect to voice agent.",
        "warning"
      );
    }
  }, [
    scenario,
    productKey,
    conversation,
    addNudge,
    agent,
    isActive,
    isStarting,
    stopSessionRuntime
  ]);

  // End session — score via LLM judge, then return
  const endSession = useCallback(async () => {
    isEndingSessionRef.current = true;
    diagRef.current.log("session:end:intentional");
    diagRef.current.dump();
    conversation.endSession();
    stopSessionRuntime();

    const duration = Date.now() - startTimeRef.current;
    const transcript = transcriptRef.current;
    setIsStarting(false);
    setIsActive(false);
    trackClientEvent("session_ended", {
      scenarioId: scenario.id,
      duration,
      transcriptTurns: transcript.length,
    });

    // Score session via LLM judge
    let score: SessionScore | undefined;
    try {
      addNudge("Scoring your session...", "info");
      score = (await agent.call("scoreSession", [
        transcript,
        duration
      ])) as SessionScore;
    } catch (err) {
      console.error("Scoring failed:", err);
    }

    onEnd({
      transcript,
      acousticData: acousticRef.current,
      nudges: nudgesRef.current,
      duration,
      score
    });
    hasConnectedRef.current = false;
    isEndingSessionRef.current = false;
    voiceFallbackRef.current = false;
    setIsFallbackMode(false);
  }, [conversation, stopSessionRuntime, onEnd, agent, addNudge]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSessionRuntime();
    };
  }, [stopSessionRuntime]);

  return (
    <div className="practice-view">
      <div className="practice-header">
        <h2 className="view-title">{scenario.name}</h2>
        <span className="scenario-tone">{scenario.tone}</span>
        {isActive && (
          <span
            className={`status-indicator ${agentSpeaking ? "speaking" : "listening"}`}
          >
            {isFallbackMode
              ? (isProcessingTurn ? "PROCESSING..." : "PUSH TO TALK")
              : (agentSpeaking ? "AGENT SPEAKING" : "LISTENING...")}
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
          <button
            className="start-btn"
            onClick={startSession}
            disabled={isStarting}
          >
            {isStarting ? "CONNECTING..." : "START PRACTICE"}
          </button>
        </div>
      ) : (
        <div className="practice-active">
          {/* Nudge overlay — floats over terrain */}
          <div className="nudge-overlay">
            {nudges.map((n, i) => (
              <div
                key={`${n.timestamp}-${i}`}
                className={`nudge nudge-${n.urgency}`}
              >
                {n.text}
              </div>
            ))}
          </div>

          {/* 3D Orb — hero element, fills most of the view */}
          <div className="orb-hero">
            <AudioReactiveOrb audioLevel={liveEnergy} className="orb-canvas" />
            <CircularVisualizer
              frequencyData={frequencyData}
              className="circular-overlay"
            />
          </div>

          {/* Live metrics strip */}
          <div className="metrics-strip">
            <div className="metric-item">
              <span className="metric-label">ENERGY</span>
              <span className="metric-value">
                {Math.round(liveEnergy * 100)}%
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">PACE</span>
              <span className="metric-value">
                {livePace < 0.3 ? "SLOW" : livePace < 0.6 ? "STEADY" : "FAST"}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">CONFIDENCE</span>
              <span className="metric-value">
                {Math.round(liveConfidence * 100)}%
              </span>
            </div>
          </div>

          {/* Bottom bar: compact transcript + controls */}
          <div className="practice-bottom">
            <div className="compact-transcript">
              <div className="panel-header">TRANSCRIPT</div>
              <div className="transcript-scroll">
                {transcript.slice(-6).map((t, i) => (
                  <div
                    key={i}
                    className={`transcript-line transcript-${t.role}`}
                  >
                    <span className="transcript-role">
                      {t.role === "user" ? "YOU" : "THEM"}
                    </span>
                    <span className="transcript-text">{t.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="practice-controls">
              {isFallbackMode && (
                <button
                  className={`start-btn ${mediaRecorderRef.current?.state === "recording" ? "recording" : ""}`}
                  onMouseDown={startRecording}
                  onMouseUp={stopRecordingAndSend}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecordingAndSend}
                  disabled={isProcessingTurn}
                  style={{ marginRight: 12 }}
                >
                  {isProcessingTurn ? "PROCESSING..." : "HOLD TO SPEAK"}
                </button>
              )}
              <button className="end-btn" onClick={endSession}>
                END SESSION
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
