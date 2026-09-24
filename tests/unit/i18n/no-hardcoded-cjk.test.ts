/**
 * 中英双语回归守卫：源码里不允许出现硬编码中文 UI 文案。
 *
 * 背景：插件的用户可见文案必须走 FTL（zh-CN / zh-TW / en-US 三份），否则切到
 * 英文 Zotero 时会露出中文。这类漏网之鱼肉眼很难发现（PDF 解析路径的进度/错误
 * 串曾整片是中文），故用本测试把「字符串字面量 / JSX 文本含 CJK」设为红灯。
 *
 * 用 TypeScript 扫描器而非正则：仓库的 AI 提示模板里大量出现块注释起止样例，
 * 朴素的注释剥离会把模板内部当成注释、把真代码留在外面，制造大量误报。
 *
 * 白名单（file -> reason）：
 *  - DiscoveryEngine.ts：LLM 提示词里的格式样例（"query1","查询2"），是给模型
 *    的双语示例，不是界面文案。
 *  - fts-tokenize.ts / QueryExpander.ts / sectionParser.ts /
 *    PatentNumberNormalizer.ts / BM25Index.ts：分词/解析器测试样例与专利号模式
 *    （如"一、"是中文序号，"特許第 N 号"是日本专利号模式），是数据不是文案。
 *  - agentErrors.ts / errorMessages.ts：错误分类的匹配模式，要匹配各 locale 的
 *    原文（zh-CN/zh-TW/en），是数据不是展示。
 *  - sqlBatch.ts：开发者向内部断言消息，不进界面。
 *  - WarningListStore.ts：期刊预警名单的状态枚举（预警/不在名单），经 FTL 在
 *    UI 层本地化；此处为数据层常量。
 *  - apiKeyInput.tsx：已删除的 React 设置区遗留死组件（Zotero 原生偏好面板取代）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

const ALLOWLIST: Readonly<Record<string, string>> = {
  "src/core/search/DiscoveryEngine.ts":
    "LLM prompt format samples (bilingual by design)",
  "src/core/search/fts-tokenize.ts": "tokenizer test fixtures, not UI text",
  "src/core/search/QueryExpander.ts": "query-expansion prompt fixtures",
  "src/core/search/sectionParser.ts": "Chinese section-heading patterns (data)",
  "src/core/patent/PatentNumberNormalizer.ts":
    "patent number patterns incl. Japanese forms (data)",
  "src/core/search/BM25Index.ts": "index-internal test fixtures",
  "src/utils/agentErrors.ts":
    "error-classification match patterns, not UI text",
  "src/utils/errorMessages.ts":
    "error-classification match patterns across locales",
  "src/utils/sqlBatch.ts": "developer-facing internal assertion",
  "src/core/data/WarningListStore.ts":
    "warning-list status enum; localized at the UI layer",
  "src/core/data/utils/filters.ts":
    "internal assertParamBudget message (developer-facing)",
  "src/utils/zoteroSql.ts":
    "SQL shape diagnostics with fix instructions (developer-facing console text)",
  "src/react/components/Hub/settings/models/ApiKeyInput.tsx":
    "dead component from the removed React settings pane",
};

/** 构建产物：扫描源码即可，打包后的 bundle 不再过一遍。 */
const BUILT = new Set([
  "addon/content/reactBundle.js",
  "addon/content/scripts/embed-standalone.js",
]);

/** CJK 统一表意符号基本区（简体/繁体/日本汉字都在内）。 */
const CJK = /[一-鿿]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (["node_modules", ".git", ".scaffold"].includes(entry)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js)$/.test(entry)) out.push(p);
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
  kind: string;
  text: string;
}

/** 用 TS 扫描器收集「字符串字面量 / 模板串文本 / JSX 文本」里的 CJK。 */
function scan(file: string, src: string): Offender[] {
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: Offender[] = [];
  const check = (text: string, kind: string, node: ts.Node) => {
    if (!CJK.test(text)) return;
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({
      file,
      line: pos.line + 1,
      kind,
      text: text.trim().slice(0, 60),
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) check(node.text, "string", node);
    else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      check(node.text, "template", node);
    } else if (ts.isTemplateExpression(node)) {
      check(node.head.text, "template", node);
      for (const span of node.templateSpans)
        check(span.literal.text, "template", span);
    } else if (ts.isJsxText(node)) check(node.text, "jsx", node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("i18n: no hardcoded CJK in user-facing literals", () => {
  it("finds no untranslated CJK outside the allowlist", () => {
    const roots = [join(REPO, "src"), join(REPO, "addon", "content")];
    const offenders: Offender[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const rel = relative(REPO, file).split("\\").join("/");
        if (ALLOWLIST[rel] || BUILT.has(rel)) continue;
        offenders.push(...scan(rel, readFileSync(file, "utf-8")));
      }
    }
    expect(
      offenders.map(
        (o) => `${o.file}:${o.line} [${o.kind}] ${JSON.stringify(o.text)}`,
      ),
      "CJK must be moved to FTL (zh-CN/zh-TW/en-US) - see the test header",
    ).toEqual([]);
  });

  it("keeps allowlist entries explained and existing", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(10);
      expect(statSync(join(REPO, file)).isFile(), `${file} still exists`).toBe(
        true,
      );
    }
  });
});
