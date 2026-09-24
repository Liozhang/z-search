import { describe, it, expect } from "vitest";
import {
  tokenizeForFts,
  buildMatchQuery,
  MAX_QUERY_TOKENS,
} from "../../../../src/core/search/fts-tokenize";

describe("fts-tokenize", () => {
  describe("tokenizeForFts", () => {
    it("splits CJK runs into overlapping bigrams", () => {
      // 6 chars → 5 overlapping bigrams
      expect(tokenizeForFts("对比学习方法")).toBe("对比 比学 学习 习方 方法");
    });

    it("keeps a single isolated CJK char as a unigram", () => {
      expect(tokenizeForFts("光")).toBe("光");
    });

    it("lowercases latin words", () => {
      expect(tokenizeForFts("Contrastive Learning")).toBe(
        "contrastive learning",
      );
    });

    it("treats punctuation/whitespace as boundaries", () => {
      // "自监督(self-supervision)学习" → CJK bigrams + latin words
      const out = tokenizeForFts("自监督(self-supervision)学习");
      expect(out).toBe("自监 监督 self supervision 学习");
    });

    it("handles mixed CJK+latin runs", () => {
      const out = tokenizeForFts("BERT模型训练");
      expect(out).toBe("bert 模型 型训 训练");
    });

    it("returns empty string for punctuation-only input", () => {
      expect(tokenizeForFts("。！？ --- ()")).toBe("");
    });

    it("handles kana and hangul as CJK-style runs", () => {
      expect(tokenizeForFts("かな")).toBe("かな");
      expect(tokenizeForFts("한국어")).toBe("한국 국어");
    });

    it("handles empty input", () => {
      expect(tokenizeForFts("")).toBe("");
    });
  });

  describe("buildMatchQuery", () => {
    it("builds OR-joined quoted bigram tokens", () => {
      expect(buildMatchQuery("对比学习方法")).toBe(
        '"对比" OR "比学" OR "学习" OR "习方" OR "方法"',
      );
    });

    it("builds OR-joined latin tokens", () => {
      expect(buildMatchQuery("contrastive learning")).toBe(
        '"contrastive" OR "learning"',
      );
    });

    it("returns null when no usable token", () => {
      expect(buildMatchQuery("。！？")).toBeNull();
      expect(buildMatchQuery("")).toBeNull();
    });

    it("caps token count at MAX_QUERY_TOKENS", () => {
      const longQuery = Array.from({ length: 100 }, (_, i) => `词${i}字`).join(
        " ",
      );
      const out = buildMatchQuery(longQuery)!;
      const quoted = out.split(" OR ");
      expect(quoted.length).toBe(MAX_QUERY_TOKENS);
    });
  });
});
