/**
 * dataloader-jar-probe — DataLoader jar: 读取分支的实机验证。
 *
 * 背景（2026-10-13 用户实机）：打包 xpi 安装（rootURI 为 jar:file:...!/）下
 * 内置期刊数据集四阶段全部在读数据文件时瞬间失败。宿主
 * Zotero.File.getContentsAsync 对字符串只认 file: 前缀（其余转交
 * Zotero.HTTP.request/XHR，jar: 立即失败）；dev 的 file: 根不受影响，因此
 * 实机探针与 CI 从未暴露。DataLoader 已重写为 file:/resource:/jar: 分层。
 *
 * 本探针在真实 Zotero 10 上验证 jar: 分支的两段机制：
 *   1. DataLoader 同款 spec 解析：jar:file:<path>!/ → xpi 本地路径；
 *   2. nsIZipReader.getInputStream + Zotero.File.getContentsAsync(流) 读取
 *      包内 JSON 并 JSON.parse 通过。
 * 探针 xpi 由 .scaffold/build/addon 打包（scripts 侧生成，不进 git）。
 */
describe("dataloader jar-branch probe (real Zotero)", function () {
  this.timeout(60000);

  const XPI_PATH = "D:\\github_code\\z-search\\.scaffold\\zsearch-jar-probe.xpi";

  function fail(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[dataloader-jar-probe][${name}] ${reason}\n${e?.stack || ""}`.slice(
        0,
        1200,
      ),
    };
  }

  it("parses a jar: spec to the xpi path exactly like DataLoader step 3", function () {
    try {
      const jarSpec = `jar:file://${XPI_PATH.replace(/\\/g, "/")}!/`;
      const m = /^(jar:(file:[^!]+)!\/?)/.exec(jarSpec);
      if (!m) {
        throw { message: `spec regex failed for ${jarSpec}` };
      }
      const xpiPath = globalThis.Services.io
        .newURI(m[2])
        .QueryInterface(Components.interfaces.nsIFileURL).file.path;
      if (xpiPath.toLowerCase() !== XPI_PATH.toLowerCase()) {
        throw {
          message: `path round-trip mismatch: got ${xpiPath}`,
        };
      }
    } catch (e) {
      fail("spec-parse", e);
    }
  });

  it("reads data/warning.json from inside the xpi via nsIZipReader stream", async function () {
    try {
      const Cc = Components.classes;
      const Ci = Components.interfaces;
      const zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
        Ci.nsIZipReader,
      );
      zipReader.open(Zotero.File.pathToFile(XPI_PATH));
      try {
        if (!zipReader.hasEntry("data/warning.json")) {
          throw {
            message: `entry missing; names sample: ${zipReader.getEntriesNames?.().slice(0, 10)?.join(",")}`,
          };
        }
        const stream = zipReader.getInputStream("data/warning.json");
        try {
          const text = await Zotero.File.getContentsAsync(stream);
          const parsed = JSON.parse(text);
          if (!parsed || !Array.isArray(parsed.data)) {
            throw { message: "payload is not the expected warning envelope" };
          }
          if (parsed.data.length === 0) {
            throw { message: "payload has zero rows" };
          }
        } finally {
          stream.close();
        }
      } finally {
        zipReader.close();
      }
    } catch (e) {
      fail("jar-read", e);
    }
  });

  it("reads data/jcr-2024.json (5.3 MB) from inside the xpi", async function () {
    try {
      const Cc = Components.classes;
      const Ci = Components.interfaces;
      const zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
        Ci.nsIZipReader,
      );
      zipReader.open(Zotero.File.pathToFile(XPI_PATH));
      try {
        const stream = zipReader.getInputStream("data/jcr-2024.json");
        try {
          const text = await Zotero.File.getContentsAsync(stream);
          const parsed = JSON.parse(text);
          if (parsed.year !== 2024 || !Array.isArray(parsed.data)) {
            throw { message: `unexpected jcr envelope (year=${parsed.year})` };
          }
        } finally {
          stream.close();
        }
      } finally {
        zipReader.close();
      }
    } catch (e) {
      fail("jar-read-large", e);
    }
  });
});
