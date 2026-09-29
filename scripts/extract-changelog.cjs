// 提取 CHANGELOG.md 中当前版本的更新说明，输出到 stdout。
// 供 zotero-plugin-scaffold 的 release.changelog 使用：发布时 package.json
// 已完成版本号提升，故以 package.json 的 version 为准定位对应小节。
// 用法：node scripts/extract-changelog.cjs [版本号]（缺省取 package.json）。
const { readFileSync } = require("node:fs");

const version =
  process.argv[2] ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const text = readFileSync("CHANGELOG.md", "utf8");

const header = new RegExp(`^## \\[${version}\\]`, "m");
const start = text.search(header);
if (start === -1) {
  console.error(`CHANGELOG.md 中没有找到 [${version}] 小节`);
  process.exit(1);
}
const bodyStart = text.indexOf("\n", start) + 1;
const end = text.indexOf("\n## [", bodyStart);
const body = text.slice(bodyStart, end === -1 ? text.length : end).trim();
if (!body) {
  console.error(`CHANGELOG.md 的 [${version}] 小节没有内容`);
  process.exit(1);
}
console.log(body);
