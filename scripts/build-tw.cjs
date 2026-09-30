/**
 * build-tw.cjs — tw.css 再生成（npm run build:tw）。
 *
 * 两步：① @tailwindcss/cli 按 scripts/tw-source.css 编译（裸工具类）；
 * ② 作用域前缀——给每个以点开头的规则行冠以 `.zsearch-root ` 祖先
 * （与入库产物的历史形态一致：限制工具类作用域、抬高层内特异性）。
 * v4 CLI 产物每行恰一个选择器，主题/属性两层的行不以点开头，
 * keyframes 内是百分数/from/to——单一规则即安全，无需解析器。
 *
 * 输入不入此脚本 juggles：源 = scripts/tw-source.css（入库），
 * 产物 = addon/content/chat/react/tw.css（入库）。
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(__dirname, "tw-source.css");
const TARGET = path.join(ROOT, "addon/content/chat/react/tw.css");
const TMP = path.join(ROOT, "node_modules/.cache/tw-raw.css");

fs.mkdirSync(path.dirname(TMP), { recursive: true });
// 解析 CLI 包的 JS 入口用 node 直跑——Windows 上 .bin 下的 sh 包装不可 spawn
const requireFromRoot = createRequire(path.join(ROOT, "package.json"));
const cliEntry = path.join(
  path.dirname(requireFromRoot.resolve("@tailwindcss/cli/package.json")),
  requireFromRoot("@tailwindcss/cli/package.json").bin.tailwindcss,
);
execFileSync(process.execPath, [cliEntry, "-i", SOURCE, "-o", TMP, "--quiet"], {
  stdio: "inherit",
});

const raw = fs.readFileSync(TMP, "utf8");
const scoped = raw.replace(/^( *)(\.)/gm, "$1.zsearch-root $2");
fs.writeFileSync(TARGET, scoped);

const rules = [...scoped.matchAll(/^ +\.zsearch-root /gm)].length;
console.log(`[build-tw] ${TARGET} 再生成完成：${rules} 条规则已加作用域前缀`);
