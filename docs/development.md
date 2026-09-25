# 开发文档

面向贡献者的构建、部署、测试与发布流程。用户向说明见 [README](../README.md)。

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
