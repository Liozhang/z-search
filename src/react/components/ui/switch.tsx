/**
 * switch.tsx — shadcn/ui Switch（官方 v4 形态，Base UI 底座，leadero Toggle API）。
 *
 * 类串对齐 v4.shadcn.com 注册表；官方 data-[state=checked/unchecked] 翻译为
 * Base UI 的 data-checked / data-unchecked。对外 Toggle API
 * （checked/onChange/loading/disabled/ariaLabel）冻结不变。
 *
 * @module react/components/ui/switch
 */

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

export interface ToggleProps {
  /** 当前开关状态 */
  checked: boolean;
  /** 切换回调（点击或键盘 Space 时触发，传新状态） */
  onChange: (next: boolean) => void;
  /** 切换中（禁用点击 + 视觉反馈，避免重复请求） */
  loading?: boolean;
  /** 禁用（灰色不可交互） */
  disabled?: boolean;
  /** 可访问名称（aria-label），必填——开关本身无可见文本 */
  ariaLabel: string;
}

function Toggle({
  checked,
  onChange,
  loading = false,
  disabled = false,
  ariaLabel,
}: ToggleProps): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled || loading}
      className={cn(
        // §5.2 轨道 h-5 w-9（20×36，[MUST]）；2026-09-07 W3-A3：h-[1.15rem]
        // 非梯值 rem 字面量退役（13px 根窗下 18.4→14.95px，拇指溢出轨道）。
        // §5.2 旧阴影行（text-primary 模拟 Ring）已终裁废除（2026-09-07：v1.44
        // 单色制下黑轨黑环不可见，恢复行翻案）；选中态=滑块位移+轨道色差
        // +暗色拇指反色，无阴影。
        "peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:h-5 data-checked:w-9 data-unchecked:h-5 data-unchecked:w-9 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80",
        loading && "animate-pulse motion-reduce:animate-none",
      )}
      aria-label={ariaLabel}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // 36px 轨道左右各 2px 内距 → 行程 16px = 拇指自身宽（translate-x-full）
          "pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform data-checked:translate-x-full data-unchecked:translate-x-0 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Toggle };
export default Toggle;
