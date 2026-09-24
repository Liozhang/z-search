/**
 * PatentNumberNormalizer — 专利号归一化与解析
 *
 * 目标：把不同 API 输出的专利号统一为可比较、可去重的 key。
 *
 * 各国专利号格式示例：
 *   US 9,999,999 B2  /  US9999999B2  /  US-9,999,999-B2
 *   EP 1 234 567 A1  /  EP1234567A1
 *   WO2020/123456 A1 /  WO2020123456A1
 *   CN 12345678 A    /  CN12345678A
 *   JP 特許第 5,123,456 号 / JP5123456B2
 *   KR 10-1234567-0001 / KR102012345671A
 *
 * 归一化目标格式：`<cc>-<digits>-<kind?>`，全小写
 *   例：US9999999B2 → "us-9999999-b2"
 *
 * ⚠ 学习模式贡献点：
 * 当前 parsePatentNumber 是保守的基础正则实现（覆盖 CC+数字+kind 主流格式）。
 * 完善方向（边界 case）：
 *   1. JP "特許第 N 号" 完整剥离（当前只处理了前缀）
 *   2. KR application 的 "10-" 前缀（KR 10-2020-01234567 → kr-10202001234567）
 *   3. WO/PCT 斜杠年份（WO 2020/123456 → wo-2020123456）
 *   4. kind code 是否保留影响去重精度（授权 B2 vs 公开 A1 是否视为同一专利）
 *      当前策略：保留 kind code（更精确）；若需"同族去重"可改为剥离。
 */

export interface ParsedPatentNumber {
  countryCode: string; // 2 字母，小写
  number: string; // 纯数字（含 WO 的年+序号）
  kindCode?: string; // kind code（A1/B2/...），小写
}

/**
 * 归一化专利号为去重 key。
 * @returns 归一化字符串（如 "us-9999999-b2"），无效输入返回 ""
 */
export function normalizePatentNumber(raw: string): string {
  if (!raw) return "";
  const parsed = parsePatentNumber(raw);
  if (!parsed) return "";
  const { countryCode, number, kindCode } = parsed;
  return kindCode
    ? `${countryCode}-${number}-${kindCode}`
    : `${countryCode}-${number}`;
}

/**
 * 解析专利号为结构化字段。
 * @returns ParsedPatentNumber 或 null（无法识别）
 */
export function parsePatentNumber(raw: string): ParsedPatentNumber | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase();

  // 去掉常见前缀：Patent / Pat. / No. / Number（可复合，如 "Patent No."）
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/^(PATENT|PAT\.|PATENT\s+NO\.?|NO\.?|NUMBER)\s*/i, "");
  }
  // 去掉 JP "特許第 N 号" 包裹
  s = s.replace(/^特許第\s*/, "").replace(/\s*号$/, "");

  // 匹配：2 字母国家码 + [分隔] + 数字(含逗号/空格/斜杠) + [分隔] + 可选 kind(A1/B2...)
  // kind code: 1 字母 + 0~1 数字（覆盖 A1/B2/U1/W1 等主流 kind）
  const m = s.match(
    /^([A-Z]{2})[\s\-/]*([\d][\d,\s/]*?\d)[\s\-/]*([A-Z]\d{0,1})?\s*$/,
  );
  if (!m) return null;

  const countryCode = m[1].toLowerCase();
  const number = m[2].replace(/[,\s/]/g, "");
  const kindCode = m[3] ? m[3].toLowerCase() : undefined;

  // 基本合法性：数字串至少 4 位
  if (number.length < 4) return null;

  return { countryCode, number, kindCode };
}

/**
 * 检测字符串是否看起来像专利号（用于 MetadataExtractor.autoDetect）。
 * 宽松匹配，宁可误判也不能漏（漏了无法识别专利输入）。
 */
export function looksLikePatentNumber(input: string): boolean {
  return parsePatentNumber(input) !== null;
}
