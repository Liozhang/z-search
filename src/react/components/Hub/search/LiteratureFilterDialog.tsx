/**
 * LiteratureFilterDialog — 文献搜索筛选弹窗（页面全部过滤与选择器的唯一面）。
 *
 * 2026-09-23 双 tab 化改版：弹窗按 tab（scope）分流分区——
 * - web（网络搜索）：「来源与引擎」外部数据源多选（全不选=全部）+
 *   「查询条件」年份对+预设 / 外部源取回排序 / 结果数上限 / 作者 / 期刊；
 * - local（本地搜索）：「库内全文范围」全文检索开关 + 章节限定 + 结果数上限。
 * includeLibrary 开关随混列表退役——tab 即范围，不再有「这一路参不参与」。
 *
 * 复用 GraphFilterDialog 三段式骨架与 hub-graph-filter-* 类族——该类族是
 * Hub 筛选弹窗的通用语言（图谱/文献两处单源），非图谱私有。
 *
 * 生效契约（2026-08-25 用户裁决）：无「应用」钮、改动即时上抛，但到下次
 * 搜索才生效——外部 API 有请求成本，弹窗不触发重查；footer 右置已启用
 * 计数，不做图谱式的实时结果计数。
 *
 * 年份：起止 NumberField 对 + 快捷预设（锚点=当前年；图谱版锚点=数据派生
 * fullRange）。桥接层 year 契约只认「单年份」或「lo-hi 闭区间」
 * （openalex/crossref 均 parseInt 或 includes("-") 分流）——只填结束年没有
 * 无歧义表达，序列化时塌缩为未设置；输入框本地态保留半对，成对后即生效。
 *
 * @module react/components/Hub/search/LiteratureFilterDialog
 */

import React, { useEffect, useRef, useState } from "react";
import { getString } from "../../../utils/locale";
import { CloseIcon } from "../../../utils/icons";
import { ICON } from "../../../utils/iconSizes";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { Toolbar } from "@base-ui/react/toolbar";
import { Separator } from "@base-ui/react/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import Button from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { SearchInput } from "@/components/ui/SearchInput";
import { Toggle as Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SORT_OPTIONS, AVAILABLE_SOURCES } from "./LiteratureSearch/types";
import { SECTION_OPTIONS } from "./Semantic/types";

/** 弹窗托管的全部搜索前配置——页面除查询/结果外不再有第二配置面。
 *  2026-09-23：双 tab 后同一结构体按 scope 取用不同字段子集（页面负责
 *  组装/写回）；includeLibrary 删除（tab 即范围）。 */
export interface LiteratureFilterValues {
  // 来源与引擎（web）
  selectedSources: string[];
  // 查询条件（web）
  yearRange: string;
  sortBy: string;
  maxResults: number;
  author: string;
  journal: string;
  // 库内全文范围（local）
  useFullText: boolean;
  sectionCategory: string | undefined;
}

/** 弹窗分流的两个面：网络=外部数据库，本地=文库。 */
export type FilterScope = "web" | "local";

function getDefaultLiteratureFilters(
  scope: FilterScope = "web",
): LiteratureFilterValues {
  const now = new Date().getFullYear();
  return {
    selectedSources: [],
    yearRange: `${now - 10 + 1}-${now}`,
    sortBy: "cited",
    // 结果数默认值按域：外部源 100（桥接上限），库内语义 10（引擎惯例密度）。
    maxResults: scope === "web" ? 100 : 10,
    author: "",
    journal: "",
    useFullText: false,
    sectionCategory: undefined,
  };
}

function sameSources(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

export function isDefaultLiteratureFilters(
  v: LiteratureFilterValues,
  scope: FilterScope = "web",
): boolean {
  const def = getDefaultLiteratureFilters(scope);
  return (
    sameSources(v.selectedSources, def.selectedSources) &&
    v.yearRange === def.yearRange &&
    v.sortBy === def.sortBy &&
    v.maxResults === def.maxResults &&
    v.author === def.author &&
    v.journal === def.journal &&
    v.useFullText === def.useFullText &&
    v.sectionCategory === def.sectionCategory
  );
}

/** 触发钮角标 / footer 右置计数：偏离默认值的维度数（每维计 1）。
 *  只数当前 scope 可见的维度——后台 tab 改过的外部字段不在本地弹窗露面，
 *  计数不得把用户看不见的维度算进来。 */
export function countActiveLiteratureFilters(
  v: LiteratureFilterValues,
  scope: FilterScope = "web",
): number {
  const def = getDefaultLiteratureFilters(scope);
  return scope === "web"
    ? (v.selectedSources.length > 0 ? 1 : 0) +
        (v.yearRange !== def.yearRange ? 1 : 0) +
        (v.sortBy !== def.sortBy ? 1 : 0) +
        (v.maxResults !== def.maxResults ? 1 : 0) +
        (v.author !== def.author ? 1 : 0) +
        (v.journal !== def.journal ? 1 : 0)
    : (v.maxResults !== def.maxResults ? 1 : 0) +
        (v.useFullText ? 1 : 0) +
        (v.sectionCategory != null ? 1 : 0);
}

// ── yearRange 串 ↔ 起止数字对 ────────────────────────────────────────────
// 桥接契约：单年份 "2022" 或闭区间 "2020-2024"。

function parseYearRange(raw: string): { lo: number | null; hi: number | null } {
  const m = /^\s*(\d{4})(?:\s*[-–]\s*(\d{4}))?\s*$/.exec(raw);
  if (!m) return { lo: null, hi: null };
  return { lo: Number(m[1]), hi: m[2] ? Number(m[2]) : null };
}

function serializeYearRange(lo: number | null, hi: number | null): string {
  if (lo != null && hi != null) {
    return lo <= hi ? `${lo}-${hi}` : `${hi}-${lo}`;
  }
  if (lo != null) return `${lo}`;
  return ""; // 只填结束年：无桥接契约 → 不生效（见文件头注释）
}

// 快捷预设（标签键复用图谱年份预设：近5年/近10年/全部同文案）；
// 锚点=当前年——文献检索没有图谱式的数据派生 fullRange。
const YEAR_PRESET_DEFS: ReadonlyArray<{ key: string; years: number | null }> = [
  { key: "hub-graph-filter-year-5y", years: 5 },
  { key: "hub-graph-filter-year-10y", years: 10 },
  { key: "hub-graph-filter-year-all", years: null },
];

interface Props {
  open: boolean;
  /** 2026-09-23：按 tab 分流分区（web=来源/查询，local=库内全文范围）。 */
  scope?: FilterScope;
  values: LiteratureFilterValues;
  onChange: (next: LiteratureFilterValues) => void;
  onClose: () => void;
}

/** 区容器：overline 区标签 + 节堆叠（区级节拍由 Separator 的 breakout 边距负责）。 */
function FilterZone({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="hub-graph-filter-group">
      <div className="hub-graph-filter-group-label">{label}</div>
      <div className="flex flex-col gap-[var(--space-3)]">{children}</div>
    </div>
  );
}

export function LiteratureFilterDialog({
  open,
  scope = "web",
  values,
  onChange,
  onClose,
}: Props): React.ReactElement | null {
  // 快照：打开时保存当前值，「取消」还原（重置不关窗、可再取消找回）。
  const snapshotRef = useRef<LiteratureFilterValues>(values);
  useEffect(() => {
    if (open) snapshotRef.current = { ...values };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 年份对的字段本地态：applied 串表达不了「只填结束年」，半对输入留在
  // 本地。emittedRef 防回写环——外部值与本组件上次上抛一致时不回灌字段
  // （否则塌缩中的半对会被空串冲掉）；取消快照/重置走不同串，正常回灌。
  const [yearLo, setYearLo] = useState<number | null>(null);
  const [yearHi, setYearHi] = useState<number | null>(null);
  const emittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (emittedRef.current === values.yearRange) return;
    const parsed = parseYearRange(values.yearRange);
    setYearLo(parsed.lo);
    setYearHi(parsed.hi);
    emittedRef.current = values.yearRange;
  }, [open, values.yearRange]);

  const applyYearPair = (lo: number | null, hi: number | null) => {
    setYearLo(lo);
    setYearHi(hi);
    const next = serializeYearRange(lo, hi);
    emittedRef.current = next;
    if (next !== values.yearRange) onChange({ ...values, yearRange: next });
  };

  const isPresetActive = (years: number | null): boolean => {
    const now = new Date().getFullYear();
    if (years === null) return yearLo == null && yearHi == null;
    return yearLo === now - years + 1 && yearHi === now;
  };

  // 标题按域：网络=文献筛选（外部来源），本地=文库筛选。
  const titleKey =
    scope === "web" ? "hub-lit-filter-title" : "hub-lit-filter-title-local";

  if (!open) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      modal
    >
      <DialogContent
        className="w-[var(--form-dialog-width)] max-w-[90vw] max-h-[var(--dialog-max-h)] flex flex-col p-0 gap-0 hub-graph-filter-dialog"
        ariaLabel={getString(titleKey)}
        showCloseButton={false}
      >
        <Toolbar.Root className="hub-graph-filter-header py-[var(--space-3)] px-[var(--space-4-5)] flex justify-between items-center">
          <span className="[font:var(--ui-font-heading)] text-[color:var(--text-primary)] m-0">
            {getString(titleKey)}
          </span>
          <DialogClose
            className="hub-graph-filter-close bg-transparent border-none cursor-pointer text-[color:var(--text-secondary)] py-[var(--space-0-5)] px-[var(--space-1-5)] leading-[var(--leading-none)] transition-colors duration-[var(--transition-fast)] hover:text-[color:var(--text-primary)]"
            aria-label={getString("btn-close")}
          >
            <CloseIcon size={ICON.md} />
          </DialogClose>
        </Toolbar.Root>

        <ScrollArea className="hub-graph-filter-body">
          {/* 生效契约提示（原型 zone overline 同位）：改了不重查，下次搜索带上 */}
          <div className="px-[var(--space-4-5)] pt-[var(--space-3)]">
            {/* 2026-08-31 C3：死类 mb-0 删除——authored .hub-graph-filter-group-label
                恒胜 tw utilities 层，mb-0 永不生效 */}
            <span className="hub-graph-filter-group-label block">
              {getString("hub-lit-filter-effect-hint")}
            </span>
          </div>
          <div className="hub-graph-filter-body-content flex flex-col">
            {/* ═══ 2026-09-23 双 tab 分流：web=来源+查询，local=库内范围 ═══ */}
            {scope === "web" ? (
              <>
                {/* ═══ 区一 · 来源与引擎（外部数据源；tab 即范围，无库内开关） ═══ */}
                <FilterZone label={getString("hub-lit-filter-zone-sources")}>
                  <section className="hub-graph-filter-section">
                    <div className="hub-graph-filter-section-title">
                      {getString("lit-filter-sources")}
                    </div>
                    {/* 2026-09-02 拍板豁免「筛选≤4 定项→chip」阶梯法：来源组保持
                        chip 行（原型 :1641-1647 即 chip 行，非下拉），结构不动。 */}
                    <ToggleGroup
                      variant="filter"
                      multiple
                      value={values.selectedSources}
                      onValueChange={(v) =>
                        onChange({ ...values, selectedSources: v })
                      }
                      aria-label={getString("lit-filter-sources")}
                    >
                      {AVAILABLE_SOURCES.map((src) => (
                        <ToggleGroupItem key={src.value} value={src.value}>
                          {getString(src.labelKey)}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <div className="[font:var(--ui-font-caption)] text-[color:var(--text-tertiary)]">
                      {getString("hub-lit-filter-sources-hint")}
                    </div>
                  </section>
                </FilterZone>

                <Separator />

                {/* ═══ 区二 · 查询条件 ═══ */}
                <FilterZone label={getString("hub-lit-filter-zone-query")}>
                  {/* 发表年份：起止对 + 预设 */}
                  <section className="hub-graph-filter-section">
                    <div className="hub-graph-filter-section-title">
                      {getString("lit-year-range")}
                    </div>
                    <div className="hub-graph-filter-year-row">
                      <NumberField
                        value={yearLo}
                        min={1900}
                        max={9999}
                        step={1}
                        className="hub-graph-filter-year-field"
                        aria-label={getString("hub-graph-filter-year-from")}
                        onChange={(v) => applyYearPair(v ?? null, yearHi)}
                      />
                      <span className="hub-graph-filter-year-sep">—</span>
                      <NumberField
                        value={yearHi}
                        min={1900}
                        max={9999}
                        step={1}
                        className="hub-graph-filter-year-field"
                        aria-label={getString("hub-graph-filter-year-to")}
                        onChange={(v) => applyYearPair(yearLo, v ?? null)}
                      />
                    </div>
                    <ToggleGroup
                      variant="filter"
                      multiple={false}
                      value={[
                        YEAR_PRESET_DEFS.find((p) => isPresetActive(p.years))
                          ?.key ?? "",
                      ].filter(Boolean)}
                      onValueChange={(v) => {
                        if (!v.length) return;
                        const preset = YEAR_PRESET_DEFS.find(
                          (p) => p.key === v[0],
                        );
                        if (!preset) return;
                        if (preset.years === null) {
                          applyYearPair(null, null);
                        } else {
                          const now = new Date().getFullYear();
                          applyYearPair(now - preset.years + 1, now);
                        }
                      }}
                      aria-label={getString("lit-year-range")}
                    >
                      {YEAR_PRESET_DEFS.map((preset) => (
                        <ToggleGroupItem key={preset.key} value={preset.key}>
                          {getString(preset.key)}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </section>

                  {/* 排序：外部源取回序（区别于结果头的客户端显示排序） */}
                  <section className="hub-graph-filter-section">
                    <div className="hub-graph-filter-section-title">
                      {getString("hub-lit-filter-sort-ext")}
                    </div>
                    <ToggleGroup
                      variant="filter"
                      multiple={false}
                      value={[values.sortBy]}
                      onValueChange={(v) => {
                        if (v.length) onChange({ ...values, sortBy: v[0] });
                      }}
                      aria-label={getString("hub-lit-filter-sort-ext")}
                    >
                      {SORT_OPTIONS.map((o) => (
                        <ToggleGroupItem key={o.value} value={o.value}>
                          {getString(o.labelKey)}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </section>

                  {/* 结果数上限 */}
                  <section className="hub-graph-filter-section">
                    <div className="hub-graph-filter-section-title">
                      {getString("lit-max-results")}
                    </div>
                    <NumberField
                      value={values.maxResults}
                      min={1}
                      max={100}
                      step={1}
                      className="hub-graph-filter-year-field"
                      aria-label={getString("lit-max-results")}
                      onChange={(v) =>
                        onChange({
                          ...values,
                          maxResults: Math.max(1, Math.min(100, v ?? 100)),
                        })
                      }
                    />
                  </section>

                  {/* 作者 / 期刊 */}
                  <section className="hub-graph-filter-section">
                    <div className="hub-graph-filter-section-title">
                      {getString("lit-filter-author")}
                    </div>
                    <SearchInput
                      size="sm"
                      className="hub-graph-filter-keyword"
                      value={values.author}
                      onChange={(e) =>
                        onChange({ ...values, author: e.target.value })
                      }
                      placeholder={getString("lit-filter-author-placeholder")}
                    />
                  </section>
                  <section className="hub-graph-filter-section">
                    <div className="hub-graph-filter-section-title">
                      {getString("lit-filter-journal")}
                    </div>
                    <SearchInput
                      size="sm"
                      className="hub-graph-filter-keyword"
                      value={values.journal}
                      onChange={(e) =>
                        onChange({ ...values, journal: e.target.value })
                      }
                      placeholder={getString("lit-filter-journal-placeholder")}
                    />
                  </section>
                </FilterZone>
              </>
            ) : (
              /* ═══ 本地 tab：库内全文范围（全文开关 + 章节 + 结果数） ═══
                 没有「关掉库内」这个概念（tab 即范围），原 includeLibrary
                 禁用态整组退场。 */
              <FilterZone label={getString("hub-lit-filter-zone-library")}>
                <section className="hub-graph-filter-section">
                  <div className="hub-graph-filter-switch">
                    <Switch
                      checked={values.useFullText}
                      onChange={(v) => onChange({ ...values, useFullText: v })}
                      ariaLabel={getString("semantic-scope-fulltext")}
                    />
                    <div>{getString("semantic-scope-fulltext")}</div>
                  </div>
                  {values.useFullText && (
                    /* 2026-09-02 拍板豁免「筛选≤4 定项→chip」阶梯法：章节组保持
                       chip 行（原型 :1641-1647 即 chip 行，非下拉）。 */
                    <ToggleGroup
                      variant="filter"
                      multiple={false}
                      value={[values.sectionCategory ?? ""]}
                      aria-label={getString("semantic-section-any")}
                      onValueChange={(v) => {
                        if (!v.length) return;
                        const found = SECTION_OPTIONS.find(
                          (o) => (o.value ?? "") === v[0],
                        );
                        onChange({
                          ...values,
                          sectionCategory: found?.value,
                        });
                      }}
                    >
                      {SECTION_OPTIONS.map((o) => (
                        <ToggleGroupItem key={o.labelKey} value={o.value ?? ""}>
                          {getString(o.labelKey)}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  )}
                </section>

                {/* 结果数上限（本地 tab 唯一可调的密度，绑语义腿 limit） */}
                <section className="hub-graph-filter-section">
                  <div className="hub-graph-filter-section-title">
                    {getString("lit-max-results")}
                  </div>
                  <NumberField
                    value={values.maxResults}
                    min={1}
                    max={100}
                    step={1}
                    className="hub-graph-filter-year-field"
                    aria-label={getString("lit-max-results")}
                    onChange={(v) =>
                      onChange({
                        ...values,
                        maxResults: Math.max(1, Math.min(100, v ?? 100)),
                      })
                    }
                  />
                </section>
              </FilterZone>
            )}
          </div>
        </ScrollArea>

        <Toolbar.Root className="hub-graph-filter-footer">
          <Toolbar.Group>
            <Button
              type="button"
              variant="ghost"
              size="default"
              onClick={() => {
                onChange({ ...snapshotRef.current });
                onClose();
              }}
            >
              {getString("btn-cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="default"
              disabled={isDefaultLiteratureFilters(values, scope)}
              onClick={() => onChange(getDefaultLiteratureFilters(scope))}
            >
              {getString("hub-graph-filter-reset")}
            </Button>
          </Toolbar.Group>
          {countActiveLiteratureFilters(values, scope) > 0 && (
            <span className="hub-graph-filter-count">
              {getString("hub-lit-filter-active-count", {
                args: { count: countActiveLiteratureFilters(values, scope) },
              })}
            </span>
          )}
        </Toolbar.Root>
      </DialogContent>
    </Dialog>
  );
}

export default LiteratureFilterDialog;
