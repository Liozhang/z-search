/**
 * endpointSchema — 区域限定端点字段的校验/归一化单测。
 *
 * 这些字段会被原样拼进请求 URL，所以「形状不对就不落盘」是硬要求；
 * host 型的归一化必须与 resolveWikiHost 的校验同形（小写），否则 UI 收下
 * 的值会在运行时被静默判非法。
 *
 * @module tests/unit/utils/endpointSchema
 */

import { describe, it, expect } from "vitest";
import {
  ENDPOINT_FIELDS,
  normalizeEndpointValue,
  validateEndpointValue,
} from "../../../src/utils/endpointSchema";

const field = (fieldId: string) => {
  const f = ENDPOINT_FIELDS.find((x) => x.fieldId === fieldId);
  if (!f) throw new Error(`unknown field: ${fieldId}`);
  return f;
};

describe("ENDPOINT_FIELDS", () => {
  it("四个区域限定端点，pref 键与内置值齐备", () => {
    expect(ENDPOINT_FIELDS.map((f) => f.fieldId)).toEqual([
      "endpoint-easyscholar",
      "endpoint-mineru-cloud",
      "endpoint-jre-mirror",
      "endpoint-wikipedia-host",
    ]);
    expect(field("endpoint-easyscholar").builtin).toContain("easyscholar.cc");
    expect(field("endpoint-mineru-cloud").builtin).toBe(
      "https://mineru.net/api/v4",
    );
    expect(field("endpoint-jre-mirror").builtin).toBe(
      "https://api.adoptium.net/v3",
    );
  });

  it("维基域名型无内置值（默认跟随界面语言）", () => {
    expect(field("endpoint-wikipedia-host").builtin).toBe("");
    expect(field("endpoint-wikipedia-host").kind).toBe("host");
  });
});

describe("validateEndpointValue", () => {
  it("空串合法（= 用内置端点）", () => {
    for (const f of ENDPOINT_FIELDS) {
      expect(validateEndpointValue(f, "")).toBe("");
      expect(validateEndpointValue(f, "   ")).toBe("");
    }
  });

  it("url 型：完整 http(s) URL 放行（含路径与端口）", () => {
    const f = field("endpoint-mineru-cloud");
    expect(validateEndpointValue(f, "https://mineru.net/api/v4")).toBe("");
    expect(
      validateEndpointValue(f, "https://mirror.example.com:8443/api/v4"),
    ).toBe("");
    expect(validateEndpointValue(f, "http://127.0.0.1:8000/api/v4")).toBe("");
  });

  it("url 型：缺协议 / 空白 / 裸域名一律拒绝", () => {
    const f = field("endpoint-easyscholar");
    for (const bad of [
      "mineru.net/api/v4",
      "https://",
      "https://mirror",
      "https://mirror example.com",
      "ftp://mirror.example.com",
    ]) {
      expect(validateEndpointValue(f, bad)).toBe("pref-endpoint-invalid");
    }
  });

  it("host 型：裸主机名放行（大小写不敏感）", () => {
    const f = field("endpoint-wikipedia-host");
    expect(validateEndpointValue(f, "zh.wikipedia.org")).toBe("");
    expect(validateEndpointValue(f, "zh.m.wikipedia.org")).toBe("");
    expect(validateEndpointValue(f, "ZH.Wikipedia.ORG")).toBe("");
  });

  it("host 型：协议/路径/端口/单段主机名拒绝", () => {
    const f = field("endpoint-wikipedia-host");
    for (const bad of [
      "https://zh.wikipedia.org",
      "zh.wikipedia.org/w/api.php",
      "zh.wikipedia.org:8080",
      "localhost",
      "zh.wikipedia.org extra",
    ]) {
      expect(validateEndpointValue(f, bad)).toBe("pref-endpoint-invalid");
    }
  });
});

describe("normalizeEndpointValue", () => {
  it("host 型统一小写（与 resolveWikiHost 校验同形）", () => {
    const f = field("endpoint-wikipedia-host");
    expect(normalizeEndpointValue(f, "  ZH.Wikipedia.ORG ")).toBe(
      "zh.wikipedia.org",
    );
  });

  it("url 型只去空白（路径大小写敏感，不动）", () => {
    const f = field("endpoint-mineru-cloud");
    expect(
      normalizeEndpointValue(f, "  https://mirror.example.com/Api/V4 "),
    ).toBe("https://mirror.example.com/Api/V4");
  });
});
