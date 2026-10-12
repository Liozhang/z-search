/**
 * SourceLogo — 搜索源圆形徽标（品牌识别色圆底 + 白色缩写字标）。
 *
 * 两态视觉（2026-10-12 用户裁决）：
 *   hit  = 品牌色圆底 + 深色描边（本轮检索有命中）
 *   miss = 灰底 + 灰描边（未命中 / 未填 Key / 检索失败——原因走悬停文字层，
 *          不增加视觉档位）
 * 「未参与」与「未命中」同为灰态：对用户可行动的信息（填 Key、重试）由
 * 筛选片的 title 提示表达。
 *
 * @module react/components/Hub/search/SourceLogo
 */
import React from "react";
import { getSourceIdentity } from "./sourceIdentities";

export function SourceLogo({
  source,
  state = "hit",
  size = 18,
}: {
  source: string;
  state?: "hit" | "miss";
  size?: number;
}): React.ReactElement {
  const identity = getSourceIdentity(source);
  const hit = state === "hit";
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, Math.round(size * 0.34)),
        background: hit ? identity.color : "var(--text-tertiary)",
        border: hit
          ? "1.5px solid var(--text-primary)"
          : "1.5px solid var(--border)",
        opacity: hit ? 1 : 0.55,
      }}
    >
      {identity.monogram}
    </span>
  );
}
