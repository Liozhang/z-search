/**
 * DatasetMetaFields — 数据集结果卡的来源特定元数据渲染。
 *
 * 19 个数据集源（+ GEO/PubChem/PANGAEA/ICPSR 等学科专用源）各有不同的
 * 关键元数据，本模块按 source id 分发渲染逻辑，每源取 2-4 个最有信息量
 * 的字段，以紧凑的行内文本呈现（与 researcher/grant 域的渲染风格一致）。
 *
 * 字段来源：DomainResult.metrics（数值型）与 DomainResult.extra（结构型），
 * 均由对应源适配器从 API 响应解析写入。
 *
 * @module react/components/Hub/search/DomainSearch/DatasetMetaFields
 */

import React from "react";
import type { DomainResult } from "./types";

/** 千分位格式化（下载量/引用数等大数可读化）。 */
function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 文件大小格式化（字节 → KB/MB/GB）。 */
function fmtSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** 分类阶元路径（GBIF 用：界 → 门 → 纲 → 目 → 科 → 属）。 */
function taxonomyPath(r: DomainResult): string {
  const parts = [
    r.extra?.kingdom,
    r.extra?.phylum,
    r.extra?.order,
    r.extra?.family,
    r.extra?.genus,
  ].filter(Boolean);
  return parts.join(" › ");
}

/** 行内字段片段（统一 text-xs text-muted-foreground 样式）。 */
function Field({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

/** 字段间距（首个字段不带 ml-2）。 */
function Gap({
  first,
  children,
}: {
  first: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className={first ? "" : "ml-2"}>
      <Field>{children}</Field>
    </span>
  );
}

/**
 * 按 source id 渲染数据集卡的元数据行。
 * 每个源取最具信息量的 2-4 个字段；缺失字段自动跳过，不留占位噪音。
 */
export function DatasetMetaFields({
  result,
}: {
  result: DomainResult;
}): React.ReactElement | null {
  const r = result;
  const src = r.source;

  // 通用：作者/创作者首作者（多源共有，抽到前面）
  const firstAuthor =
    (Array.isArray(r.extra?.authors) && r.extra.authors[0]) ||
    (Array.isArray(r.extra?.creators) && r.extra.creators[0]) ||
    "";

  /** 把字段片段数组包进统一的 div。 */
  const wrap = (fields: React.ReactNode[]) => {
    const visible = fields.filter(Boolean);
    if (visible.length === 0) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center">
        {visible.map((f, i) => (
          <Gap key={i} first={i === 0}>
            {f}
          </Gap>
        ))}
      </div>
    );
  };

  switch (src) {
    // ── ML/AI 专用 ──
    case "huggingface":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        r.metrics?.downloads
          ? `${fmtCount(Number(r.metrics.downloads))} downloads`
          : null,
        r.metrics?.likes ? `${fmtCount(Number(r.metrics.likes))} likes` : null,
        Array.isArray(r.extra?.taskTags) && r.extra.taskTags.length
          ? r.extra.taskTags.join(", ")
          : null,
        r.extra?.license || null,
      ]);

    case "kaggle":
      return wrap([
        r.extra?.owner ? `by ${r.extra.owner}` : null,
        r.metrics?.downloads
          ? `${fmtCount(Number(r.metrics.downloads))} downloads`
          : null,
        r.metrics?.likes ? `${fmtCount(Number(r.metrics.likes))} likes` : null,
        r.extra?.license || null,
      ]);

    case "uci":
      return wrap([
        r.extra?.area || null,
        Array.isArray(r.extra?.taskTags) && r.extra.taskTags.length
          ? r.extra.taskTags.join(", ")
          : null,
        r.metrics?.downloads
          ? `${fmtCount(Number(r.metrics.downloads))} downloads`
          : null,
      ]);

    case "openml":
      return wrap([
        r.metrics?.samples ? `${fmtCount(Number(r.metrics.samples))} samples` : null,
        r.metrics?.features ? `${r.metrics.features} features` : null,
        r.extra?.format || null,
      ]);

    // ── 通用仓储 ──
    case "zenodo":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        r.metrics?.fileSize ? fmtSize(Number(r.metrics.fileSize)) : null,
        r.metrics?.downloads
          ? `${fmtCount(Number(r.metrics.downloads))} downloads`
          : null,
        r.extra?.license || null,
      ]);

    case "figshare":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        r.metrics?.fileSize ? fmtSize(Number(r.metrics.fileSize)) : null,
        Array.isArray(r.extra?.categories) && r.extra.categories.length
          ? r.extra.categories.slice(0, 2).join(", ")
          : null,
        r.extra?.license || null,
      ]);

    case "dataverse":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        r.extra?.publisher ? `Publisher: ${r.extra.publisher}` : null,
        r.extra?.fileCount ? `${r.extra.fileCount} files` : null,
        Array.isArray(r.extra?.subjects) && r.extra.subjects.length
          ? r.extra.subjects.slice(0, 2).join(", ")
          : null,
      ]);

    case "osf":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        r.extra?.license || null,
        Array.isArray(r.extra?.tags) && r.extra.tags.length
          ? r.extra.tags.slice(0, 3).join(", ")
          : null,
      ]);

    case "dryad":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        r.metrics?.downloads
          ? `${fmtCount(Number(r.metrics.downloads))} downloads`
          : null,
        r.extra?.license || null,
      ]);

    case "datacite-search":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        r.extra?.publisher ? `Publisher: ${r.extra.publisher}` : null,
        r.metrics?.downloads
          ? `${fmtCount(Number(r.metrics.downloads))} downloads`
          : null,
        r.extra?.license || null,
      ]);

    // ── 政府/国际组织统计 ──
    case "worldbank":
      return wrap([
        r.extra?.source ? `Source: ${r.extra.source}` : null,
        Array.isArray(r.extra?.topics) && r.extra.topics.length
          ? r.extra.topics.slice(0, 2).join(", ")
          : null,
      ]);

    case "oecd":
      return wrap([
        r.extra?.agency ? `Agency: ${r.extra.agency}` : null,
        r.extra?.version ? `v${r.extra.version}` : null,
      ]);

    case "imf":
      return wrap([
        r.extra?.agency ? `Agency: ${r.extra.agency}` : null,
        r.extra?.version ? `v${r.extra.version}` : null,
      ]);

    case "eurostat":
      return wrap([
        r.extra?.dataSource ? `Source: ${r.extra.dataSource}` : null,
        r.extra?.lastUpdate ? `Updated: ${r.extra.lastUpdate}` : null,
      ]);

    case "who-gho":
      return wrap([r.extra?.indicatorCode ? `Code: ${r.extra.indicatorCode}` : null]);

    case "nasa":
      return wrap([
        r.extra?.organization ? `Org: ${r.extra.organization}` : null,
        Array.isArray(r.extra?.tags) && r.extra.tags.length
          ? r.extra.tags.slice(0, 3).join(", ")
          : null,
        r.extra?.license || null,
      ]);

    // ── 学科专用 ──
    case "gbif":
      return wrap([
        taxonomyPath(r) || null,
        r.extra?.rank ? `Rank: ${r.extra.rank}` : null,
      ]);

    case "geo":
      return wrap([
        r.extra?.organism || null,
        r.metrics?.samples ? `${fmtCount(Number(r.metrics.samples))} samples` : null,
        r.extra?.platform ? `Platform: ${r.extra.platform}` : null,
        r.extra?.entryType || null,
      ]);

    case "pubchem":
      return wrap([
        r.extra?.molecularFormula || null,
        r.extra?.molecularWeight ? `MW: ${r.extra.molecularWeight}` : null,
      ]);

    case "pangaea":
      return wrap([
        firstAuthor && <>by {firstAuthor}</>,
        Array.isArray(r.extra?.topics) && r.extra.topics.length
          ? r.extra.topics.slice(0, 2).join(", ")
          : null,
        r.extra?.license || null,
      ]);

    case "icpsr":
      return wrap([
        r.extra?.geographicCoverage || null,
        r.extra?.timePeriod || null,
        Array.isArray(r.extra?.topics) && r.extra.topics.length
          ? r.extra.topics.slice(0, 2).join(", ")
          : null,
      ]);

    case "ukds":
      return wrap([
        r.extra?.studyId ? `Study: ${r.extra.studyId}` : null,
      ]);

    // ── 注册目录 ──
    case "re3data":
      return wrap([
        Array.isArray(r.extra?.disciplines) && r.extra.disciplines.length
          ? r.extra.disciplines.slice(0, 2).join(", ")
          : null,
        r.extra?.repositoryType || null,
      ]);

    // ── 兜底：未知源只显示许可证和任务标签 ──
    default:
      return wrap([
        Array.isArray(r.extra?.taskTags) && r.extra.taskTags.length
          ? r.extra.taskTags.join(", ")
          : null,
        r.extra?.license || null,
      ]);
  }
}
