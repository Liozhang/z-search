/**
 * sourceIdentities — 13 源圆形徽标注册表的覆盖守卫。
 *
 * AVAILABLE_SOURCES 的每个值必须有品牌识别色与缩写，否则来源筛选行会
 * 落到灰色兜底（新增源时漏配注册表即在此报警）。
 *
 * @module tests/unit/react/components/Hub/search/sourceIdentities
 */
import { describe, it, expect } from "vitest";
import {
  SOURCE_IDENTITIES,
  getSourceIdentity,
} from "../../../../../../src/react/components/Hub/search/sourceIdentities";
import { AVAILABLE_SOURCES } from "../../../../../../src/react/components/Hub/search/LiteratureSearch/types";

describe("SOURCE_IDENTITIES 覆盖守卫", () => {
  it("AVAILABLE_SOURCES 的每个源都有注册条目", () => {
    for (const { value } of AVAILABLE_SOURCES) {
      expect(SOURCE_IDENTITIES[value]).toBeDefined();
    }
  });

  it("注册表条目形状合法：色值为 hex，缩写 1-4 字符", () => {
    for (const [, identity] of Object.entries(SOURCE_IDENTITIES)) {
      expect(identity.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(identity.monogram.length).toBeGreaterThanOrEqual(1);
      expect(identity.monogram.length).toBeLessThanOrEqual(4);
    }
  });

  it("未注册源走灰色兜底（首两字符大写）", () => {
    const fallback = getSourceIdentity("unknown-source");
    expect(fallback.color).toBe("#6B7280");
    expect(fallback.monogram).toBe("UN");
  });
});
