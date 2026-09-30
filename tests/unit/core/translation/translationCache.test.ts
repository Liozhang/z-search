/**
 * Persistent translation cache tests (translationCache.ts) — Node environment
 * with an IOUtils shim over node:fs and an injected cache directory.
 * （自 z-transplit 的 spec 移植，见 docs/optimization-from-siblings-2026-09-30.md 第 5 项）
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  setCacheDirForTests,
  cacheKey,
  normalizeForCache,
  getCachedTranslations,
  putCachedTranslation,
  pruneCache,
  clearCacheDirectory,
} from "../../../../src/core/translation/translationCache";
import {
  installIOUTilsShim,
  uninstallIOUTilsShim,
} from "../../helpers/ioutils-shim";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zsearch-cache-"));
  installIOUTilsShim();
  setCacheDirForTests(tmp);
});

afterEach(() => {
  setCacheDirForTests(null);
  uninstallIOUTilsShim();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ID = "custom|my-model|https://api.test|abc123";

describe("translationCache keys", () => {
  it("normalizes whitespace so extraction noise does not cause misses", async () => {
    expect(normalizeForCache("foo\n bar   baz")).toBe("foo bar baz");
    const a = await cacheKey(ID, "auto", "zh-CN", "Reading  is  good.");
    const b = await cacheKey(ID, "auto", "zh-CN", "Reading is good.");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it("isolates by engine identity, source and target language", async () => {
    const k1 = await cacheKey(ID, "auto", "zh-CN", "hello");
    const k2 = await cacheKey("google|keyless", "auto", "zh-CN", "hello");
    const k3 = await cacheKey(ID, "auto", "en", "hello");
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("returns null for empty text", async () => {
    expect(await cacheKey(ID, "auto", "zh-CN", "   ")).toBeNull();
  });
});

describe("translationCache storage", () => {
  it("roundtrips a record and shares it via getCachedTranslations", async () => {
    const key = await cacheKey(ID, "auto", "zh-CN", "Hello world");
    await putCachedTranslation(
      ID,
      "auto",
      "zh-CN",
      "Hello world",
      "你好，世界",
    );
    const got = await getCachedTranslations([key]);
    expect(got.get(key as string)).toBe("你好，世界");
  });

  it("treats corrupt files as a plain miss and heals on rewrite", async () => {
    const key = (await cacheKey(ID, "auto", "zh-CN", "corrupt")) as string;
    const file = path.join(
      tmp,
      "zsearch/translation-cache/v1",
      key.slice(0, 2),
      `${key}.json`,
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    const got = await getCachedTranslations([key]);
    expect(got.size).toBe(0);
    // A subsequent write over the corrupt file heals the record.
    await putCachedTranslation(ID, "auto", "zh-CN", "corrupt", "修复");
    expect((await getCachedTranslations([key])).get(key as string)).toBe(
      "修复",
    );
  });

  it("prunes LRU records down to 70% of the cap and clears everything on demand", async () => {
    for (let i = 0; i < 12; i++) {
      await putCachedTranslation(
        ID,
        "auto",
        "zh-CN",
        `paragraph ${i}`,
        `译 ${i}`,
      );
    }
    // Nudge usedAt apart.
    const root = path.join(tmp, "zsearch/translation-cache/v1");
    let n = 0;
    for (const bucket of fs.readdirSync(root)) {
      for (const file of fs.readdirSync(path.join(root, bucket))) {
        const p = path.join(root, bucket, file);
        const rec = JSON.parse(fs.readFileSync(p, "utf8"));
        rec.usedAt = 1_000_000 + n++;
        fs.writeFileSync(p, JSON.stringify(rec));
      }
    }
    const files = (() => {
      let count = 0;
      for (const bucket of fs.readdirSync(root)) {
        count += fs.readdirSync(path.join(root, bucket)).length;
      }
      return count;
    })();
    expect(files).toBe(12);
    const removed = await pruneCache(1); // 1 byte cap → prune to 70% of 1
    expect(removed).toBeGreaterThan(0);
    await clearCacheDirectory();
    expect(fs.existsSync(root)).toBe(false);
  });
});
