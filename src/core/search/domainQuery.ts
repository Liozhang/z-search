/**
 * domainQuery — 子域检索的查询方言层。
 *
 * 立法背景（2026-11-17 用户实测 + 线上接口验证）：各子域适配器把用户
 * 原始查询词原样塞进源站检索参数，而源站对连字符/下划线的解释南辕北辙，
 * 同一查询 "HLA-typing" 在不同标签页表现分裂——
 *  - NSF（基金）：keyword= 是全文「或」检索，"HLA-typing" 与 "HLA typing"
 *    实测返回同一批项目，"typing" 单独命中把「反射散射侧信道攻击」等
 *    无关项目顶到前列；短语化 keyword="HLA typing" 实测只剩免疫学项目；
 *  - NASA 开放数据（数据集）：查询串含非空格分隔符时整串被当作单一
 *    检索词宽松匹配，q=HLA-typing 实测 2234 条且与 q=typing 的 2231 条
 *    几乎一致；空格形式（「与」语义）诚实返回 0 条；
 *  - Dataverse（数据集）：多词查询在相关度排序下被高频词干（typing→type）
 *    淹没，q=HLA-typing 实测前列是「威权政体类型数据集」等只命中「类型」
 *    的条目；短语化实测 0 条（诚实空结果）；
 *  - GBIF（数据集）：species 检索是生物学名模糊匹配，q=HLA-typing 实测
 *    返回 505 条任意分类单元；空格形式收敛到 1 条。
 *
 * 解法：适配器声明查询方言（queryDialect），总线在扇出前统一改写——
 *  - normalized：分隔符折叠为空格（词间「与」语义的源）；
 *  - phrase：折叠后多词短语化加引号（「或」语义或词干淹没的源）；
 *  - 缺省不改写（raw），行为与历史逐字节一致。
 *
 * 两道护栏：
 *  1. 标识符查询不改写（复用 detectIdentifierQuery 的整串判定口径）——
 *     DOI 去文献页搜数据集是真实场景，折叠会把 10.1038/s41586-020-…
 *     拆成碎片；
 *  2. 排除语法不动——"HLA -typing" 里空格后的连字符是 Lucene 的排除
 *     运算符，折叠只作用于两侧都是字母/数字的分隔符。
 *
 * @module core/search/domainQuery
 */

import { detectIdentifierQuery } from "./identifierQuery";

/** 查询方言：见模块头。raw 为缺省，不需要显式声明。 */
export type QueryDialect = "normalized" | "phrase";

/**
 * 分隔符折叠：字母/数字之间的连字符与下划线折叠为单个空格，多余空白
 * 归一。大小写保留；词首/词前的连字符（排除运算符）不动。
 */
export function foldQuerySeparators(query: string): string {
  return query
    .replace(/[\p{L}\p{N}][-_]+[\p{L}\p{N}]/gu, (m) => m.replace(/[-_]+/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 短语化：先折叠分隔符，多词时整体加引号。单词不加引号（与不加等价）；
 * 已是引号开头的原样返回（用户自带短语语法时不叠加）；内部的引号剥除，
 * 避免中途闭合短语破坏语法。
 */
export function toPhraseQuery(query: string): string {
  const folded = foldQuerySeparators(query);
  if (!folded || folded.startsWith('"')) return folded;
  const bare = folded.replace(/"/g, "");
  return /\s/.test(bare) ? `"${bare}"` : bare;
}

/**
 * 按方言改写查询（总线扇出前的统一入口）。
 * 方言缺省返回原串；标识符查询（整串构成 DOI/arXiv/PMID）一律原样。
 */
export function applyQueryDialect(
  dialect: QueryDialect | undefined,
  query: string,
): string {
  if (!dialect) return query;
  if (detectIdentifierQuery(query)) return query;
  return dialect === "phrase"
    ? toPhraseQuery(query)
    : foldQuerySeparators(query);
}
