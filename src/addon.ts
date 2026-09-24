import { config } from "../package.json";
import hooks from "./hooks";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    locale?: {
      current: any;
      /** Locale 缓存快照，惰性构建于首次子窗口 resolveAllLocaleKeys 调用时。 */
      cacheSnapshot?: Record<string, string>;
    };
    /** 设置侧栏偏好窗图标 URI（亮/暗按宿主主题选，bootstrap.js 注册时读）。 */
    prefPaneIcon?: string;
  };
  public hooks: typeof hooks;
  public api: object;

  /** Test/debug entry points, loaded after servicesInit. */
  public search?: {
    SearchPipeline: typeof import("./core/search/SearchPipeline").default;
    SemanticSearch: typeof import("./core/search/SemanticSearch").default;
    WebSearchProvider: typeof import("./core/search/WebSearchProvider").default;
    JournalSearchService: typeof import("./core/search/JournalSearchService").default;
    EmbeddingStore: typeof import("./core/search/EmbeddingStore").default;
    PdfChunkStore: typeof import("./core/search/PdfChunkStore").default;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
