/**
 * select 触发器的取值/取文案语义（React 无关的纯函数，便于 node 环境单测）。
 *
 * 背景（2026-09-16 真机缺陷）：消费点用 `{ value: "", label: X }` 表达
 * 「空值本身是一个真实选项」（不归入／全部领域／不指定…）。旧实现把空串
 * 一律降级成「未选中」，触发器只剩 chevron 空壳，几处消费点靠额外传一个
 * 同名 placeholder 掩盖（BrainInsightsTab 的注释即该变通），没传的（研究
 * 表单的文献集/研究上下文）在真机上是空白。
 *
 * 现语义：
 *  - 根值：仅当选项表确有该空值选项时透传空串（此时它是被选中的真实选项）；
 *    否则维持 null（未选中，触发 placeholder 路径）。非空值原样透传，
 *    保持「陈旧值也显示」的既有行为。
 *  - 文案：选项表优先；无匹配且值为空才回落 placeholder；再否则显示原值。
 *
 * @module react/components/ui/selectValue
 */

/** 结构上兼容 `SelectOption`（避免与 select.tsx 形成 import 环）。 */
export interface SelectOptionLike {
  value: string;
  label: string;
}

/** 传给 Select Root 的 value：空串仅在选项表声明了空值选项时保留。 */
export function selectRootValue(
  value: string,
  options: SelectOptionLike[],
): string | null {
  if (value !== "") return value;
  return options.some((o) => o.value === "") ? "" : null;
}

/** 触发器中显示的文案。 */
export function selectTriggerLabel(
  value: string | null,
  options: SelectOptionLike[],
  placeholder?: string,
): string {
  const opt =
    value == null ? undefined : options.find((o) => o.value === value);
  if (opt) return opt.label;
  if (value == null || value === "") return placeholder || "";
  return value;
}
