/**
 * no-dead-classes — className 引用完整性守卫。
 *
 * 组件里写下的每个类名必须能解析到一条真实的样式规则：要么在 Hub 入口
 * （src/react/index.tsx）实际导入的某个样式文件中有定义，要么登记在下方
 * 豁免清单（有意为之的标记类）。hub-overline 事故（2026-09-30 审计：法条
 * 引用了一个全仓不存在的单源类，四个节标题以正文形态渲染）说明这条路
 * 此前没有任何守卫。
 *
 * 范围与局限（登记在案，避免误期待）：
 *   - 只扫 src/react/**（className 字符串的产地）；src/core、src/modules 的
 *     字符串不是样式类。
 *   - 只捕获含连字符/方括号/冒号/斜杠的 token；纯单词标记（如 expandable）
 *     不进守卫视野，由评审把关。
 *   - 已知标记类家族豁免：lit-*、semantic-*（2026-08-31 C3 迁移把样式全部
 *     内联为工具类，类名仅作识别钩子保留）。
 *   - 孤儿目录 src/react/components/Hub/settings/** 已随 2026-09-30 清缴批
 *     删除（React 设置页由原生偏好设置窗取代；其样式文件
 *     zsearch-hub-settings.css 从未随入口加载，2118 行一并移除）。
 *
 * 2026-09-30 死类清缴批修掉的实案：hub-overline、hub-empty-slim（含
 * -title）、hub-status（data-tone）、hub-graph-filter-group/-group-label/
 * -header（旧名，图谱页早已迁 -section 族）、tw.css 未编译的九条工具类
 * （decoration-[var(--border)] 等）。
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

/** 有意无样式的标记类前缀（家族级豁免，新家族在此登记）。 */
const MARKER_PREFIXES = ["lit-", "semantic-"] as const;

/** 有意无样式的单点标记类（逐个登记，附缘由）。 */
const MARKER_CLASSES = [
  "hub-shell", // 壳层根标记，背景由父层纸色承担
  "hub-search-engine-status", // 状态条引擎位标记，样式由内联工具类承担
  "zsearch-confirm-dialog", // 对话框识别钩子（测试/检查定位用）
  "orbit-rings", // 空态轨道动画容器标记，几何全在内联 style
  "ux3-misc-sr-close", // 文案键非类名——dialog.tsx 中与 className 同行误捕
] as const;

/** Hub 入口实际加载的样式文件（解析 index.tsx 的 css import，自动跟随增删）。 */
function loadedCssFiles(): string[] {
  const entry = fs.readFileSync(path.join(REPO, "src/react/index.tsx"), "utf8");
  const files: string[] = [];
  for (const m of entry.matchAll(
    /from\s+"[^"]*addon\/content\/chat\/react\/([^"]+\.css)"/g,
  )) {
    files.push(path.join(REPO, "addon/content/chat/react", m[1]));
  }
  expect(files.length, "index.tsx 应至少导入 10 个样式文件").toBeGreaterThan(9);
  return files;
}

/** 样式文件中出现过的类名（选择器位置，复合选择器拆分，转义还原）。 */
function cssClassNames(file: string): Set<string> {
  const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const set = new Set<string>();
  // 裸点不在类名字符集内 → 复合选择器 .a.b 自然拆成两个名字；任意值内的
  // 点以 \. 转义对保留。裸冒号是伪类边界（任意值内的冒号是 \: 转义对），
  // 据此把 .hover\:x:hover 截成工具名 hover:x。
  const raw = /\.((?:\\.|[^.\s{}();"'`\\])+)/g;
  const unesc = (s: string) => s.replace(/\\(.)/g, "$1");
  let depth = 0;
  let sel = "";
  let skipUntilDepth: number | null = null; // @keyframes 块内不提取
  for (const ch of css) {
    if (ch === "{") {
      const s = sel.trim();
      depth++;
      if (/^@keyframes/.test(s)) skipUntilDepth = depth;
      else if (skipUntilDepth === null) {
        // 选择器组的逗号归一为空格——方括号深度为零才替换，任意值内的
        // 逗号（grid-cols-[repeat(auto-fill,minmax(0,1fr))]）必须保留
        let flat = "";
        let bracket = 0;
        for (const c of s) {
          if (c === "[") bracket++;
          else if (c === "]") bracket--;
          flat += c === "," && bracket === 0 ? " " : c;
        }
        for (const m of flat.matchAll(raw)) {
          // 裸冒号截伪类（:hover），裸方括号截属性选择器后缀（[data-highlighted]
          // ——Tailwind data 变体的编译形态），任意值内的 \: \[ 转义对不受影响
          set.add(unesc(m[1].split(/(?<!\\)[:[]/)[0]));
        }
      }
      sel = "";
    } else if (ch === "}") {
      if (skipUntilDepth !== null && depth === skipUntilDepth) {
        skipUntilDepth = null;
      }
      depth--;
      sel = "";
    } else {
      sel += ch;
    }
  }
  return set;
}

/** src/react 下的 className 意图行里引用的类名 token。 */
function referencedClassTokens(): Map<string, string[]> {
  const tokens = new Map<string, string[]>();
  const tokenRe = /^[!a-zA-Z[][!-`-{}\w./:[\]()%#=,'*@\\]*$/;
  const push = (tok: string, loc: string) => {
    if (tok.length < 3 || /\$\{/.test(tok)) return;
    if (!tokenRe.test(tok)) return;
    // 类名必有结构：连字符/变体冒号/任意值括号/斜杠/动画 @，纯单词不进视野
    if (!/[-:[\]/@]/.test(tok)) return;
    const arr = tokens.get(tok) ?? [];
    if (arr.length < 4 && !arr.includes(loc)) arr.push(loc);
    tokens.set(tok, arr);
  };
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
        const rel = path.relative(REPO, p).replaceAll("\\", "/");
        lines.forEach((line, i) => {
          if (!/className=|\bcn\(|clsx\(/.test(line)) return;
          for (const s of line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
            const raw = s[1] ?? s[2] ?? s[3] ?? "";
            for (const part of raw.split(/\$\{[^}]*\}/)) {
              for (const tok of part.split(/\s+/)) push(tok, `${rel}:${i + 1}`);
            }
          }
        });
      }
    }
  };
  walk(path.join(REPO, "src/react"));
  return tokens;
}

/** 死类判定的纯函数本体（真实守卫与正控自测共用）。 */
function computeUnknownClasses(
  tokens: Iterable<string>,
  defined: Set<string>,
  markerPrefixes: readonly string[] = MARKER_PREFIXES,
  markerClasses: readonly string[] = MARKER_CLASSES,
): string[] {
  return [...tokens].filter(
    (t) =>
      !defined.has(t) &&
      !markerClasses.includes(t) &&
      !markerPrefixes.some((p) => t.startsWith(p)),
  );
}

describe("className 引用完整性", () => {
  it("src/react 引用的每个类名都有样式定义或登记豁免", () => {
    const defined = new Set<string>();
    for (const f of loadedCssFiles()) {
      for (const name of cssClassNames(f)) defined.add(name);
    }
    expect(defined.size, "加载的样式文件应解析出类名").toBeGreaterThan(500);
    const refs = referencedClassTokens();
    expect(refs.size, "src/react 应解析出类名引用").toBeGreaterThan(300);
    const unknown = computeUnknownClasses(refs.keys(), defined);
    expect(
      unknown.map((t) => `${t} ← ${refs.get(t)!.join(", ")}`).join("\n"),
    ).toEqual("");
  });

  it("positive control: 守卫能抓出注入的无定义类，且豁免通道生效", () => {
    const defined = new Set(["border-l-[var(--data-blue)]", "lit-result-card"]);
    // 对照组①（该抓未抓即守卫失效）：无定义、未豁免的类必须报出。
    expect(
      computeUnknownClasses(["hub-not-defined-anywhere"], defined),
    ).toEqual(["hub-not-defined-anywhere"]);
    // 对照组②：有定义的类判活。
    expect(
      computeUnknownClasses(["border-l-[var(--data-blue)]"], defined),
    ).toEqual([]);
    // 对照组③：标记类家族前缀豁免生效。
    expect(computeUnknownClasses(["lit-anything-x"], defined)).toEqual([]);
    expect(computeUnknownClasses(["semantic-anything"], defined)).toEqual([]);
    // 对照组④：单点登记豁免生效。
    expect(computeUnknownClasses(["orbit-rings"], defined)).toEqual([]);
  });
});
