import { useRef, useEffect, useCallback } from "react";

interface CircularVisualizerProps {
  frequencyData: Uint8Array | null;
  className?: string;
}

export function CircularVisualizer({ frequencyData, className }: CircularVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animIdRef = useRef(0);
  const freqRef = useRef<Uint8Array | null>(null);

  freqRef.current = frequencyData;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Size canvas to container
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);
    }

    const w = rect?.width || canvas.width;
    const h = rect?.height || canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    const freq = freqRef.current;
    if (!freq || freq.length === 0) {
      animIdRef.current = requestAnimationFrame(draw);
      return;
    }

    const len = freq.length;

    // 3 concentric rings sampling different frequency bands
    const rings = [
      { rangeStart: 0, rangeEnd: Math.floor(len * 0.15), baseRadius: Math.min(cx, cy) * 0.25, opacity: 0.8, lineWidth: 2 },
      { rangeStart: Math.floor(len * 0.15), rangeEnd: Math.floor(len * 0.45), baseRadius: Math.min(cx, cy) * 0.42, opacity: 0.5, lineWidth: 1.5 },
      { rangeStart: Math.floor(len * 0.45), rangeEnd: Math.floor(len * 0.8), baseRadius: Math.min(cx, cy) * 0.6, opacity: 0.3, lineWidth: 1 },
    ];

    for (const ring of rings) {
      // Average amplitude for this band
      let sum = 0;
      let count = 0;
      for (let i = ring.rangeStart; i < ring.rangeEnd; i++) {
        sum += freq[i];
        count++;
      }
      const avg = count > 0 ? sum / count / 255 : 0;

      const radius = ring.baseRadius + avg * ring.baseRadius * 0.5;
      const segments = 64;

      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        // Slight per-segment variation from freq data
        const freqIdx = ring.rangeStart + Math.floor((i / segments) * (ring.rangeEnd - ring.rangeStart));
        const segAmp = freq[freqIdx] / 255;
        const r = radius + segAmp * ring.baseRadius * 0.15;

        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      ctx.strokeStyle = `rgba(180, 230, 46, ${ring.opacity})`;
      ctx.lineWidth = ring.lineWidth;
      ctx.stroke();
    }

    animIdRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animIdRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animIdRef.current);
  }, [draw]);

  return <canvas ref={canvasRef} className={className} />;
}
