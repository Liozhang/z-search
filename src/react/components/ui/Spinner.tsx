/**
 * Spinner — Loading indicator (Tailwind, XUL-safe).
 *
 * 行内加载原语的统一 API（§15.6/§21.2 收敛）。
 * 视觉 = OrbitRings 双虚线环（原型 .orbit 家族：外环 6s 正转 + 内环 4s 反转，
 * text-tertiary 单色）。区级占位请用 LoadingState（默认 GlobeSpinner）。
 */

import React from "react";
import { OrbitRings } from "./OrbitRings";

interface SpinnerProps {
  size?: number;
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 16,
  className = "",
}) => <OrbitRings size={size} className={className} />;

export default Spinner;
