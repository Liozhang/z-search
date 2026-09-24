import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    // opendataloader-pdf-cli.jar 不再随包分发（24MB，见
    // OpenDataLoaderPdfClient.ts 头注）——需要此 PDF 后端时手动放入
    // 安装目录 core/pdf/lib/。
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage || "https://github.com/z-search/z-search",
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
          __buildVersion__: JSON.stringify(pkg.version),
        },
        banner: {
          js: `
// Expose globalThis as _globalThis — used throughout the codebase.
// Previously this helper was injected into the bundle as a side-effect of bundling ai@3;
// ai@7 no longer triggers it, so we define it explicitly here.
var _globalThis = globalThis;
// Polyfill console for Zotero SpiderMonkey environment
if (typeof console === 'undefined') {
  const logToZotero = (prefix, args) => {
    const msg = Array.from(args).map(a => {
      if (typeof a === 'string') return a;
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a, function(key, value) {
            if (typeof value === 'object' && value !== null) {
              if (value.nodeType) return '[DOM Node]';
              if (typeof value[Symbol.iterator] === 'function') return '[Iterable]';
            }
            return value;
          });
        } catch (e) {
          return '[Object]';
        }
      }
      return String(a);
    }).join(' ');
    if (typeof Zotero !== 'undefined' && Zotero.debug) {
      Zotero.debug(prefix + ' ' + msg);
    }
  };
  this.console = {
    log: function(...args) { logToZotero('[console.log]', args); },
    error: function(...args) { logToZotero('[console.error]', args); },
    warn: function(...args) { logToZotero('[console.warn]', args); },
    info: function(...args) { logToZotero('[console.info]', args); },
    debug: function(...args) { logToZotero('[console.debug]', args); },
    group: function() {},
    groupCollapsed: function() {},
    groupEnd: function() {},
    trace: function() {},
    table: function() {},
    time: function() {},
    timeLog: function() {},
    timeEnd: function() {},
    clear: function() {},
    count: function() {},
    assert: function() {},
    dir: function() {},
    dirxml: function() {}
  };
}
// Global console reference
var console = this.console;
// Polyfill Buffer for jszip (used by docx library) in Zotero SpiderMonkey environment
if (typeof Buffer === "undefined") {
  this.Buffer = {
    from: function(d, e) {
      if (typeof d === 'string') return new TextEncoder().encode(e || "utf-8");
      if (d instanceof Uint8Array || d instanceof ArrayBuffer) return new Uint8Array(d);
      return d;
    },
    isBuffer: function() { return false; },
    alloc: function(s) { return new Uint8Array(s); },
    concat: function(a, b) {
      var r = new Uint8Array(a.length + b.length);
      r.set(a);
      r.set(b, a.length);
      return r;
    },
  };
}
`,
        },
        // Drop console in production to reduce bundle noise
        drop: process.env.NODE_ENV === "development" ? [] : ["console"],
        // Post-build: replace problematic console calls
        write: true,
        bundle: true,
        target: "firefox140",
        plugins: [],
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    entries: "tests/zotero",
    waitForPlugin: "() => Zotero.ZSearch?.data?.initialized === true",
    mocha: { timeout: 30000 },
    watch: false,
  },

  release: {
    bumpp: {
      // bump 后本地执行生产构建：`npm run build` 是 --dev 变体（不压缩、
      // 保留 console），不能作为发布产物。
      execute: "npm run build:prod",
    },
    // github.enable 默认 "ci"：本地 release 只 bump + commit + tag + push，
    // 由 tag 触发的 GitHub Actions 创建 Release、上传 xpi 并维护
    // release tag 下的 update.json（更新清单）。
  },
});
