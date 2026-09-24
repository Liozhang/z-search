/**
 * prefPaneIcon 单测——设置侧栏偏好窗图标的亮/暗切换。
 *
 * 背景见 src/modules/prefPaneIcon.ts 头部：深墨圆主标在 Zotero 暗色侧栏
 * （#303030）上对比度只有 1.32:1，选中行主题蓝（#4072e5）上圆外绯红柄只有
 * 1.35:1，所以暗底必须换浅墨圆变体。这里守住三件事：判据（prefers-color-scheme）
 * 别退化、DOM 补丁别打错元素、注册表同步别静默失效。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PREF_PANE_ICON_DARK,
  PREF_PANE_ICON_LIGHT,
  PREF_PANE_ID,
  applyIconToDoc,
  currentPrefPaneIconURI,
  isDarkScheme,
  readThemePref,
  syncRegisteredPaneImage,
} from "../../../src/modules/prefPaneIcon";

/** 造一个假的 chrome 窗口对象，只实现本模块用到的 matchMedia。 */
function fakeWindow(dark: boolean) {
  return {
    matchMedia: (q: string) => ({
      matches: dark && q.includes("dark"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  } as unknown as Window;
}

/** 造一个假的设置窗 document：prefs-navigation 下挂我们的侧栏行。 */
function fakePrefDoc(currentSrc: string | null) {
  const image = {
    attrs: { src: currentSrc } as Record<string, string | null>,
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    },
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
  };
  const item = {
    value: PREF_PANE_ID,
    querySelector: (sel: string) => (sel === "image" ? image : null),
  };
  const other = { value: "zotero-prefpane-general", querySelector: () => null };
  const nav = {
    children: [other, item],
  };
  return {
    doc: {
      getElementById: (id: string) => (id === "prefs-navigation" ? nav : null),
    } as unknown as Document,
    image,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefPaneIcon theme switching", () => {
  /** 桩掉 Zotero 内部「颜色方案」pref：browser.theme.toolbar-theme。 */
  function stubThemePref(value: number | "unset") {
    const prefs = {
      getIntPref:
        value === "unset"
          ? () => {
              throw new Error("NS_ERROR_UNEXPECTED");
            }
          : () => value,
      addObserver: () => {},
      removeObserver: () => {},
    };
    vi.stubGlobal("Services", { prefs });
  }

  it("reads Zotero's own color-scheme setting", () => {
    stubThemePref(0);
    expect(readThemePref()).to.equal("dark");
    stubThemePref(1);
    expect(readThemePref()).to.equal("light");
    stubThemePref(2);
    expect(readThemePref()).to.be.null; // 自动
    stubThemePref("unset");
    expect(readThemePref()).to.be.null;
  });

  it("Zotero's setting wins over the OS, in both directions", () => {
    // 用户在 Zotero 选暗色、系统是亮色 → 暗图
    stubThemePref(0);
    expect(isDarkScheme(fakeWindow(false))).to.be.true;
    expect(currentPrefPaneIconURI(fakeWindow(false))).to.equal(
      PREF_PANE_ICON_DARK,
    );
    // 用户在 Zotero 选亮色、系统是暗色 → 亮图（这正是最初的 bug）
    stubThemePref(1);
    expect(isDarkScheme(fakeWindow(true))).to.be.false;
    expect(currentPrefPaneIconURI(fakeWindow(true))).to.equal(
      PREF_PANE_ICON_LIGHT,
    );
  });

  it("only follows the OS when Zotero is set to auto", () => {
    stubThemePref(2);
    expect(isDarkScheme(fakeWindow(true))).to.be.true;
    expect(isDarkScheme(fakeWindow(false))).to.be.false;
  });

  it("reads dark mode from prefers-color-scheme", () => {
    expect(isDarkScheme(fakeWindow(true))).to.be.true;
    expect(isDarkScheme(fakeWindow(false))).to.be.false;
  });

  it("degrades to the light icon when matchMedia is unavailable or throws", () => {
    expect(isDarkScheme(null)).to.be.false;
    expect(isDarkScheme({} as Window)).to.be.false;
    const broken = {
      matchMedia: () => {
        throw new Error("no media queries in this host");
      },
    } as unknown as Window;
    expect(isDarkScheme(broken)).to.be.false;
    expect(currentPrefPaneIconURI(broken)).to.equal(PREF_PANE_ICON_LIGHT);
  });

  it("picks the matching asset per scheme", () => {
    expect(currentPrefPaneIconURI(fakeWindow(true))).to.equal(
      PREF_PANE_ICON_DARK,
    );
    expect(currentPrefPaneIconURI(fakeWindow(false))).to.equal(
      PREF_PANE_ICON_LIGHT,
    );
    // 两个资产都必须存在且不同名——同名等于没切。
    expect(PREF_PANE_ICON_DARK).to.not.equal(PREF_PANE_ICON_LIGHT);
    expect(PREF_PANE_ICON_DARK).to.match(
      /^chrome:\/\/zsearch\/content\/icons\//,
    );
  });

  it("rewrites only our own sidebar row's image", () => {
    const { doc, image } = fakePrefDoc(PREF_PANE_ICON_LIGHT);
    expect(applyIconToDoc(doc, PREF_PANE_ICON_DARK)).to.be.true;
    expect(image.getAttribute("src")).to.equal(PREF_PANE_ICON_DARK);
  });

  it("is a no-op when the src already matches", () => {
    const { doc, image } = fakePrefDoc(PREF_PANE_ICON_DARK);
    const setter = vi.spyOn(image, "setAttribute");
    applyIconToDoc(doc, PREF_PANE_ICON_DARK);
    expect(setter).not.toHaveBeenCalled();
  });

  it("returns false instead of throwing when the sidebar is absent", () => {
    const bare = {
      getElementById: () => null,
    } as unknown as Document;
    expect(applyIconToDoc(bare, PREF_PANE_ICON_DARK)).to.be.false;
    expect(applyIconToDoc(null, PREF_PANE_ICON_DARK)).to.be.false;
  });

  it("syncs the registered pane entry so later-opened windows get it too", () => {
    const panes = [{ id: "zotero-prefpane-general", image: "chrome://x" }];
    vi.stubGlobal("Zotero", { PreferencePanes: { pluginPanes: panes } });
    expect(syncRegisteredPaneImage(PREF_PANE_ICON_DARK)).to.be.false;

    panes.push({ id: PREF_PANE_ID, image: PREF_PANE_ICON_LIGHT });
    expect(syncRegisteredPaneImage(PREF_PANE_ICON_DARK)).to.be.true;
    expect(panes[1].image).to.equal(PREF_PANE_ICON_DARK);
  });

  it("does not throw when Zotero.PreferencePanes is missing", () => {
    vi.stubGlobal("Zotero", undefined);
    expect(syncRegisteredPaneImage(PREF_PANE_ICON_DARK)).to.be.false;
  });
});
