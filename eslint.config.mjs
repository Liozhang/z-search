// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

// `zotero()` only honors `options.overrides` — it drops a top-level
// `ignores` field. So we spread its returned array and append our own
// ignore + override objects afterwards.
const baseConfig = zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "warn",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
          },
        ],
      },
    },
    {
      files: ["**/*.tsx"],
      rules: {
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
          },
        ],
      },
    },
    // ── scripts/ 与根目录构建配置 — Node.js 环境。
    {
      files: ["scripts/**/*.{js,cjs,mjs}", "*.config.js"],
      languageOptions: {
        globals: {
          ...globals.node,
        },
      },
      rules: {
        "no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
          },
        ],
      },
    },
    // ── vitest 单测 — vitest 全局（globals 包未提供 vitest 预设，手动声明）。
    {
      files: ["tests/unit/**/*.test.ts"],
      languageOptions: {
        globals: {
          describe: "readonly",
          it: "readonly",
          test: "readonly",
          expect: "readonly",
          vi: "readonly",
          beforeAll: "readonly",
          afterAll: "readonly",
          beforeEach: "readonly",
          afterEach: "readonly",
        },
      },
    },
    // ── Zotero 宿主集成测试（zotero-plugin test / mocha + chai）—
    //    运行在 Zotero 窗口内，可用 Zotero/Gecko 平台全局。
    {
      files: ["tests/zotero/**/*.spec.js"],
      languageOptions: {
        globals: {
          ...globals.mocha,
          ...globals.node,
          Zotero: "readonly",
          PathUtils: "readonly",
          IOUtils: "readonly",
          Services: "readonly",
          Cc: "readonly",
          Ci: "readonly",
          Cu: "readonly",
          ChromeUtils: "readonly",
          expect: "readonly",
          assert: "readonly",
          window: "readonly",
          document: "readonly",
        },
      },
    },
    // ── EmbeddingsManager — 同步 require shim 打破 esbuild 环形依赖，
    //    此上下文无法 await import。
    {
      files: ["src/core/ai/EmbeddingsManager.ts"],
      rules: {
        "@typescript-eslint/no-require-imports": "off",
      },
    },
    // ── zotero-plugin.config.ts — a Node ESM build config that legitimately
    //    uses require() to read files at build time.
    {
      files: ["zotero-plugin.config.ts"],
      rules: {
        "@typescript-eslint/no-require-imports": "off",
      },
    },
  ],
});

// React Hooks linting. Register the plugin manually and enable only the two
// classic rules so the pre-existing `// eslint-disable-* react-hooks/exhaustive-deps`
// directives in the copied code are honored.
export default [
  ...baseConfig,
  {
    files: ["**/*.tsx", "**/*.jsx", "**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Vendored / generated content must not be linted.
  {
    ignores: [
      "addon/**",
      ".scaffold/**",
      "build/**",
      "node_modules/**",
      "tmp/**",
      "coverage/**",
      "**/*.d.ts",
    ],
  },
];
