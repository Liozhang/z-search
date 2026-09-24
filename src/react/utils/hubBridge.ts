/**
 * Hub React 端 Bridge 工具。复用共享 bridge（参考 trackingBridge.ts）。
 * P1 仅用于 locale.getAll；后续 P2-P5 各功能接入时扩展调用方法。
 *
 * 注：React 端不直接 new PostMessageBridge（host 侧已设置 window.__bridge），
 * 因此沿用 utils/bridge.ts 的 bridgeRequest 模式，而非 plan 中给出的旧路径。
 */
import { bridgeRequest, bridgeNotify } from "./bridge";

export { bridgeRequest as hubRequest, bridgeNotify as hubNotify };
