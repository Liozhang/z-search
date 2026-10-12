/**
 * abortSignal — 沙箱可用超时/合并信号垫片的单测。
 *
 * 宿主背景（2026-09-30 实机）：Zotero 10 引导沙箱不暴露 AbortSignal 全局，
 * 裸调 AbortSignal.timeout 毫秒级抛 ReferenceError（翻译引擎事故）。垫片
 * 三层回退：AbortSignal.timeout → AbortController + setTimeout → undefined。
 * 本文件通过增删 globalThis 上的全局对象复刻三种宿主形态。
 *
 * @module tests/unit/utils/abortSignal
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { timeoutSignal, withTimeout } from "../../../src/utils/abortSignal";

const G = globalThis as any;
const savedSignal = G.AbortSignal;
const savedController = G.AbortController;

afterEach(() => {
  vi.useRealTimers();
  G.AbortSignal = savedSignal;
  G.AbortController = savedController;
});

describe("timeoutSignal（三层回退）", () => {
  it("宿主有 AbortSignal.timeout → 直接返回", () => {
    const signal = timeoutSignal(50);
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
  });

  it("缺 AbortSignal 但有 AbortController → 到时中止", () => {
    vi.useFakeTimers();
    delete G.AbortSignal;
    const signal = timeoutSignal(100)!;
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(150);
    expect(signal.aborted).toBe(true);
  });

  it("两者皆缺 → undefined（放弃超时，不抛错）", () => {
    delete G.AbortSignal;
    delete G.AbortController;
    expect(timeoutSignal(100)).toBeUndefined();
  });
});

describe("withTimeout（调用方取消 + 超时合并）", () => {
  it("只传调用方信号、宿主无任何超时能力 → 原样返回调用方信号", async () => {
    delete G.AbortSignal;
    delete G.AbortController;
    const caller = new (class {})() as AbortSignal;
    expect(withTimeout(caller, 100)).toBe(caller);
  });

  it("合并信号：调用方中止 → 合并信号中止", async () => {
    const ctl = new AbortController();
    const combined = withTimeout(ctl.signal, 1_000_000)!;
    ctl.abort();
    expect(combined.aborted).toBe(true);
  });

  it("合并信号：超时先到 → 合并信号中止", async () => {
    vi.useFakeTimers();
    // 强制走手工桥接分支，让 fake timers 能推动超时
    delete G.AbortSignal;
    const callerCtl = new G.AbortController();
    const combined = withTimeout(callerCtl.signal, 100)!;
    vi.advanceTimersByTime(150);
    expect(combined.aborted).toBe(true);
    expect(callerCtl.signal.aborted).toBe(false);
  });

  it("调用方信号为 undefined 时直接返回超时信号", () => {
    const combined = withTimeout(undefined, 100);
    expect(combined).toBeDefined();
  });

  it("调用方信号进入前已中止（手工桥接路径）→ 合并信号立即中止", () => {
    // 强制走手工桥接分支：abort 事件只在状态跃迁时触发，已中止信号不会
    // 再发事件——不判即时状态的话，调用方的取消会被静默丢弃。
    delete G.AbortSignal;
    const callerCtl = new G.AbortController();
    callerCtl.abort();
    const combined = withTimeout(callerCtl.signal, 100)!;
    expect(combined).toBeDefined();
    expect(combined.aborted).toBe(true);
  });
});
