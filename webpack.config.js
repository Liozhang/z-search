import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import webpack from "webpack";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);

export default (env, argv) => {
  const mode = argv.mode || "production";

  return {
    mode,
    target: "web",
    cache: {
      type: "filesystem",
      buildDependencies: {
        config: [__filename],
      },
    },
    entry: ["./src/react/utils/gcsGuard.ts", "./src/react/index.tsx"],
    /* dev 模式 = 快速迭代（不压缩 + 可读名），但必须部署安全：
       外置 source map（.map 文件 devtools 懒加载，JS 本体瘦）；
       React 走生产构建（NODE_ENV=production，消除 dev 运行时行为差异）。 */
    devtool: mode === "development" ? "source-map" : false,
    output: {
      // Write into the SOURCE tree (addon/content/) so `zotero-plugin build`
      // copies it into the artifact via the assets glob. Writing directly into
      // .scaffold/build meant every scaffold build wiped reactBundle.js.
      path: path.resolve(__dirname, "addon", "content"),
      filename: "reactBundle.js",
      library: "ZSearchReact",
      libraryTarget: "umd",
      globalObject: "this",
      umdNamedDefine: true,
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx|ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: "esbuild-loader",
            options: {
              target: "firefox140",
              jsx: "automatic",
              tsconfigRaw: '{ "compilerOptions": { "jsx": "react-jsx" } }',
            },
          },
        },
        {
          test: /\.css$/,
          type: "asset/source",
          exclude: /katex-bundled\.css$/,
          use:
            mode === "production"
              ? [
                  {
                    loader: path.resolve(
                      __dirname,
                      "scripts/css-minify-loader.cjs",
                    ),
                  },
                ]
              : [],
        },
      ],
    },
    resolve: {
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      alias: {
        "@": path.resolve(__dirname, "src", "react"),
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        // dev 模式也注入 production：React 按 prod 运行时编译（行为与部署态一致）。
        "process.env.NODE_ENV": JSON.stringify("production"),
        __ZSEARCH_VERSION__: JSON.stringify(
          JSON.parse(readFileSync(new URL("./package.json", import.meta.url)))
            .version,
        ),
      }),
    ],
  };
};
