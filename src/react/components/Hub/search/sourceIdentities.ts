/**
 * sourceIdentities — 13 个搜索源的圆形来源徽标注册表。
 *
 * 仓库没有任何品牌 SVG 资产，精确复刻商标成本高：第一期用「品牌识别色
 * 圆底 + 白色缩写字标」，色值与缩写集中在此注册表，将来换正式 logo 资产
 * 只改这里。色值是品牌主色的近似——目标是「一眼可辨」，不是像素级复刻。
 */

export interface SourceIdentity {
  /** 圆底品牌识别色（hit 态）。 */
  color: string;
  /** 白色缩写字标（2-4 字符，圆内可读）。 */
  monogram: string;
}

export const SOURCE_IDENTITIES: Readonly<Record<string, SourceIdentity>> = {
  openalex: { color: "#E46E2E", monogram: "OA" },
  "semantic-scholar": { color: "#1B66C9", monogram: "S2" },
  crossref: { color: "#D9631E", monogram: "CR" },
  arxiv: { color: "#B31B1B", monogram: "X" },
  biorxiv: { color: "#BD2F2E", monogram: "bx" },
  medrxiv: { color: "#145E9C", monogram: "mx" },
  doaj: { color: "#E1641A", monogram: "DJ" },
  zenodo: { color: "#126FB5", monogram: "Z" },
  hal: { color: "#CC2418", monogram: "HAL" },
  core: { color: "#16A6C9", monogram: "CORE" },
  "europe-pmc": { color: "#1D70B8", monogram: "EPMC" },
  pubmed: { color: "#326599", monogram: "PM" },
  github: { color: "#24292F", monogram: "GH" },
};

/** 未注册源（理论上不出现——AVAILABLE_SOURCES 全覆盖有守卫测试）的兜底。 */
export function getSourceIdentity(source: string): SourceIdentity {
  return (
    SOURCE_IDENTITIES[source] ?? {
      color: "#6B7280",
      monogram: source.slice(0, 2).toUpperCase(),
    }
  );
}
