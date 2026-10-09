/**
 * parseChain — PDF 解析回退链的纯决策层。
 *
 * analyzePdf 的执行层（PdfAnalyzerPipeline）把「哪些后端按什么顺序参与、
 * 什么条件下跳过」全部交给这里，自身只负责逐层调用与错误放行。拆出纯函数
 * 是为了 vitest 能直接锁死回退矩阵（2026-10-04 修复：此前 ODL 缺 jar →
 * MinerU 缺 token 两连败后直接抛错，全新安装的 PDF 全文索引全军覆没——
 * 现在链尾恒有 Zotero 内建全文抽取兜底）。
 *
 * 链序原则：
 *   - 主后端（用户选的）最先；localOnly（后台自动动作）强制主层为 ODL
 *     （历史行为：忽略 mineru 选择，绝不触网）；
 *   - 云端 MinerU 只在配置了令牌（或自建模式）时入链——缺 token 的尝试
 *     是注定的失败，还会把错误文案顶给用户；
 *   - Zotero 内建抽取殿后：零依赖、纯本地，保证「总能抽出点文本」，
 *     代价是失去版面结构（单页块，无表格/公式）。
 *   - backendFallback=false 是用户的显式 fail-fast：只跑主后端，任何模式
 *     下都不追加层。
 *
 * @module core/pdf/parseChain
 */

export type ParseTierId = "opendataloader" | "mineru" | "zotero-fulltext";

export interface ParseChainInput {
  /** pdfParser.backend（空值按 opendataloader 处理）。 */
  backend: string;
  /** pdfParser.backendFallback（缺省 true）。 */
  fallback: boolean;
  /** AnalyzeOptions.localOnly：禁远程。 */
  localOnly: boolean;
  /** MinerU 云模式是否已有令牌（自建模式恒 true）。 */
  mineruAvailable: boolean;
}

/** 求解执行链。恒非空。 */
export function resolveParseChain(input: ParseChainInput): ParseTierId[] {
  const wantsMineru = input.backend === "mineru";

  // localOnly：禁远程。主层强制 ODL（沿用历史行为，忽略 mineru 选择），
  // fallback 开启时链尾补内建抽取（同为本地实现，不违反禁远程约束）。
  if (input.localOnly) {
    return input.fallback
      ? ["opendataloader", "zotero-fulltext"]
      : ["opendataloader"];
  }

  // 用户显式关闭回退：只跑主后端。
  if (!input.fallback) {
    return [wantsMineru ? "mineru" : "opendataloader"];
  }

  const chain: ParseTierId[] = [wantsMineru ? "mineru" : "opendataloader"];
  if (wantsMineru) {
    chain.push("opendataloader");
  } else if (input.mineruAvailable) {
    chain.push("mineru");
  }
  chain.push("zotero-fulltext");
  return chain;
}
