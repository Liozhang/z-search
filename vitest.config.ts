import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // 默认 5s 在满载的 Windows 开发机上会让纯逻辑测试也随机超时
    // （i18n 全量扫描实测 5.4s，并行时其他测试同样被拖过线），放宽到 30s。
    testTimeout: 30_000,
  },
});
