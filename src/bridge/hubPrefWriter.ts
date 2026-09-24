/**
 * hubPrefWriter — Hub 搜索设置的 host 侧写入 + 副作用触发层（z-search 精简版）。
 *
 * 覆盖搜索设置需要的写入：
 *  1. setPrefDynamic 写入 pref（pref 系统是进程内单例，跨窗口立即可见）
 *  2. 外部 API key 变更 → 触发 ProviderHealthChecker（debounce 500ms）
 *  3. 跨窗口广播 'zsearch:prefChanged' 通知（best-effort）
 *
 * @module bridge/hubPrefWriter
 */

import { setPrefDynamic } from "../utils/prefs";
import { safeDebug } from "../utils/logger";
import { broadcastPrefChanged } from "./broadcastPrefChanged";
import { toErrorMessage } from "../utils/error";

/** Provider/model 写入结果。 */
export interface PrefWriteResult {
  success: boolean;
  error?: string;
}

// ==================== Health check debounce ====================

let healthCheckTimer: ReturnType<typeof setTimeout> | null = null;
const HEALTH_CHECK_DEBOUNCE_MS = 500;
let healthCheckRunning = false;
// 运行中收到的新触发不再被丢弃，而是记为 pending，当前检查结束后补跑一次。
let healthCheckRerunPending = false;

async function runHealthCheck(): Promise<void> {
  if (healthCheckRunning) {
    healthCheckRerunPending = true;
    return;
  }
  healthCheckRunning = true;
  try {
    const { default: providerHealthChecker } =
      await import("../core/search/ProviderHealthChecker");
    await providerHealthChecker.runAllTests().catch((e) => {
      safeDebug("[z-search] hubPrefWriter: provider health warm failed: " + e);
    });
  } catch (e) {
    // best-effort：健康检查失败不阻塞写入
    safeDebug("[z-search] hubPrefWriter: health check failed: " + e);
  } finally {
    healthCheckRunning = false;
    if (healthCheckRerunPending) {
      healthCheckRerunPending = false;
      void runHealthCheck();
    }
  }
}

/** 调度一次 debounce 后的 health check。连续写入只会触发一次执行。 */
export function scheduleHealthCheck(): void {
  if (healthCheckTimer) clearTimeout(healthCheckTimer);
  healthCheckTimer = setTimeout(() => {
    healthCheckTimer = null;
    void runHealthCheck();
  }, HEALTH_CHECK_DEBOUNCE_MS);
}

/** 取消挂起的 health check（仅在测试或销毁场景调用）。 */
export function cancelPendingHealthCheck(): void {
  if (healthCheckTimer) {
    clearTimeout(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// ==================== API key 写入 ====================

/**
 * 写一个外部 API key（web-search / academic 分组）。
 *
 * @param payload.key  dynamic pref key（如 "apis.semanticScholar.apiKey"）
 * @param payload.value 新值
 */
export async function setApiKey(payload: {
  key: string;
  value: string;
}): Promise<PrefWriteResult> {
  try {
    setPrefDynamic(payload.key, payload.value);
    // 外部 API key 影响 search provider 健康状态
    scheduleHealthCheck();
    broadcastPrefChanged(payload.key);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: toErrorMessage(e) };
  }
}
