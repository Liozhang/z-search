/**
 * GlobeSpinner — A monochrome rotating globe loading indicator.
 * Features real continent outlines, orthographic projection with
 * axial rotation (requestAnimationFrame), and an orbital ring.
 * Pure SVG + CSS, XUL-safe (React JSX).
 *
 * Rendering: continuous rotation. Per-vertex sin/cos are precomputed once
 * (size-independent, module-level); each frame derives the rotation angle
 * from elapsed time and projects via the angle-addition identities, so the
 * loop costs 2 trig calls + ~2k multiplies + string serialization per frame.
 * No discrete frame stepping — smooth at any refresh rate, no path cache.
 */

import React, { useRef, useEffect, useMemo } from "react";
import { CONTINENTS } from "../../data/continents";
import { getString } from "../../utils/locale";

interface GlobeSpinnerProps {
  size?: number;
  className?: string;
  animated?: boolean;
}

const ROTATION_PERIOD_MS = 36000; // 36 seconds per full rotation
const DEG2RAD = Math.PI / 180;
const MERIDIAN_COUNT = 12; // every 30° of longitude
const MERIDIAN_STEPS = 61; // lat -90..90 every 3°

/**
 * Flat per-vertex geometry, lazily built once: [sinLon, cosLon, sinLat, cosLat].
 * Longitude/latitude are constant per vertex, so per-frame trig reduces to one
 * sin + one cos for the shared rotation angle (angle-addition identities).
 */
let continentGeom: Float64Array[] | null = null;
let meridianGeom: Float64Array | null = null;

function ensureGeometry(): void {
  if (continentGeom && meridianGeom) return;
  continentGeom = CONTINENTS.map((poly) => {
    const g = new Float64Array(poly.length * 4);
    for (let i = 0; i < poly.length; i++) {
      const lon = poly[i][0] * DEG2RAD;
      const lat = poly[i][1] * DEG2RAD;
      g[i * 4] = Math.sin(lon);
      g[i * 4 + 1] = Math.cos(lon);
      g[i * 4 + 2] = Math.sin(lat);
      g[i * 4 + 3] = Math.cos(lat);
    }
    return g;
  });
  meridianGeom = new Float64Array(MERIDIAN_COUNT * MERIDIAN_STEPS * 4);
  let k = 0;
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat <= 90; lat += 3) {
      const lr = lon * DEG2RAD;
      const pr = lat * DEG2RAD;
      meridianGeom[k++] = Math.sin(lr);
      meridianGeom[k++] = Math.cos(lr);
      meridianGeom[k++] = Math.sin(pr);
      meridianGeom[k++] = Math.cos(pr);
    }
  }
}

/** Build SVG path for all continent polygons at the given rotation. */
function buildContinentPath(
  cx: number,
  cy: number,
  r: number,
  sinR: number,
  cosR: number,
): string {
  let d = "";
  for (const g of continentGeom!) {
    if (g.length < 12) continue; // <3 vertices
    for (let i = 0; i < g.length; i += 4) {
      const sl = g[i];
      const cl = g[i + 1];
      const sp = g[i + 2];
      const cp = g[i + 3];
      const x = cp * (sl * cosR - cl * sinR); // cos(lat)·sin(lon−rot)
      const y = -sp;
      d +=
        (i === 0 ? "M" : "L") +
        (cx + x * r).toFixed(1) +
        "," +
        (cy + y * r).toFixed(1);
    }
    d += "Z";
  }
  return d;
}

/** Build SVG path for meridians visible on the front hemisphere (cos(lat)·cos(lon−rot) > 0). */
function buildLongitudePath(
  cx: number,
  cy: number,
  r: number,
  sinR: number,
  cosR: number,
): string {
  let d = "";
  const g = meridianGeom!;
  for (let m = 0; m < MERIDIAN_COUNT; m++) {
    let moved = false;
    for (let j = 0; j < MERIDIAN_STEPS; j++) {
      const k = (m * MERIDIAN_STEPS + j) * 4;
      const sl = g[k];
      const cl = g[k + 1];
      const sp = g[k + 2];
      const cp = g[k + 3];
      if (cp * (cl * cosR + sl * sinR) > 0) {
        const x = cp * (sl * cosR - cl * sinR);
        const y = -sp;
        d +=
          (moved ? "L" : "M") +
          (cx + x * r).toFixed(1) +
          "," +
          (cy + y * r).toFixed(1);
        moved = true;
      } else {
        moved = false;
      }
    }
  }
  return d;
}

export const GlobeSpinner: React.FC<GlobeSpinnerProps> = ({
  size = 200,
  className = "",
  animated = true,
}) => {
  // Respect prefers-reduced-motion: freeze the globe (static draw) when requested.
  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const animatedEffective = animated && !prefersReducedMotion;

  // Trig tables are size-independent; build once per module lifetime.
  useMemo(() => ensureGeometry(), []);

  const pathRef = useRef<SVGPathElement>(null);
  const lonPathRef = useRef<SVGPathElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.35;

    const applyRotation = (rotDeg: number) => {
      const r0 = rotDeg * DEG2RAD;
      const sinR = Math.sin(r0);
      const cosR = Math.cos(r0);
      const el = pathRef.current;
      if (el) el.setAttribute("d", buildContinentPath(cx, cy, r, sinR, cosR));
      const lel = lonPathRef.current;
      if (lel) lel.setAttribute("d", buildLongitudePath(cx, cy, r, sinR, cosR));
    };

    applyRotation(0);

    if (!animatedEffective) return; // Static mode — just draw once

    // Time-based continuous rotation: speed is independent of monitor
    // refresh rate and main-thread hiccups only skip ahead, never stall.
    const startTime = performance.now();
    function draw(now: number) {
      const elapsed = (now - startTime) % ROTATION_PERIOD_MS;
      applyRotation((elapsed / ROTATION_PERIOD_MS) * 360);
      frameRef.current = requestAnimationFrame(draw);
    }

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [size, animatedEffective]);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;
  const stroke = "var(--text-tertiary)";

  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
      }}
      aria-busy="true"
      aria-label={getString("markdown-loading")}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          {/* Clip to globe circle */}
          <clipPath id="globe-clip">
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
          {/* Radial gradient mask: bright center → dark edge.
              Simulates sphere curvature; back-side projections
              at the globe edge are naturally suppressed. */}
          <radialGradient id="globe-edge-fade">
            <stop offset="0%" stopColor="var(--card-bg)" stopOpacity="1" />
            <stop offset="50%" stopColor="var(--card-bg)" stopOpacity="1" />
            <stop
              offset="100%"
              stopColor="var(--text-primary)"
              stopOpacity="1"
            />
          </radialGradient>
          <mask id="globe-mask">
            <circle cx={cx} cy={cy} r={r} fill="url(#globe-edge-fade)" />
          </mask>
        </defs>

        {/* OrbitRings — inline SVG, preserved from original GlobeSpinner animation */}
        <g style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle
            cx={cx}
            cy={cy}
            r={r * 1.2}
            fill="none"
            stroke={stroke}
            strokeWidth={1.2}
            strokeDasharray={`${(2 * Math.PI * r * 1.2 * 75) / 360} ${(2 * Math.PI * r * 1.2 * 45) / 360}`}
            strokeLinecap="round"
            opacity={0.25}
            style={{
              animation: `${animatedEffective ? "spin-orbit 6s linear infinite" : ""}`,
              transformOrigin: `${cx}px ${cy}px`,
              animationPlayState: animatedEffective ? "running" : "paused",
            }}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r * 1.1}
            fill="none"
            stroke={stroke}
            strokeWidth={0.8}
            strokeDasharray={`${(2 * Math.PI * r * 1.1 * 50) / 360} ${(2 * Math.PI * r * 1.1 * 40) / 360}`}
            strokeLinecap="round"
            opacity={0.15}
            style={{
              animation: `${animatedEffective ? "spin-orbit-reverse 9s linear infinite" : ""}`,
              transformOrigin: `${cx}px ${cy}px`,
              animationPlayState: animatedEffective ? "running" : "paused",
            }}
          />
        </g>

        {/* Globe group — 23.5° axial tilt */}
        <g
          style={{
            transform: "rotate(23.5deg)",
            transformOrigin: `${cx}px ${cy}px`,
          }}
        >
          <g
            style={{
              transformOrigin: `${cx}px ${cy}px`,
            }}
          >
            {/* Atmosphere glow */}
            <circle cx={cx} cy={cy} r={r * 1.08} fill={stroke} opacity={0.04} />

            {/* Globe sphere */}
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="var(--card-bg)"
              stroke={stroke}
              strokeWidth={1}
            />

            {/* Latitude grid lines (±30°, ±60°) */}
            {[30, -30, 60, -60].map((lat) => {
              const phi = (lat * Math.PI) / 180;
              const ry = r * Math.cos(phi);
              const yo = -r * Math.sin(phi);
              return (
                <ellipse
                  key={`lat-${lat}`}
                  cx={cx}
                  cy={cy + yo}
                  rx={ry * 0.92}
                  ry={ry * 0.25}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={0.4}
                  opacity={0.2}
                />
              );
            })}

            {/* Equator */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={r}
              ry={r * 0.08}
              fill="none"
              stroke={stroke}
              strokeWidth={0.5}
              opacity={0.3}
            />

            {/* Longitude lines (dynamic, rotate with globe) */}
            <path
              ref={lonPathRef}
              fill="none"
              stroke={stroke}
              strokeWidth={0.4}
              opacity={0.2}
            />

            {/* Continent path — projected fresh each frame from cached vertex
                trig; only vertex positions change, topology stays stable. */}
            <path
              ref={pathRef}
              fill={stroke}
              opacity={0.6}
              clipPath="url(#globe-clip)"
              mask="url(#globe-mask)"
            />

            {/* Specular highlight */}
            <circle
              cx={cx - r * 0.25}
              cy={cy - r * 0.25}
              r={r * 0.15}
              fill="var(--card-bg)"
              opacity={0.15}
            />
          </g>
        </g>
      </svg>
    </div>
  );
};

export default GlobeSpinner;
