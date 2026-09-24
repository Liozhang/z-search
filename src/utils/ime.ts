/**
 * ime — IME 安全键盘判别（2026-09-07 评审 W1-7/横切 #1）。
 *
 * 背景：全仓 window/容器级 keydown 分发点曾零 isComposing 守卫——中文组词
 * 期间按 Enter/方向键确认候选时，事件会先落入这些 handler（preventDefault+
 * stopPropagation 甚至劫持组词确认），实测把「选词」变成「发送/选中命令」。
 *
 * `keyCode === 229` 是 IME 组词事件的传统标记（旧 Gecko/部分输入法不上报
 * isComposing），两者并查兜底。立法：所有 window/容器级 keydown 分发点的
 * Enter/方向键/Escape 分支头部必须先过 isIMEComposing。
 *
 * 2026-09-16（欠账 A3-11 收尾）入参兼容 React 合成事件：react-dom 18 的
 * `SyntheticBaseEvent` 只按白名单复制 `KeyboardEventInterface` 字段
 * （key/code/keyCode/locale/…，react-dom.development.js:7205-7225 + :6842），
 * **不复制 isComposing**——`e.isComposing` 恒为 undefined。而组词期确认候选的
 * Enter 在 Gecko 的 `key` 仍是 `"Enter"`（即 keyCode 13，229 兜底不命中），
 * 于是 React handler 里直接 `isIMEComposing(e)` 的调用点判定形同虚设。
 * 故补 nativeEvent 分支：合成事件（`e.nativeEvent`）与原生事件同判。
 */

export function isIMEComposing(e: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  if (e.isComposing === true || e.keyCode === 229) return true;
  const native = e.nativeEvent;
  return native?.isComposing === true || native?.keyCode === 229;
}
