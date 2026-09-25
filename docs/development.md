# 开发文档

面向贡献者的架构说明与构建、部署、测试、发布流程。用户向说明见
[README](../README.md)。

## 架构

```
src/
├── index.ts / addon.ts / hooks.ts     插件入口（bootstrap 生命周期）
├── core/search/                       搜索引擎层（管线/评分/融合/索引）
├── core/sources/academic-search/      学术源 + GitHub 仓库源适配器
├── core/ai core/embedding             AI provider 栈 + 嵌入（本地/API）
├── core/data                          期刊指标/预警/掠夺性名单数据栈
├── core/translation                   摘要翻译引擎
├── ui/hub/                            Hub 窗口 host 侧（精简 bridge + RPC handler）
├── bridge/                            iframe postMessage 桥（协议 zsearch-req/res/notify）
└── react/                             Hub iframe UI（SearchShell + 搜索面板 + ui kit）

addon/
├── content/hub/                       XUL 宿主窗 + iframe 壳
├── content/chat/react/*.css           设计令牌与 Hub 分区样式（<style> 注入）
├── data/                              JCR/CASS/预警/Bealls 离线数据集
├── prefs.js                           搜索相关偏好默认值
└── locale/                            en-US / zh-CN / zh-TW Fluent 文案
```

## 与 leadero 的差异（移植裁剪）

- 去除：聊天/Agent/深度研究工作流、学术脑、关注追踪、图谱、引用网络、
  阅读器等非搜索功能；搜索页的「知识库腿 / 追踪 / 深度研究」入口随之
  移除（`useMixedSearch` 简化为库内语义 + 外部学术两腿）
- 记忆系统（memory-observer）以轻量桩替代：`DiscoveryEngine` 的研究方向
  积累与库建议特性优雅降级（不报错、返回空）
- 命名空间：`leadero@leadero.dev` → `zsearch@z-search.dev`；DB 表
  `leadero_*` → `zsearch_*`；窗口类型 `leadero:hub` → `zsearch:hub`
- 构建管线：保留 webpack(React) + zotero-plugin-scaffold(addon) +
  esbuild(embed-frame)，去掉 leadero 的 30+ 个 CSS 约定检查脚本

## 构建

```bash
npm install          # 安装依赖
npm run build        # 构建 embed-frame + reactBundle + xpi 产物（.scaffold/build）
npm run build:prod   # 生产构建（压缩、去 console、产 xpi 与 update.json）
npm run build:react  # 只构建 React iframe bundle
npm run check:types  # tsc 双配置类型检查
npm test             # vitest：纯逻辑单测 + 宿主 bundle 冒烟
```

## 部署到本地 Zotero

```bash
npm run rebuild      # = 完整构建 + node scripts/deploy.js：拷贝产物到 profile、
                     # 清缓存、杀掉旧 Zotero、带 -jsconsole 重启
npm run restart      # 只部署重启（不重新构建）
```

profile 路径、Zotero 可执行文件路径在 `scripts/deploy.js` 顶部按本机调整；
工作区有未提交改动时需要 `npm run restart -- --allow-dirty` 放行。

## 测试

```bash
npm test             # vitest：纯逻辑单测（含富集/名单匹配/宿主 bundle 冒烟）
npm run test:zotero  # 真实 Zotero 内集成测试（mocha via zotero-plugin test）：
                     # 开 Hub 窗、验证 iframe React 树渲染、host 桥 RPC 路由、
                     # 结果卡徽章实机视觉核查（真实检索 + 截图落盘
                     # tests/zotero/sdt-out/，输出目录不可用时自动跳过）
```

`test:zotero` 需要通过 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` 指定本机 zotero.exe
（见 package.json）。集成套件会重建主插件包；改动 React iframe 侧代码后
先 `npm run build:react` 再跑，避免用到过期的 reactBundle。

## 发布

```bash
npm run release      # bump 版本号 → 生产构建 → commit/tag/push（v*）
                     # tag 触发 GitHub Actions：构建 xpi、创建 GitHub Release
                     # 并上传，在 `release` tag 下刷新 update.json（自动更新清单）
```

前置条件：`package.json` 的 `repository.url` 指向真实 GitHub 仓库——
manifest 的 `update_url` 和 xpi 下载地址都由它渲染，占位地址会让自动更新
静默失效。首个发布动作建议先本地跑一次 `npm run build:prod` 确认产物。
