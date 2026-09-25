/**
 * usePref — 响应式的 dynamic pref 读取 hook。
 *
 * 读取时机：
 *   1. 初次挂载：通过 bridge 读一次当前值
 *   2. pref 变化：监听 host 侧广播的 'zsearch:prefChanged' 事件，命中本 key 时重读
 *
 * 用途：Hub / Chat iframe 内需要"pref 改了即时刷新"的场景。写入侧通过
 *
 *
 *
 * Hub Settings 内对需要副作用的字段应直接用 hubRequest('settings.*')，不要用本 hook 的 setter。
 *
 * @module react/hooks/usePref
 */
import { useEffect, useState } from "react";
import { prefsGetDynamic, prefsSetDynamic } from "../utils/prefsHelpers";
import { getBridge } from "../utils/bridge";

export function usePref<T>(
  key: string,
  defaultValue: T,
): [T, (v: T) => Promise<void>] {
  const [value, setValue] = useState<T>(defaultValue);

  // 读 + 订阅变化
  useEffect(() => {
    // 受控模式（如 ToggleGroupField 不传 prefKey）以空 key 调用本 hook：
    // 跳过 bridge 读与订阅，值恒为 defaultValue。
    if (!key) return;
    let cancelled = false;
    // 序列号防止并发 refresh 竞态：短时间内多个 prefChanged 事件触发多个
    // prefsGetDynamic，慢请求后完成时会用陈旧值覆盖快请求的新值。只有最新
    // 一次 refresh 的结果才会被写入 state（修 #5）。
    let seq = 0;
    const refresh = async () => {
      const mySeq = ++seq;
      const v = await prefsGetDynamic(key);
      if (cancelled || mySeq !== seq) return; // 已被更新的 refresh 取代
      setValue(v ?? defaultValue);
    };
    refresh();

    const bridge = getBridge();
    if (!bridge) return;
    const unsub = bridge.on(
      "zsearch:prefChanged",
      (payload: { key?: string } | undefined) => {
        if (payload?.key === key) refresh();
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
    // defaultValue 故意不入 deps：避免每次重渲重建订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = async (v: T) => {
    setValue(v);
    if (!key) return;
    await prefsSetDynamic(key, v);
  };

  return [value, set];
}
