/**
 * OrbitRings — Reusable orbital ring animation extracted from GlobeSpinner.
 * Two dashed circles rotating in opposite directions.
 * Pure SVG + CSS, XUL-safe.
 */

import React from "react";
import { cn } from "@/lib/utils";

interface OrbitRingsProps {
  /** Overall pixel size of the component (default 16, matches --icon-md). */
  size?: number;
  /** Stroke color (default var(--text-tertiary)). */
  stroke?: string;
  /** Whether animations run (default true). Set false to freeze. */
  animated?: boolean;
  /** Additional class on the outer wrapper. */
  className?: string;
}

export const OrbitRings: React.FC<OrbitRingsProps> = ({
  size = 16,
  stroke = "var(--text-tertiary)",
  animated = true,
  className = "",
}) => {
  // reduced-motion：与 GlobeSpinner 相同的冻结策略（组件级统一，消费端无需处理）
  const [reducedMotion, setReducedMotion] = React.useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const running = animated && !reducedMotion;
  const cx = size / 2;
  const cy = size / 2;
  const baseR = size * 0.35;

  const orbitConfigs = [
    {
      r: baseR * 1.2,
      segDeg: 75,
      gapDeg: 45,
      speed: 6,
      opacity: 0.25,
      sw: 1.2,
      anim: "spin-orbit" as const,
    },
    {
      r: baseR * 1.1,
      segDeg: 50,
      gapDeg: 40,
      speed: 9,
      opacity: 0.15,
      sw: 0.8,
      anim: "spin-orbit-reverse" as const,
    },
  ].map((o) => {
    const C = 2 * Math.PI * o.r;
    const segLen = (C * o.segDeg) / 360;
    const gapLen = (C * o.gapDeg) / 360;
    return { ...o, dash: `${segLen.toFixed(0)} ${gapLen.toFixed(0)}` };
  });

  const animState = running ? "running" : "paused";

  return (
    <span
      className={cn("orbit-rings", className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        lineHeight: 0,
      }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {orbitConfigs.map((orbit) => (
          <g
            key={orbit.anim}
            style={{
              animation: `${orbit.anim} ${orbit.speed}s linear infinite`,
              transformOrigin: `${cx}px ${cy}px`,
              animationPlayState: animState,
            }}
          >
            <circle
              cx={cx}
              cy={cy}
              r={orbit.r}
              fill="none"
              stroke={stroke}
              strokeWidth={orbit.sw}
              strokeDasharray={orbit.dash}
              strokeLinecap="round"
              opacity={orbit.opacity}
            />
          </g>
        ))}
      </svg>
    </span>
  );
};

export default OrbitRings;
