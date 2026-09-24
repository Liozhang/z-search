/**
 * 学术检索源的 key 必需性（单一事实源）。
 *
 * `required: true` 与各源实现严格对齐：这三个源在拿不到 key 时**直接返回失败**
 * （core.ts / semantic-scholar.ts / dimensions.ts 的 `requires an API key`
 * 分支），故检索时该源会被整体跳过。其余源免 key 可用，key 只用于提限速
 * （pubmed / github token）。openalex 的免费 Key 走 api_key 查询参数
 * （utils/openalexAuth：mailto 池 2026 年初已废，含 @ 的旧值仍照发但服务端
 * 忽略）。
 *
 * 面板据此给「未填写」上 warn 色档，避免用户以为源在正常工作。
 */

export const ACADEMIC_KEY_REQUIRED: Readonly<Record<string, boolean>> = {
  "apis.core.apiKey": true,
  "apis.semanticScholar.apiKey": true,
  "apis.dimensions.apiKey": true,
};

export function isAcademicKeyRequired(prefKey: string): boolean {
  return ACADEMIC_KEY_REQUIRED[prefKey] === true;
}
