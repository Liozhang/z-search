/**
 * itemTreeMetricsColumn — 主窗条目树的期刊质量徽章列（P1-1）。
 *
 * Zotero ItemTreeManager 自定义列：对普通条目按 publicationTitle 归一化
 * 刊名做内存 Map 精确匹配，渲染 IF / JCR 分区 / 中科院分区 / 顶刊 / 预警 /
 * 掠夺性徽章——Ethereal Style / Green Frog 验证过的刚需，但匹配走离线
 * 数据的刊名归一化索引，不依赖 easyScholar key 与外网。
 *
 * 列渲染必须同步，而四张指标表是 SQLite 异步查询——启动时全量载入内存
 * （JCR ~19k + CASS ~11k + 预警/Bealls 数百行，<5 万行 O(几十 ms)），
 * 之后 O(1) 查表；数据随版本年更新，无失效问题。
 *
 * renderCell 以 ItemTree 为 this 调用（itemTree.js `renderCell.apply(this,
 * [index, data, column, isFirstColumn, document])`），经 this.getRow(index)
 * .ref 反查条目——这是富单元格渲染的唯一 item 通道。
 *
 * @module modules/itemTreeMetricsColumn
 */

import { getString } from "../utils/locale";
import { normalizeJournalName } from "../core/data/utils/normalize";
import { queryPlain } from "../core/data/queryPlain";
import { safeDebug } from "../utils/logger";

/** 刊名归一化 → 徽章数据（任一命中才有 entry）。 */
interface JournalBadges {
  jif?: number;
  jcrQuartile?: string;
  cassQuartile?: number;
  cassTop?: boolean;
  warning?: boolean;
  predatory?: boolean;
}

const DATA_KEY = "zsearchJournalMetrics";
let badgeMap: Map<string, JournalBadges> | null = null;
let registered = false;

/** 全量载入四张表的刊名索引（幂等；加载失败列降级为空单元格）。 */
async function loadBadgeMap(): Promise<Map<string, JournalBadges>> {
  if (badgeMap) return badgeMap;
  const map = new Map<string, JournalBadges>();
  const put = (name: unknown, patch: JournalBadges) => {
    const n = normalizeJournalName(String(name || ""));
    if (!n) return;
    const cur = map.get(n);
    map.set(n, cur ? { ...cur, ...patch } : patch);
  };
  try {
    const [jcrRows, cassRows, warnRows, beallsRows] = await Promise.all([
      queryPlain(
        `SELECT journal_name, jif, jif_quartile FROM zsearch_impact_factors WHERE jcr_year = (SELECT MAX(jcr_year) FROM zsearch_impact_factors) AND (jif IS NOT NULL OR jif_quartile IS NOT NULL)`,
      ),
      queryPlain(
        `SELECT journal_name, major_quartile, is_top FROM zsearch_cass_quartiles WHERE cass_year = (SELECT MAX(cass_year) FROM zsearch_cass_quartiles) AND major_quartile IS NOT NULL`,
      ),
      queryPlain(`SELECT journal_name FROM zsearch_journal_warnings`),
      queryPlain(`SELECT journal_name FROM zsearch_bealls_journals`),
    ]);
    for (const r of jcrRows) {
      put(r.journal_name, {
        jif: r.jif != null ? Number(r.jif) : undefined,
        jcrQuartile:
          typeof r.jif_quartile === "string" && /^Q[1-4]$/.test(r.jif_quartile)
            ? r.jif_quartile
            : undefined,
      });
    }
    for (const r of cassRows) {
      put(r.journal_name, {
        cassQuartile: r.major_quartile ?? undefined,
        cassTop: r.is_top === 1 || r.is_top === true,
      });
    }
    for (const r of warnRows) put(r.journal_name, { warning: true });
    for (const r of beallsRows) put(r.journal_name, { predatory: true });
    safeDebug(`[z-search] item-tree badge map loaded: ${map.size} journals`);
  } catch (e) {
    safeDebug("[z-search] badge map load failed: " + e);
  }
  badgeMap = map;
  return map;
}

/** 徽章单元格：横向紧凑 span 组合（色相只作强调，语义由文字承载）。 */
function renderBadges(doc: Document, b: JournalBadges): HTMLElement {
  const cell = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  ) as unknown as HTMLElement;
  // 内联样式：不向主窗注入样式表；字号/留白对齐 Zotero 单元格档
  const mk = (text: string, style: string, title?: string) => {
    const s = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    ) as unknown as HTMLElement;
    s.textContent = text;
    s.setAttribute(
      "style",
      `display:inline-block; margin-right:4px; padding:1px 5px; border-radius:3px; font-size:11px; line-height:16px; ${style}`,
    );
    if (title) s.setAttribute("title", title);
    return s;
  };
  const IF_STYLE = "color:#8a6d00; font-weight:600;";
  const Q_STYLE =
    "color:var(--fill-secondary); border:1px solid color-mix(in srgb, currentColor 30%, transparent);";
  const WARN_STYLE =
    "background:color-mix(in srgb, #e8a33d 18%, transparent); color:#8a5b00; font-weight:600;";
  const PRED_STYLE =
    "background:color-mix(in srgb, #cc2c2c 15%, transparent); color:#a51c1c; font-weight:600;";
  if (b.jif != null)
    cell.appendChild(
      mk(b.jif.toFixed(1), IF_STYLE, getString("itemtree-metrics-if-tip")),
    );
  if (b.jcrQuartile)
    cell.appendChild(
      mk(b.jcrQuartile, Q_STYLE, getString("itemtree-metrics-jcr-tip")),
    );
  if (b.cassQuartile)
    cell.appendChild(
      mk(
        `CAS ${b.cassQuartile}`,
        Q_STYLE,
        getString("itemtree-metrics-cass-tip"),
      ),
    );
  if (b.cassTop)
    cell.appendChild(mk("★", IF_STYLE, getString("itemtree-metrics-top-tip")));
  if (b.warning)
    cell.appendChild(mk("⚠", WARN_STYLE, getString("lit-warning")));
  if (b.predatory)
    cell.appendChild(
      mk(
        getString("journal-predatory-label"),
        PRED_STYLE,
        getString("journal-predatory-data-year"),
      ),
    );
  return cell;
}

/** 注册列（幂等）。windowLifecycle 在主窗加载时调用。 */
export async function registerMetricsColumn(): Promise<void> {
  if (registered) return;
  try {
    const mgr = (Zotero as any).ItemTreeManager;
    if (!mgr?.registerColumn) return;
    await loadBadgeMap();
    mgr.registerColumn({
      dataKey: DATA_KEY,
      label: getString("itemtree-metrics-column"),
      pluginID: "zsearch@z-search.dev",
      enabledTreeIDs: ["*"],
      // 默认可见（列选择器可隐藏）——发现性优先，与徽章刚需定位一致
      defaultIn: ["*"],
      width: "150",
      showInColumnPicker: true,
      zoteroPersist: ["width", "hidden", "sortDirection"],
      dataProvider: (item: any, _dataKey: string): string => {
        try {
          if (!item?.isRegularItem?.()) return "";
          const b = badgeMap?.get(
            normalizeJournalName(
              String(item.getField("publicationTitle") || ""),
            ),
          );
          if (!b) return "";
          // 排序键：IF 数值语义用零填充近似（列排序为字典序）
          return String(b.jif ?? 0).padStart(8, "0");
        } catch {
          return "";
        }
      },
      renderCell: function (
        this: any,
        index: number,
        _data: string,
        _column: any,
        _isFirstColumn: boolean,
        doc: Document,
      ): HTMLElement {
        try {
          const item = this.getRow?.(index)?.ref;
          if (!item?.isRegularItem?.()) return doc.createElement("span");
          const b = badgeMap?.get(
            normalizeJournalName(
              String(item.getField("publicationTitle") || ""),
            ),
          );
          if (!b) return doc.createElement("span");
          return renderBadges(doc, b);
        } catch {
          return doc.createElement("span");
        }
      },
    });
    registered = true;
  } catch (e) {
    safeDebug("[z-search] metrics column register failed: " + e);
  }
}

export function unregisterMetricsColumn(): void {
  try {
    (Zotero as any).ItemTreeManager?.unregisterColumn?.(DATA_KEY);
  } catch {
    /* best-effort */
  }
  registered = false;
}
