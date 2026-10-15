/**
 * convert-journal-data — 期刊外部数据 CSV → addon/data JSON 转制脚本（dev-only）。
 *
 * 数据源：hitfyd/ShowJCR 仓库随源码分发的原始 CSV（JCR2025-UTF8.csv /
 * XR2026-UTF8.csv，行数与 Clarivate / 新锐学术官方口径一致，已核对）。
 * 用法：把 CSV 放到本脚本同目录（或改用下方路径），`node scripts/convert-journal-data.cjs`，
 * 产物手工拷入 addon/data/ 并跑 prettier。
 *
 * 口径要点（2026-10-15 转制 JCR 2025 + 新锐 2026 时确定）：
 *   - ISSN/EISSN 去连字符大写——库内列按 normalizeISSN 口径存裸值；
 *   - 刊名 trim + 空白折叠 + 大写——库内 journal_name 按 normalizeJournalName
 *     口径存大写值（lookupByName 直接等值比较）；
 *   - 新锐分区的「N 区」解析为整数；无大类分区的行保留（major_quartile=null）；
 *   - 小类折叠为 minor_categories JSON（{n,nc,q}），r/t 新锐数据不含，置 null。
 */
const fs = require("fs");

/** RFC 4180 CSV 解析（处理引号内逗号/转义引号/换行） */
function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ""));
}

// ShowJCR 的 CSV 用字面量 "N/A" 填缺失 ISSN（2025 数据 1,945 本）——表上
// UNIQUE(jcr_year, issn) 会把同字符串判成重复键，必须归一为 null。
const normISSN = (s) => {
  const v = (s || "").trim();
  if (!v || /^n\/a$/i.test(v)) return null;
  // ShowJCR 的 CSV 还用 "-" 占缺失 ISSN——剥掉连字符/空白后为空必须回落
  // null：部分唯一索引只排除 IS NOT NULL，空字符串会全体撞在同一个键上
  // （2026-10-15 实机探针抓到 1652 行被 INSERT OR IGNORE 吞掉）。
  const stripped = v.replace(/[-\s]/g, "").toUpperCase();
  return stripped || null;
};
const normName = (s) => (s || "").trim().replace(/\s+/g, " ").toUpperCase();
const numOrNull = (v) => {
  if (v == null || v === "" || v === "N/A" || v === "—") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------- JCR2025 → jcr-2025.json ----------
{
  const rows = parseCSV(fs.readFileSync("JCR2025-UTF8.csv", "utf8"));
  const hdr = rows[0];
  const ix = Object.fromEntries(hdr.map((h, i) => [h, i]));
  const data = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const rank = c[ix["IF Rank(2025)_1"]]; // "1/333" → 1
    const jifRank = rank ? numOrNull(String(rank).split("/")[0]) : null;
    const tuple = [
      2025, // jcr_year
      normName(c[ix["Journal"]]), // journal_name
      null, // abbreviated_name
      null, // publisher
      normISSN(c[ix["ISSN"]]), // issn
      normISSN(c[ix["EISSN"]]), // eissn
      null,
      null,
      null,
      null,
      null, // total_cites..citing_half_life
      numOrNull(c[ix["IF(2025)"]]), // jif
      null,
      null,
      null, // five_year_jif / jif_without_self / jci
      c[ix["IF Quartile(2025)_1"]] || null, // jif_quartile
      jifRank, // jif_rank
    ];
    data.push(tuple);
  }
  fs.writeFileSync(
    "jcr-2025.json",
    JSON.stringify({ year: 2025, data }, null, 2),
  );
  console.log("jcr-2025.json:", data.length, "条");
}

// ---------- XR2026 → xr-2026.json ----------
{
  const rows = parseCSV(fs.readFileSync("XR2026-UTF8.csv", "utf8"));
  const hdr = rows[0];
  const ix = Object.fromEntries(hdr.map((h, i) => [h.trim(), i]));
  const parseQ = (v) => {
    const m = /(\d)\s*区/.exec(v || "");
    return m ? Number(m[1]) : null;
  };
  const minorCats = [];
  for (let k = 1; k <= 6; k++) {
    const n = (c) => (c[ix[`小类${k}英文名`]] || "").trim();
    if (n) minorCats.push(k);
  }
  const data = [];
  let nameDiff = 0,
    skippedNoQuartile = 0;
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const col = (k) => (c[ix[k]] || "").trim();
    const journalName = normName(col("刊名") || col("Journal"));
    if (!journalName) continue;
    if (normName(col("Journal")) !== journalName) nameDiff++;
    const minors = [];
    for (let k = 1; k <= 6; k++) {
      const n = col(`小类${k}英文名`),
        nc = col(`小类${k}中文名`);
      const q = parseQ(col(`小类${k}新锐分区`));
      if (n || nc)
        minors.push({ n: n || nc, nc: nc || n, q: q ?? 0, r: null, t: null });
    }
    const majorQ = parseQ(col("大类新锐分区"));
    if (majorQ == null) skippedNoQuartile++;
    const tuple = [
      2026, // xr_year
      journalName, // journal_name
      col("中文刊名") || null, // chinese_name
      normISSN(col("ISSN")), // issn
      normISSN(col("EISSN")), // eissn
      col("CN") || null, // cn
      col("数据库") || null, // wos_database
      col("预警标记") ? 1 : 0, // is_under_review
      col("大类中文名") || col("大类英文名") || "", // major_category
      col("大类英文名") || null, // major_category_en
      majorQ, // major_quartile
      col("Top") === "Top" ? 1 : 0, // is_top
      col("大类2中文名") || null, // major2_category
      col("大类2英文名") || null, // major2_category_en
      parseQ(col("大类2新锐分区")), // major2_quartile
      JSON.stringify(minors), // minor_categories
    ];
    data.push(tuple);
  }
  fs.writeFileSync(
    "xr-2026.json",
    JSON.stringify({ year: 2026, data }, null, 2),
  );
  console.log(
    "xr-2026.json:",
    data.length,
    "条, Journal≠刊名:",
    nameDiff,
    ", 无大类分区:",
    skippedNoQuartile,
  );
}
