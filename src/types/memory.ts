// C3b（2026-09-14）：+"topic" 主题记忆试点 tier（两层记忆蓝本，CC memdir）。
// tier 列无 CHECK 约束，新增枚举值零 schema 迁移。
export type MemoryTier =
  "facts" | "history" | "profile" | "rules" | "summary" | "topic";
export type MemoryCategory =
  "user" | "project" | "reference" | "academic" | null;

export const PROFILE_DIMENSIONS = [
  "research_domain",
  "reading_style",
  "interaction_style",
  "output_preference",
  "tool_preference",
  "language_style",
] as const;

export type ProfileDimension = (typeof PROFILE_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<string, string> = {
  research_domain: "profile-dim-research-domain",
  reading_style: "profile-dim-reading-style",
  interaction_style: "profile-dim-interaction-style",
  output_preference: "profile-dim-output-preference",
  tool_preference: "profile-dim-tool-preference",
  language_style: "profile-dim-language-style",
};

export interface DimensionData {
  score: number;
  summary: string;
  observations: string[];
}

/**
 * Persisted-shape version of UserModelResult JSON.
 * v1 (legacy): LLM-only extraction, no `features`/`schemaVersion` — still
 * readable via normalizeUserModel() shape sniffing.
 */
export const USER_MODEL_SCHEMA_VERSION = 2;

/** How the persisted model was last (re)built. */
export type UserModelSource = "code" | "agent" | "hybrid";

/**
 * Quantified reading behavior — pure-code computation over
 * zsearch_reading_progress + zsearch_reading_time.
 */
export interface ReadingBehaviorFeatures {
  /** Tracked items behind these numbers; 0 = reading tracking never used. */
  sampleSize: number;
  statusCounts: {
    unread: number;
    reading: number;
    read: number;
    skimmed: number;
  };
  completionRate: number;
  avgProgress: number;
  totalReadingMinutes: number;
  activeDays: number;
  currentStreak: number;
  avgMinutesPerActiveDay: number;
}

/**
 * Quantified conversation patterns — pure-code computation over
 * zsearch_chat_sessions + zsearch_chat_messages.
 */
export interface ConversationPatternFeatures {
  /** Chat sessions analyzed; 0 = chat never used. */
  sampleSize: number;
  sessionsPerWeek: number;
  avgMessagesPerSession: number;
  avgUserMessageChars: number;
  userAssistantRatio: number;
  /** Session origins in whole percents; mutually exclusive, sums to 100. */
  contextMix: { item: number; collection: number; freeform: number };
  distinctSouls: number;
}

/**
 * Code-computed quantitative layer of the user model. Groups are optional:
 * an absent group means its extractor has not run; a present group with
 * sampleSize 0 means it ran but found no data.
 */
/**
 * Quantified library organization — pure-code computation over Zotero
 * items / collections / tags / itemTypes / itemRelations.
 */
export interface LibraryOrganizationFeatures {
  /** Top-level items (notes/attachments excluded) in the user library. */
  sampleSize: number;
  collectionCount: number;
  maxCollectionDepth: number;
  /** Share of items belonging to at least one collection (0-1). */
  collectionCoverage: number;
  /** Shannon entropy (natural log) over tag frequencies. */
  tagEntropy: number;
  distinctTags: number;
  itemTypeTop: Array<{ type: string; count: number }>;
  relationEdges: number;
}

/**
 * Quantified tool usage — pure-code computation over chat message
 * metadata.toolCalls and zsearch_token_usage.
 */
export interface ToolUsageFeatures {
  /** Assistant messages scanned for tool calls. */
  sampleSize: number;
  totalToolCalls: number;
  topTools: Array<{ name: string; calls: number; successRate: number }>;
  aiCallCount: number;
  byFeature: Array<{ feature: string; calls: number }>;
  topModels: Array<{ model: string; calls: number }>;
}

/**
 * Quantified research focus — pure-code computation over collections,
 * tags and zsearch_item_metrics. quartileMix is null when the JCR sample
 * is below the coverage threshold (sparse metrics must not imply taste).
 */
export interface ResearchFocusFeatures {
  sampleSize: number;
  topCollections: Array<{ name: string; items: number }>;
  topTags: Array<{ name: string; count: number }>;
  /** zsearch_item_metrics rows / sampleSize (0-1). */
  metricsCoverage: number;
  quartileMix: { q1: number; q2: number; q3: number; q4: number } | null;
}

/**
 * Quantified language preference — script shares over sampled user
 * messages plus the UI locale.
 */
export interface LanguagePreferenceFeatures {
  /** User messages scanned. */
  sampleSize: number;
  scriptShares: { cjk: number; latin: number; other: number };
  primaryScript: "cjk" | "latin" | "other" | null;
  uiLocale: string | null;
}

export interface FeatureSet {
  readingBehavior?: ReadingBehaviorFeatures;
  conversationPatterns?: ConversationPatternFeatures;
  libraryOrganization?: LibraryOrganizationFeatures;
  toolUsage?: ToolUsageFeatures;
  researchFocus?: ResearchFocusFeatures;
  languagePreference?: LanguagePreferenceFeatures;
}

export interface UserModelResult {
  dimensions: Record<string, DimensionData>;
  /** Code-computed quantitative layer (schemaVersion ≥ 2). */
  features?: FeatureSet;
  facts: Array<{ key: string; value: string }>;
  overall_summary: string;
  extractedAt: number;
  sessionCount: number;
  chunkCount: number;
  schemaVersion?: number;
  source?: UserModelSource;
}

export type ProfileExtractResult = UserModelResult | { aborted: true };

export interface MemoryEntry {
  id: string;
  soulId: string;
  tier: MemoryTier;
  key: string;
  content: string;
  timestamp: number;
  updatedAt: number;
  expiresAt?: number;
  category?: MemoryCategory;
}

export interface MemoryQuery {
  soulId: string;
  tier?: MemoryTier;
  key?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryStats {
  totalFacts: number;
  totalHistory: number;
  totalProfile: number;
  totalRules: number;
  totalSummary: number;
  bySoul: Record<
    string,
    {
      facts: number;
      history: number;
      profile: number;
      rules: number;
      summary: number;
    }
  >;
}
