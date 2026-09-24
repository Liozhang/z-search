/**
 * 纯 ISO 日期格式化（leaf 模块）。
 *
 * 为什么单独成文件：这个函数被**两棵树的 locale 实现**同时需要——
 * `src/utils/locale.ts`（主进程/ XUL 侧）与 `src/react/utils/locale.ts`
 * （iframe 侧）的 `formatRelativeTime` 都要在「≥7 天」档回落绝对日期。
 * 若 react 侧直接 import `react/utils/format`，会与 `format.ts → locale.ts
 * (getLocaleTag)` 形成循环依赖；若两边各自手拼，就是同一格式的第三份副本。
 * 故实现落此 leaf（零依赖，可被两棵树安全引用），`react/utils/format.ts`
 * 只做 re-export 保持 12 个既有消费端不变。
 *
 * 格式固定 ISO，不随 locale 漂移。
 *
 * 2026-08-24 审计修正（原实现走 Intl.DateTimeFormat(locale)）：en-US 下渲染
 * "07/09/2026"（M/D/YYYY）——与本函数承诺的 ISO 相悖，且月日歧义
 * （7月9日 vs 9月7日）。日期无歧义优先于本地化习惯，手工拼 ISO。
 *
 * 2026-09-15 部署包评审 H-4：两条 `formatRelativeTime` 的兜底分支此前各自走
 * `toLocaleDateString()`，于是首页/关注页的「≥7 天」项显示 "2026/9/8"，
 * 而研究任务列表显示 "2026-09-04"——同一产品两种日期格式。现两条路径统一
 * 到本函数。
 */
export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
