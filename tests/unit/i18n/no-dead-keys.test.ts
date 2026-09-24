/**
 * no-dead-keys — locale dictionary hygiene guard.
 *
 * Every message defined in addon/locale/<locale>/*.ftl must be referenced by
 * code (src/ or addon/), otherwise it is a dead key: cargo-cult vocabulary that
 * costs every future translation and misleads the next reader about what the
 * plugin actually renders.
 *
 * 2026-09-23 大清理的历史：本插件只实现搜索中心，4541 个键里 4099 个是从
 * leadero  wholesale 抄来的死词（chat/agent/audit/brain 等未落地功能），
 * 已删至 442 个活键。本用例守住这条线，也守住三语键集与
 * generated catalog / typings 的三方一致。
 *
 * 两条已知的运行时动态键家族（键名由数据拼出，静态扫描必须放过）：
 *   - lit-quartile-cass-{1..4}、lit-quartile-jcr-q{1..4}（LiteratureResultCard 按分区等级取）
 *   - soul-name-{id}（locale.ts 按灵魂 id 取）
 * 新增动态家族时在此登记，否则本守卫会误报。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const DYNAMIC_KEY_PREFIXES = [
  "lit-quartile-cass-",
  "lit-quartile-jcr-",
  "soul-name-",
] as const;

const LOCALES = ["zh-CN", "zh-TW", "en-US"] as const;
const FAMILIES = ["addon.ftl", "preferences.ftl", "tracking.ftl"] as const;

function ftlKeys(file: string): Set<string> {
  const keys = new Set<string>();
  for (const m of fs
    .readFileSync(path.join(REPO, file), "utf8")
    .matchAll(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*=/gm)) {
    keys.add(m[1]);
  }
  return keys;
}

/** Code corpus: everything that can name a key, minus the FTL sources and the
 *  generated catalog (which lists every key by construction, so it can never
 *  prove a key is live). */
function codeCorpus(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const rel = p.split(path.sep).join("/");
        if (rel.includes("addon/locale")) continue;
        walk(p);
      } else if (/\.(ts|tsx|js|jsx|xhtml|html)$/.test(e.name)) {
        if (e.name === "locale-keys.generated.ts") continue;
        out.push(fs.readFileSync(p, "utf8"));
      }
    }
  };
  walk(path.join(REPO, "src"));
  walk(path.join(REPO, "addon"));
  return out.join("\n");
}

describe("locale dictionary hygiene", () => {
  it("defines no dead keys (every message is referenced by code)", () => {
    const union = new Set<string>();
    for (const loc of LOCALES) {
      for (const fam of FAMILIES) {
        for (const k of ftlKeys(`addon/locale/${loc}/${fam}`)) union.add(k);
      }
    }
    expect(union.size).toBeGreaterThan(0);
    const corpus = codeCorpus();
    const dead = [...union].filter(
      (k) =>
        !DYNAMIC_KEY_PREFIXES.some((p) => k.startsWith(p)) &&
        !new RegExp(
          `["'\`]${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`,
        ).test(corpus),
    );
    expect(dead, `dead locale keys: ${dead.slice(0, 40).join(", ")}`).toEqual(
      [],
    );
  });

  it("keeps the three locales at an identical key set", () => {
    for (const fam of FAMILIES) {
      const sets = LOCALES.map((loc) => ftlKeys(`addon/locale/${loc}/${fam}`));
      for (const loc of LOCALES.slice(1)) {
        const other = sets[0];
        const mine = ftlKeys(`addon/locale/${loc}/${fam}`);
        const missing = [...other].filter((k) => !mine.has(k));
        const extra = [...mine].filter((k) => !other.has(k));
        expect({ missing, extra }, `${fam}: ${loc} parity gap`).toEqual({
          missing: [],
          extra: [],
        });
      }
    }
  });

  it("keeps the generated catalog and typings aligned with the FTL union", () => {
    const union = new Set<string>();
    for (const fam of FAMILIES) {
      for (const k of ftlKeys(`addon/locale/en-US/${fam}`)) union.add(k);
    }
    const catalog =
      fs
        .readFileSync(path.join(REPO, "src/locale-keys.generated.ts"), "utf8")
        .match(/^\s*"([^"]+)",?\s*$/gm)
        ?.map((l) => l.trim().replace(/^"|",?$/g, "")) ?? [];
    const typings =
      fs
        .readFileSync(path.join(REPO, "typings/i10n.d.ts"), "utf8")
        .match(/^\s*\| '([^']+)';?\s*$/gm)
        ?.map((l) => l.trim().replace(/^\| '|';?$/g, "")) ?? [];
    expect(new Set(catalog), "catalog vs FTL union").toEqual(union);
    expect(new Set(typings), "typings vs FTL union").toEqual(union);
  });
});
