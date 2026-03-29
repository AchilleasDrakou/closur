import { useRef, useEffect, useState, useCallback } from "react";

interface Annotation {
  timestamp: number;
  type: "positive" | "negative" | "neutral";
  label: string;
  detail: string;
}

interface WaveformPlayerProps {
  acousticData: Array<{ timestamp: number; energy: number; pitch: number; pace: number }>;
  annotations: Annotation[];
  duration: number;
  onAnnotationClick?: (annotation: { timestamp: number; label: string; detail: string }) => void;
  className?: string;
}

const MARKER_COLORS = {
  positive: "#b4e62e",
  negative: "#ff3822",
  neutral: "#6a9bcc",
};

function formatTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function WaveformPlayer({
  acousticData,
  annotations,
  duration,
  onAnnotationClick,
  className,
}: WaveformPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0); // 0-1 position
  const [tooltip, setTooltip] = useState<{ x: number; annotation: Annotation } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 80 });

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setSize({ w: width, h: 80 });
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    ctx.scale(dpr, dpr);

    const w = size.w;
    const h = size.h;
    const timelineH = 16; // space for time labels
    const waveH = h - timelineH;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw waveform bars
    if (acousticData.length > 0 && duration > 0) {
      const barCount = Math.min(acousticData.length, Math.floor(w / 3));
      const barWidth = w / barCount;

      ctx.fillStyle = "rgba(180, 230, 46, 0.6)";
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * acousticData.length);
        const energy = acousticData[idx]?.energy ?? 0;
        const barH = Math.max(2, energy * (waveH - 4));
        const x = i * barWidth;
        const y = waveH - barH;
        ctx.fillRect(x, y, Math.max(1, barWidth - 1), barH);
      }
    }

    // Draw annotation markers
    for (const ann of annotations) {
      if (duration <= 0) continue;
      const x = (ann.timestamp / duration) * w;
      const color = MARKER_COLORS[ann.type];

      // Vertical line
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, waveH);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Dot at top
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw cursor
    const cursorX = cursor * w;
    ctx.strokeStyle = "#d8d8d8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, waveH);
    ctx.stroke();

    // Time labels
    ctx.fillStyle = "#5a5a6a";
    ctx.font = "10px 'Fira Code', monospace";
    ctx.textBaseline = "top";
    const labelCount = Math.max(2, Math.floor(w / 80));
    for (let i = 0; i <= labelCount; i++) {
      const t = (i / labelCount) * duration;
      const x = (i / labelCount) * w;
      const label = formatTime(t);
      const align = i === labelCount ? "right" : i === 0 ? "left" : "center";
      ctx.textAlign = align as CanvasTextAlign;
      ctx.fillText(label, Math.min(Math.max(x, 0), w), waveH + 3);
    }
  }, [acousticData, annotations, duration, cursor, size]);

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || size.w === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = x / rect.width;
      setCursor(Math.max(0, Math.min(1, pct)));

      // Find nearest annotation within 20px
      if (duration > 0 && onAnnotationClick) {
        let nearest: Annotation | null = null;
        let nearestDist = Infinity;
        for (const ann of annotations) {
          const annX = (ann.timestamp / duration) * rect.width;
          const dist = Math.abs(annX - x);
          if (dist < 20 && dist < nearestDist) {
            nearest = ann;
            nearestDist = dist;
          }
        }
        if (nearest) {
          onAnnotationClick({ timestamp: nearest.timestamp, label: nearest.label, detail: nearest.detail });
        }
      }
    },
    [annotations, duration, onAnnotationClick, size],
  );

  // Hover handler for tooltips
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || duration <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      let found: { x: number; annotation: Annotation } | null = null;
      for (const ann of annotations) {
        const annX = (ann.timestamp / duration) * rect.width;
        if (Math.abs(annX - x) < 12) {
          found = { x: annX, annotation: ann };
          break;
        }
      }
      setTooltip(found);
    },
    [annotations, duration],
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div ref={containerRef} className={`waveform-player ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        style={{ width: "100%", height: size.h }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && (
        <div
          className={`waveform-tooltip waveform-tooltip-${tooltip.annotation.type}`}
          style={{ left: Math.min(tooltip.x, size.w - 180), top: 0 }}
        >
          <span className="waveform-tooltip-label">{tooltip.annotation.label}</span>
          <span className="waveform-tooltip-detail">{tooltip.annotation.detail}</span>
        </div>
      )}
    </div>
  );
}
