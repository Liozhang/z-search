/**
 * DomainSourceAdapter — 域搜索源适配器基类。
 *
 * 每个域下的每个数据源（如 patent/epo、dataset/huggingface）实现为适配器，
 * 统一暴露 search() 接口。适配器负责：
 *  1. 检查自身是否可用（key 配置、网络可达）
 *  2. 发起源站请求（复用 Zotero.HTTP / openalexRequest 等既有管道）
 *  3. 把源站返回映射为 DomainResult[]
 *  4. 失败时抛错（由 DomainSearchEngine 统一归类到 failedSources）
 *
 * 与 academic-search 适配器的区别：academic 适配器返回 any[]（松散结构），
 * 域适配器返回 DomainResult[]（强类型，含 dedupKey）。这是注册框架的类型
 * 安全边界——各域 schema 在 DomainResult 的通用字段上扩展。
 *
 * @module core/search/DomainSourceAdapter
 */

import type { DomainResult, DomainFilters } from "./domainTypes";

/** 适配器可用性检查结果。 */
export interface AdapterAvailability {
  available: boolean;
  /** 不可用原因（available=false 时非空，用于 skippedNoKey 名单） */
  reason?: string;
}

/**
 * 域搜索源适配器基类。
 * 子类只需实现 search()；默认 isAvailable() 返回 true（免 key 源）。
 */
export abstract class DomainSourceAdapter {
  /** 适配器唯一 id（如 "epo" / "google-patents" / "huggingface"） */
  abstract readonly id: string;

  /** 所属域 id（patent / dataset / ...），由注册表注入校验 */
  abstract readonly domainId: string;

  /** 显示名（进 UI 的源选择列表，不翻译） */
  abstract readonly label: string;

  /** 是否免 key（无 key 也能搜索） */
  abstract readonly noKey: boolean;

  /**
   * 可用性检查。默认实现：免 key 源恒可用；需 key 源检查
   * getPrefDynamic(keyPref) 是否配置。子类可覆写（如加网络探测）。
   */
  async isAvailable(): Promise<AdapterAvailability> {
    if (this.noKey) return { available: true };
    // 子类应在自身 fields 声明 keyPref；基类默认保守返回不可用，
    // 避免误用未配置 key 的源。
    return { available: false, reason: "not-configured" };
  }

  /**
   * 执行搜索。
   * @param query 用户原始查询
   * @param maxResults 单源上限（DomainSearchEngine 会按源数均分）
   * @param filters 域特定筛选
   * @returns DomainResult[]（失败时抛 Error）
   */
  abstract search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]>;

  /**
   * 单源详情查询（profile 用，如 researcher.profile / grant.profile）。
   * 默认返回 null（源不支持详情）；子类可覆写。
   */
  async profile(
    _sourceId: string,
  ): Promise<DomainResult | null> {
    return null;
  }
}
