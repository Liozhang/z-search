# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
Release notes published with a version are taken verbatim from that version's
section in this file (see `release.changelog` in `zotero-plugin.config.ts`).

## [2.2.0] - 2026-10-26

### Fixed

- **Text inputs in the settings pane accept typing again.** Zotero 10's engine
  no longer ships the XUL `textbox` element (the toolkit custom-element registry
  only keeps `search-textbox`), so every `<textbox>` in the pane — the
  web-search and academic API key rows, the region-locked endpoint rows, and
  the two translation cache/limit fields — rendered as an inert element you
  could see but not type into. All of them are now `html:input` fields (the
  same idiom Zotero's own preference panes use), which also means placeholders
  render natively instead of hiding in a tooltip. The Azure Translator region
  field was an editable `menulist`, a form Zotero 10 equally no longer
  supports; it is a plain text input whose tooltip lists the common region
  codes. Field hints and saved values are unchanged.
- The CAS-partition visibility picker no longer throws when changed: its
  change handler referenced an undefined `doc` variable (a `ReferenceError`
  on every pick).
- Two stale integration-test assertions: the dataset-domain smoke expected the
  source registry of an earlier release (19, now 23), and the CSV-export test
  demanded a quoted title cell although RFC 4180 escaping only quotes cells
  that contain a comma, quote, or newline — the live first result has neither.
  Three timing-sensitive probes (source-chip gray-out, Extra-field merge,
  import-target popup) gained bounded retries; under load their fixed windows
  intermittently missed a UI that settles late, with failures rotating across
  runs of identical code.

### Changed

- **The add-on name renders verbatim as "z-search".** The display name used
  by the plugin manager and the settings sidebar/heading is no longer re-cased
  to "Z-Search"; the lowercase brand is displayed as-is in every locale.

### Added

- **A switch to hide China-mainland-related settings and features.** The
  Network Region group gains "Hide China-mainland-related settings and
  features" (`region.hideChinaContent`, default off). When enabled, the pane
  drops the Mainland-China region choice, the CAS partition row, the
  easyScholar and MinerU cloud endpoint rows and the easyScholar API key row,
  and swaps the region description for one that does not discuss
  mainland-only services. Feature-side, China-region data (CAS and
  rising-journal rankings via every existing consumer, and the easyScholar
  Chinese-core lists) is disabled regardless of region or per-item overrides.
  Saved values are kept and everything returns when the switch is turned back
  off; if the region was set to Mainland China it self-heals to International
  so the picker never holds a value that is no longer selectable.
- **External links now open in the system browser.** Result-card links live in
  a chrome:// iframe inside Zotero's privileged window, where
  `<a target="_blank">` is a dead click — the privileged context has no
  default external-URL handling. A shared `openExternal` helper routes
  http(s) URLs over the bridge (`hub.openExternal`) for the host to pass to
  `Zotero.launchURL` (with a direct-launch fallback outside iframes), and
  every exit point is wired to it: literature result titles (when there is no
  abstract to expand) and DOI links, domain result titles (falling back to a
  non-clickable title when a source gives no URL), the journal homepage link,
  and the citation-explorer DOI links. Non-http(s) schemes are rejected on
  both sides.

## [2.1.0] - 2026-10-23

### Added

- **Dataset advanced filters now work: license, OA type, task tags, and
  country.** The 2.0.0 discipline selector rendered its advanced query
  fields as empty dropdowns — no option vocabularies existed and no adapter
  implemented the filters. They are now real:
  - _License_ (General Repositories + ML/AI) — options CC BY / CC BY-SA /
    CC BY-NC / CC BY-NC-SA / CC0 / Other; the bus normalizes each source's
    raw license string ("cc-by-4.0", "CC BY", "UCI ML Repository", …) onto
    the same vocabulary before exact matching.
  - _OA type_ (General Repositories) — open / restricted / closed. Zenodo
    populates it from `access_right`, OSF from its public flag; Figshare and
    Dryad are open repositories by nature. Harvard Dataverse's search
    response carries no access flag, so it does not claim the capability.
  - _Task tags_ (ML/AI) — ten-task chip multi-select (union semantics,
    matching the literature page's source filter); substring matching
    bridges the vocabularies of HuggingFace pipeline tags and UCI tasks.
  - _Country_ (Social Sciences only) — twelve-country list matched by
    substring against ICPSR's geographic coverage.
    Filtering is capability-gated: each adapter declares which advanced
    filters it can honor (`supportedFilters`), and when a filter is active
    the bus skips sources that cannot honor it instead of letting unfiltered
    results into the list — the skips surface in the status strip via a new
    `domain-sources-nofilter` message (`skippedNoFilter` metadata), keeping
    the "failures are never faked" contract. The country filter was removed
    from the Economics and Health disciplines outright: World Bank / OECD /
    IMF / Eurostat / WHO results carry no country dimension, so the option
    could never be honored there. Task tags render as filter chips (the
    multi-select control type was previously unimplemented in the UI).

### Changed

- **The domain search pages now speak the same design language as the
  literature and journal pages.** The 2.0.0 domain tabs (Patents / Datasets /
  Researchers / Grants) were the only search views still on their own recipe:
  page-level `px-4` padding (the other two views removed theirs under the
  R11-D5 single-track rule), raw HTML controls, a hardcoded
  `bg-blue-100`/`bg-green-100` chip palette, and a default-size search input.
  They now use the hub-redesign token system end to end: vertical rhythm
  `space-2`/`space-3`/`space-6` matching the literature page's 2026-10-12
  compression, `SearchInput` lg primary input, `ToggleGroup` filter chips for
  the dataset discipline selector (previously the default seg variant with
  hand-written `text-xs` overrides), the shared `Input`/`Select` for the
  advanced query fields, the literature card recipe for result rows
  (divider rows, `--hub-bg-hover` hover, selection indicator, `Checkbox`,
  `Badge` with tones instead of raw colors, query-hit highlighting in
  titles), the shared `LoadingState`/`EmptyState` placeholders, and the
  journal page's persistent slim error row with retry (the previous
  `ErrorState` was also missing its `retryLabel`, so the retry button never
  rendered). The journal page in turn adopts the literature page's newer
  vertical rhythm and lg input, so the two long-standing pages are identical
  too. Unused utilities (`bg-blue-100`, `ml-2`, …) dropped out of the
  generated `tw.css` with their last consumers.

### Fixed

- **The domain tabs' search button said "Import".** All four domain pages
  rendered the primary action with the `domain-import-btn` message
  ("Import"/"导入") and the `domain-importing` loading text — a copy-paste
  from the per-card import button. The button now uses `common-search` /
  `common-searching`, and `domain-importing` is back to being the per-card
  importing state.
- **The domain pages ignored IME composition on Enter.** Pressing Enter to
  confirm a candidate word in a Chinese/Japanese IME fired the search with
  the half-composed string; the pages now guard with `isIMEComposing`, the
  same guard the literature and journal pages have had since 2026-09-09.
- **The domain pages hid skipped sources.** `skippedNoKey` arrived with
  every `domain.search` response but was never rendered, so a source
  skipped for a missing API key was indistinguishable from "not searched".
  A new `domain-sources-nokey` message reports it in the engine status
  strip next to failed sources (the literature page's `hub-search-sources-nokey`
  was not reused: it points at the literature settings section, which is
  the wrong place for EPO / NASA ADS keys).

- **Dataset tab discipline selection now actually narrows the search, and the
  four discipline-specific sources are reachable.** The 2.0.0 dataset
  disciplines sent their source list (`filters.sources`) with every
  `domain.search` call, but `DomainSearchEngine` fanned out to the whole
  domain regardless — and GEO, PubChem, PANGAEA, and ICPSR were never in the
  dataset domain at all: their adapters are registered under the bio /
  chemistry / geoscience / social-science domains, so selecting "Life
  Sciences" in the Datasets tab still queried all 19 dataset sources and
  could never return a GEO hit. The bus now honors `filters.sources`
  (unlisted sources are not requested), resolves a domain's source list
  through a cross-domain source-id index, and the dataset domain lists all
  23 sources the discipline selector advertises. Adapters keep their home
  domain, so `domain.import` maps each result's itemType and Extra fields
  through its owner domain — GEO hits now import as `dataset` items with
  Accession / Platform / Organism / Data Type / Samples instead of the
  generic dataset fields, same as the 2.0.0 card rendering already
  promised.
- **Dataset year filter works for every source.** The year range declared by
  nine of the ten dataset disciplines was implemented by only five adapters
  (Zenodo / Figshare / Dataverse / Dryad / DataCite); GEO ignored it
  entirely. GEO now passes the range to Entrez as
  `mindate`/`maxdate` with `datetype=pdat`, and the bus applies a generic
  post-filter on result year after dedup, so the filter holds for sources
  whose upstream API has no date parameter (the post-filter is a no-op for
  sources that already filter server-side).

### Added

- Unit coverage for the four cross-domain dataset sources (GEO two-step
  esearch/esummary parsing, Entrez date parameters, PubChem property
  parsing, PANGAEA and ICPSR response parsing) and for the bus's new
  discipline narrowing, cross-domain resolution, and year post-filter
  behavior.

## [2.0.1] - 2026-10-23

### Fixed

- **Real-device integration tests now receive an OpenAlex API key.** The test
  runner empties its profile directory on every run, so a key written into
  `prefs.js` by hand never survived a single round and the suite fell back to
  OpenAlex's shared anonymous quota. Once that quota ran out, the journal
  discover lists (en-US and zh-CN), the journal service probe, the XR data
  probe, the per-source latency probe, and citation merging on re-import all
  failed. The key is now injected through the scaffold's `test.prefs` from the
  `ZSEARCH_OPENALEX_API_KEY` environment variable (`.env`, not committed);
  without it the suite still runs against the anonymous quota.
- **CSV export assertion matches RFC 4180 escaping.** `csvEscape` doubles
  embedded double quotes and wraps the field, which is correct; the test was
  looking for the unescaped substring and could never match once a title
  contained a quote, so the "copy list + export CSV" case stayed permanently
  red. It now asserts the escaped field form.

## [2.0.0] - 2026-10-22

### Added

- **Academic subdomain search framework: 16 new domains and 38 open data
  sources.** A new `DomainSearchEngine` bus plus a declarative
  `DomainRegistry` extend the Hub search window from three tabs to seven —
  Academic / Local / Journal / Patents / Datasets / Researchers / Grants —
  with each domain registering its own sources, dedup keys, enrichers, and
  Zotero itemType mapping, so adding a domain needs no bus changes.
  New domains and their sources:

  - **Patents** (4): EPO Open Patent Services, Google Patents, USPTO
    PatentsView, WIPO PATENTSCOPE. Imports as Zotero `patent` items with
    patent number, inventors, assignees, IPC/CPC, legal status, and
    application date written to structured fields.
  - **Datasets** (19): HuggingFace, Kaggle, UCI, OpenML, Zenodo, Figshare,
    Harvard Dataverse, OSF, Dryad, DataCite Search, re3data, World Bank
    Indicators, GBIF, WHO Global Health Observatory, OECD, NASA Open Data,
    Eurostat, IMF, UK Data Service. Imports as `dataset` items with
    creators, license, publisher, and source-specific metrics in Extra.
  - **Researchers** (4): OpenAlex Authors, OpenAlex Institutions, ORCID,
    Semantic Scholar Authors. Imports as `person` items with ORCID,
    h-index, i10-index, citation count, institutions, and research areas.
  - **Grants** (3): NSF Award Search, EU CORDIS, NIH RePORTER. Imports as
    notes with grant ID, PI, institution, agency, amount, period, and
    status.
  - **Clinical trials** (1): ClinicalTrials.gov API v2.
  - **Theses** (1): OATD (Open Access Theses and Dissertations).
  - **CS bibliography** (1): DBLP.
  - **Open-access full text** (1): Unpaywall (DOI → OA status + best PDF).
  - **Preprints** (2): ChemRxiv, SocArXiv.
  - **Life sciences** (1): GEO (Gene Expression Omnibus).
  - **Chemistry** (1): PubChem.
  - **Geosciences** (1): PANGAEA.
  - **Social sciences** (1): ICPSR.
  - **Physics** (2): INSPIRE-HEP, NASA ADS.
  - **Mathematics** (1): zbMATH Open.
  - **Economics** (1): RePEc/IDEAS.

  Shared infrastructure: per-domain dedup keys (patent number / DOI /
  ORCID / grant ID) with in-library idempotency checks, domain enrichers
  (patent family & legal status, DataCite metadata completion, researcher
  activity tiers, grant status normalization), and honest failure reporting
  (`failedSources` + `failedReasons`, never faking empty results).

- **Dataset domain: discipline selector with advanced query filters.** The
  dataset tab opens with a discipline segmented control — General
  Repositories, ML/AI, Life Sciences, Chemistry, Geosciences, Social
  Sciences, Economics, Health, Registries, or All — and each discipline
  renders the advanced query fields its sources actually support (year
  range, license, OA type, task tags, country). Selecting a discipline
  narrows the fan-out to that discipline's sources only.

- **Dataset result cards: source-specific metadata fields.** Each of the
  19 dataset sources (plus GEO, PubChem, PANGAEA, ICPSR, GBIF) now renders
  its two-to-four most informative fields on the result card — for example
  HuggingFace shows downloads/likes/task tags/license, GBIF shows the
  taxonomy path (kingdom › phylum › order › family › genus), GEO shows
  organism/sample count/platform, PubChem shows molecular formula and
  weight, and Eurostat shows data source and last update. Large counts are
  abbreviated (1.5M / 25.0k) and file sizes formatted (1.2 GB / 500 MB).

### Changed

- **Literature result cards: year, impact factor, citation count, and
  GitHub stars are now badges** in the same syntax as the JCR/CASS/XR
  quartile badges, replacing the plain-text meta row (only the journal
  name remains there). The badge row is ordered risk-first — warning,
  predatory, and Under Review (all red) — then metadata (year), the two
  headline impact numbers (IF in yellow, citation count in neutral gray),
  the journal-quality classification cluster (JCR/CASS/XR quartiles, top
  journal, Chinese core lists), and repository stars last. IF keeps its
  yellow emphasis from the 2026-08-26 decision; year, citation count, and
  stars use a neutral gray so yellow, blue, and red each carry a single
  meaning. The citation badge remains clickable when a DOI is present.

- **Literature result cards: every badge now carries a hover tooltip**
  explaining what it means. The journal-metric badges (impact factor, JCR /
  CASS / XR quartiles, top journal) reuse the item-tree column's existing
  wording so one concept has one explanation; warning, search source,
  GitHub stars, and the OA / PDF / PMC tags get purpose-written tooltips.
  The source tooltip shows the localized source name. Badges that already
  had explanations (predatory, Under Review, citation count, Chinese core,
  in-library) keep theirs.

## [1.11.0] - 2026-10-15

### Added

- **XinRui partition table 2026 (新锐分区) as a new bundled journal-quality
  dataset.** The CAS (Chinese Academy of Sciences) partition table stopped
  publication after its 2025 edition; the original team continues the system
  as the XinRui Ranking (released 2026-03-24, 22,299 journals, retroactive to
  2020, with an "Under Review" flag replacing the standalone warning list).
  The table ships as `xr-2026.json`, imports into a new
  `zsearch_xr_quartiles` table, and surfaces as a separate badge in the
  item-tree metrics column, the journal metrics card (quartile, major
  category, top-journal star, Under Review flag, minor categories), the
  journal discover rows, and the literature result cards & citation explorer
  (quartile + Under Review badges) — always as a system distinct from CASS,
  since the two coexist with different definitions. Region-gated together
  with CASS.
  Data source: the publicly mirrored ShowJCR dataset, cross-checked against
  the official release coverage (22,299 journals).

- Added `zzx-xr-data-probe`, a real-Zotero probe that hard-asserts the
  imported row counts of both new datasets (JCR 2025 = 22,643; XinRui 2026 =
  22,299 with 37 Under Review) and the XR field flow through the journal
  service and literature enrichment layers. It wipes and re-imports the two
  new datasets first, so it also validates the re-import path and catches any
  silent row loss from unique-index collisions.

### Changed

- **Impact factors updated to JCR 2025** (the JCR 2026 release, published
  2026-06-17; 22,643 journals). Both the 2024 and 2025 snapshots now ship
  side by side (`jcr-2024.json` + `jcr-2025.json`) and import per-year on
  startup; all lookups read the latest year, so existing installs pick up
  2025 impact factors on upgrade without a full re-import.

## [1.10.0] - 2026-10-14

### Changed

- **The Hub window now opens at a fixed 1280×860 content size.** The
  previous first-open logic scaled the window to 85% of the screen —
  on a 2560×1440 display that produced a ~2176×1224 window where light
  pages like the journal metrics card floated in a large blank area.
  The new default matches the README screenshot size. A manual resize
  is still remembered for future opens, so the default only affects the
  first launch. (The openDialog width/height is the outer frame — the
  parameters are 1296×938 so the content area lands at exactly
  1280×860 on default Windows theming.)

## [1.9.1] - 2026-10-13

### Fixed

- **Corrected the build fallback for the addon homepage URL** from a
  non-existent organization repository (`z-search/z-search`) to
  `Liozhang/z-search`. The packaged artifact is unchanged —
  `package.json` always provides a homepage, so the fallback never
  fired; this only guards against future drift.
- Added `zzk-journal-service-probe`, a dev-only probe that calls the
  journal search service directly (metric/discover) and records
  timing, result shape, and errors — tooling for chasing the stable
  journal-domain test failures first seen on 2026-10-13. Not part of
  the plugin bundle.

## [1.9.0] - 2026-10-13

### Changed

- **Literature search now sorts by relevance by default instead of
  citation count.** Crossref's is-referenced-by-count ordering
  overwhelms the query's relevance contribution entirely: adjacent
  queries in the same field (deep learning vs machine learning)
  returned 12 of the same top 20 hits, so every search looked
  identical. Relevance ordering puts the query back in charge;
  citation-first remains one click away in the filter dialog. The
  default is kept in sync between the search hook's initial/reset
  value and the filter dialog's defaults table — the dialog drives
  both "reset" and the active-filter badge, so a drift would leave the
  badge stuck on.

## [1.8.1] - 2026-10-13

### Fixed

- **Built-in journal datasets now load from packaged XPI installs.** In
  a packaged install the addon root is a `jar:` archive URI, and the
  host's `Zotero.File.getContentsAsync` only accepts `file:`-prefixed
  strings — anything else (including `jar:` and `resource:` roots) is
  routed to the HTTP stack, which fails instantly on archive URIs
  (confirmed against the Zotero 10 host source). Every import therefore
  died at the first data-file read: all four stages — JCR / CAS /
  warning / Beall's — failed instantly, both at startup and via the
  banner's "Import now" button, while dev builds (a `file:` directory
  root) were unaffected, so probes and CI never surfaced it. The
  dataset loader now resolves the install root by form: `file:` roots
  are read directly from disk, `resource:` roots are resolved through
  the resource protocol handler, `jar:` roots are read in place with
  nsIZipReader, and XHR remains only as a last-resort fallback.
  Read failures now carry the root form in their message. Verified on
  a real Zotero 10 with new probes that read `warning.json` and the
  5.3 MB `jcr-2024.json` out of a packaged XPI via the same code path.
- **Table creation now shares the widened transaction wait.** The
  previous release raised the data-import transaction's wait ceiling to
  120 seconds but left schema creation at Zotero's 30-second default,
  and schema failures were swallowed silently — a lost race during the
  startup write window left all four tables missing with no visible
  cause (the "schema failure logging" added in 1.8.0 was dead code
  since the errors never propagated). Schema creation now waits up to
  120 seconds, logs failures as structured warnings, and rethrows, so
  a failed table maps directly onto its import stage instead of
  surfacing later as an obscure "no such table" error.
- **The dataset failure banner shows per-stage error details.** A
  failed "Import now" now lists each failed stage with its underlying
  message (truncated to 500 characters overall), not just the stage
  names, so failures are diagnosable without enabling debug output.

## [1.8.0] - 2026-10-13

### Added

- **Manual re-import from the failure banner.** The journal page's
  "dataset failed to load" banner now has an "Import now" button
  (localized in en-US/zh-CN/zh-TW) backed by a new `journal.reimportData`
  RPC: it runs the same gated import as startup (per-year presence,
  per-table repair for Beall's) and reports per-stage results — success
  clears the banner without a restart; failure lists the failed stage
  names in place. The import logic itself moved to a shared module
  (`journalDataImport`) used by both startup and the button, with an
  in-flight lock so concurrent triggers share one run, and schema-setup
  failures are now logged explicitly instead of surfacing later as
  obscure "no such table" errors.

### Fixed

- **Journal datasets no longer fail to load during startup write
  contention.** The startup import runs right when Zotero itself writes
  most heavily (sync, indexing tasks); while a host transaction holds the
  database write lock, dataset imports hit Zotero's default 30-second
  transaction-wait ceiling and failed with TimeoutError — the root cause
  of the "built-in journal dataset failed to load" banner (confirmed by
  an on-device probe: TimeoutError at exactly ~30s under a held lock,
  the same failure class as a 2026-10-11 real-machine incident). Import
  transactions now wait up to 120 seconds, riding out startup contention:
  a real-Zotero verification shows a 40-second lock hold now completes
  (~40s) instead of failing, while a 130-second hold still fails honestly
  at ~120s and recovers on retry.

## [1.7.0] - 2026-10-13

### Added

- **Zotero's built-in full-text index joins hybrid search as a third
  recall leg.** On Zotero 10, library full-text (hybrid) search now also
  queries the host's FTS5 content index via
  `Zotero.Fulltext.findItemsWithContent`, maps attachment hits to their
  parent items, and fuses them with the existing vector + BM25 ranking
  in an item-level weighted RRF pass (default weight 0.5, applied after
  the optional rerank). The host leg covers gaps the plugin's own index
  cannot: items whose text Zotero has already extracted but that are not
  chunk-indexed yet, and queries where both plugin legs come up empty —
  these no longer short-circuit to an empty result. Hits contributed by
  the host leg alone carry no chunk snippet and are badged "Full-text
  index match" (localized in en-US/zh-CN/zh-TW). The leg is skipped when
  a section filter is active, degrades honestly when the host API is
  missing or the term is not indexable, and is a no-op passthrough when
  the host returns nothing, so behavior on other hosts is unchanged.
  Index lifecycle stays entirely with the host: extraction, background
  queueing, corruption recovery, and space reclamation cost the plugin
  nothing.

## [1.6.0] - 2026-10-12

### Added

- **Advanced literature search.** Title and abstract terms are compiled
  per source into its native field syntax (Crossref `query.title`,
  OpenAlex `title.search`, arXiv `ti:`/`abs:`, Europe PMC `TITLE:`,
  PubMed `[Title]`/`[tiab]`, GitHub `in:title`), so a title search no
  longer degrades into a everywhere-full-text query. The year filter now
  reaches every source, review-only and has-abstract switches narrow
  biomedical sources, and a results-header keyword filter (multi-word
  AND, purely client-side) narrows the merged list instantly.

- **Fixed circular source logos.** All 13 sources now show as constant
  circular badges in the results header: brand-colored with a dark ring
  and a live count when the source returned hits, grayed out otherwise,
  with hover text explaining why (no results / no API key / query
  failed). Clicking a badge filters the list to that source, and every
  result card's source tag carries a matching mini badge.

- **Aggregated metadata is written into imported items.** Importing a
  merged result records the aggregate facts in the Zotero item's Extra
  field: citation count (highest across sources), which sources hit it,
  impact factor, JCR/CAS quartiles, warning level and GitHub stars.
  Re-importing the same DOI replaces same-key lines instead of
  duplicating them and leaves user-written lines untouched; items that
  were already in the library get the same facts via the idempotent-hit
  path.

### Changed

- **Search-result identity is now DOI-only.** Two results are merged
  into one card only when they share a DOI; entries without one are no
  longer merged by title similarity, which previously could fuse
  distinct papers that happened to share a title.

- **Search results use the whole window.** The hub window's hidden
  1920×1080 size cap is removed and the first open adapts to 85% of the
  screen. The search pane drops the centered 1120px reading track for a
  full-width layout (abstracts keep their 68-character line cap), the
  status details collapse into one line, and the action rows above the
  results are tightened — the results list grows from roughly half the
  window to about 70% of it.

### Fixed

- **arXiv failed every search with a bogus network error.** The Atom
  parser looked up `opensearch:totalResults` with a colon-bearing CSS
  selector, which is invalid and threw on every document, taking the
  whole arXiv source down each search.

- **"In library" marks and import idempotence never worked.** Both
  queried with `addCondition("doi", …)`, but the valid search condition
  in Zotero is the field alias `DOI`; the lowercase form throws and the
  errors were swallowed. In-library badges light up again, and importing
  a DOI that is already in the library updates the existing item instead
  of creating a duplicate.

- **Source filter chips lost their hover tooltips.** The toggle-group
  item overwrote any explicitly passed `title` with its auto-title
  fallback, so tooltip text never reached the DOM — for every caller,
  not just the new chips.

## [1.5.3] - 2026-10-12

### Added

- **ModelScope joins the built-in download mirrors for local embedding
  models.** Downloads probe HuggingFace, the CN mirror and ModelScope and
  fall back automatically; every downloaded file is content-validated (an
  HTML error page served with status 200 no longer lands in the model
  directory), and each model's true vector dimension is recorded from its
  `config.json` instead of assuming 384 — custom 768/1024-dimension models
  no longer break the vector index with a dimension mismatch. A model
  directory poisoned by the old download path is detected (its
  `config.json` no longer parses) and re-downloaded automatically.

### Fixed

- **Concurrent imports no longer land in the wrong library.** The save
  target (library/collection) was held in shared singleton state, so two
  imports started in quick succession could overwrite each other's target
  and file items under the wrong library. The target now travels with each
  import call. The main-window fallback also validates that the selected
  object is a collection and resolves its owning library, so a
  group-library collection no longer pairs with a default save into
  My Library.
- **Duplicate items from DOI case variants.** DOIs are case-insensitive,
  but the in-library pre-check, the "already in library" marking and the
  search-result dedup compared them case-sensitively, and a batch holding
  the same DOI twice created two items. All comparison keys are lowercased
  now and a batch deduplicates itself before importing.
- **Import failures report the real reason.** Item creation swallowed
  every exception into a generic "Failed to create item"; the underlying
  message now reaches the result card. An item the translator already
  created but failed to add to a collection is reported as the existing
  item instead of a failure, so retrying no longer creates a duplicate.
  A failed metadata extraction is no longer cached for five minutes, so
  retrying after a transient network error actually retries. The ISBN
  fallback previously routed to a URL parser that only understands
  DOI/arXiv links and could never succeed; it now queries translators with
  the ISBN directly.
- **Deleting an item now cleans up its search index.** The plugin never
  registered Zotero's item-delete notifier, so full-text chunks, their
  full-text-index rows and embedding vectors stayed behind forever and
  deleted papers kept returning in semantic search as ghost results with
  missing titles. A delete observer now cleans chunks and vectors, startup
  runs an orphan sweep (covering sync restores and cascaded attachment
  deletions), and search results skip items that no longer exist or sit in
  the trash.
- **Rebuilding after switching embedding models no longer stalls.** The
  full-text build skipped itself whenever Zotero's full-text version was
  unchanged, and switching models (which deletes the old model's chunks)
  did not reopen that gate — the new model's index could never be built
  and vector search kept reporting "not indexed". Deleting a model's
  chunks now resets the guard, and a build that finished with errors no
  longer writes it either, so temporarily failed PDFs are retried on the
  next build instead of being skipped forever.
- **Edited items are re-embedded.** The metadata-vector build skipped
  anything already embedded, so title/abstract edits never reached the
  index and edited notes kept matching by their old text. The build now
  compares stored search texts and re-embeds what changed.
- **Switching models at runtime no longer breaks vector search until
  restart.** The in-memory vector index was loaded once at startup and
  never re-checked against the configured model; after a switch it served
  the previous model's vectors, failing with dimension mismatches or
  partial recall. Search now detects the mismatch and reloads the index.
- **Trash is excluded from counts and note similarity.** The "unembedded
  N items" counter never reached zero while trashed items lacked vectors,
  and similar-note search matched notes sitting in the trash.
- **Pre-aborted cancel signals are respected.** The timeout/cancel signal
  bridge only listened for the abort transition, so a signal already
  aborted on entry silently lost its cancel and the request ran to the
  full timeout.
- **Storage and startup robustness.** The one-time external-database
  migration ran before the target tables existed and silently did nothing
  on the first upgrade launch; core-store initialization failures were
  swallowed entirely (first symptom: a cryptic "no such table" at search
  time) and now log a warning; the AI cache is flushed on quit (previously
  up to five minutes of entries were lost on every exit) and written
  atomically, so a crash no longer discards the whole cache; the JCR/CASS
  import gate compared "latest year equals expected" and would re-import
  whole datasets on every start once any newer year existed.
- **The Bealls list imports completely after a partial failure.** The
  "import only when all three tables are empty" gate let one partial
  import (a transaction timeout that only landed the smallest table) block
  re-imports forever. Segments are now re-imported per table, the
  clear-and-refill runs in a single transaction, and journal abbreviations
  (previously dropped at import) are persisted so abbreviation matching
  works.
- **Journal dataset import failures surface a banner.** When a bundled
  dataset failed to import at startup, the journal page silently showed
  "no data"; a dismissible banner now explains the failure.
- **MinerU parsing and translation engines use the sandbox-safe timeout
  shim** throughout — Zotero 10's sandbox does not expose
  `AbortSignal.timeout`, and bare calls failed instantly.

## [1.5.2] - 2026-10-10

### Fixed

- **Fuzzy journal search no longer returns an empty list for incomplete
  words** (e.g. "nature bio"). Two compounding causes: OpenAlex
  `/sources?search=` matches whole tokens only, so any query containing a
  word fragment returns zero remote hits; and the local JCR-table layer
  required the entire query to appear as one contiguous substring, so
  fragments only matched when every preceding word was complete. Local
  matching now splits the query on whitespace and requires every token as
  a substring (AND), making word order irrelevant and allowing each word
  to be a prefix ("nat bio" finds _Nature Biotechnology_).
- **An OpenAlex failure no longer discards already-fetched local hits.**
  When the remote request failed (network error, HTTP 429 quota
  exhaustion), `discover` returned a hard failure and dropped the local
  results fetched in the same round trip — the mode went completely empty
  even though the local table had dozens of matches. The service now
  degrades to a local-only list (top 10, same quota as the merged path)
  and surfaces the remote error as a flag; the UI renders the partial
  results with a warning banner and retry instead of a failure state.
  The same discard affected `metric` mode, where a locally-composed card
  was thrown away when the OpenAlex enrichment failed — the card now
  renders and the banner notes the missing remote fields.

## [1.5.1] - 2026-10-09

### Changed

- **The supported Zotero range is now Zotero 10 only**: `strict_min_version`
  moves from 9.0 to 10.0 and the README badges drop the "9 ~" range. Zotero
  7/8 were already excluded by the previous floor, and 9 never had a
  real-machine test environment — every local end-to-end run exercises
  Zotero 10 only — so declaring 9 as installable promised more than the
  plugin had verified. `strict_max_version` stays at `10.*` until a future
  Zotero release is actually validated.

## [1.5.0] - 2026-10-09

### Changed

- **Journal search modes renamed by matching strategy: fuzzy / exact**:
  the two modes were previously framed as "by field" vs. "by journal name",
  while both really took the same kind of input. They are now "Fuzzy
  Search" (candidate list, service-side mode `discover`) and "Exact
  Search" (single quality card, service-side mode `metric`). Fuzzy search
  now also merges local JCR-table substring hits (top 25 by JIF) with
  OpenAlex keyword hits, deduplicated by ISSN or normalized name, so the
  candidate list covers journals OpenAlex ranks low or does not list.
- **Crossref searches now fetch a field whitelist**, cutting the response
  payload from 1.7–2.7 MB to ~120 KB at 100 rows (a ~14× reduction). Full
  metadata responses were the main reason the Crossref leg timed out on
  constrained international links; the 14 fields the article mapper consumes
  (DOI / title / authors / abstract / journal / citation count / dates / URL)
  are unchanged. Timeout and connection-reset failures now also surface their
  real error text instead of a bare `error: 0`.
- **Failed literature-search sources now state why they failed**: the Hub
  search status line appends a localized reason to each failed source name
  (response timeout / network connection failed / rate limited / API error),
  classified host-side from the adapter error, instead of listing bare names.

### Fixed

- **Journal "h5-index" sort no longer fails with OpenAlex 400**: OpenAlex
  retired `summary_stats.h5_index` — it is gone from `/sources` responses
  and rejected as a sort key (`summary_stats.h5_index is not a valid
field`). The sort now uses `summary_stats.h_index` (h-index), list rows
  and the metric card display h-index instead of the dead h5 field, and the
  unused `openalexH5Index` plumbing was removed.
- **Hub crash on opening the import-target dropdown** ("too much recursion"):
  the select popup's collision detection walked overflow ancestors across the
  iframe boundary into the XUL host window, whose document has no `body` —
  @floating-ui/utils then cycled between the host document and the frame
  element until SpiderMonkey's stack was exhausted, taking down the whole Hub
  tree. A build patch (`patches/@floating-ui+utils+0.2.12.patch`, applied via
  patch-package) stops frame traversal at host documents without a `<body>`,
  fixing every floating popup (select / menu / popover) inside the Hub.

## [1.4.1] - 2026-10-09

### Fixed

- **Journal row quartile badges now distinguish the two ranking systems**:
  JCR and CAS quartiles both rendered as bare "Q1"–"Q4", so two identical
  chips sat side by side with no way to tell them apart. Journal rows now use
  the same localized labels as the literature card ("JCR Q1" for the JCR
  system and the locale's CAS tier label for the CAS system), and the CAS
  chip gains a tooltip.

## [1.4.0] - 2026-10-09

### Added

- **PDF full-text fallback chain with a guaranteed tail**: backend order and
  skip conditions moved into a pure decision layer (`parseChain`), and the
  chain now always ends with Zotero's built-in pdf.js text extraction
  (`ZoteroFulltextAdapter`, IR source `tier2-zotero-fulltext`). Fresh installs
  without the OpenDataLoader jar or a MinerU token previously failed hard and
  lost PDF full-text indexing entirely; now any PDF yields text. The fallback
  tier carries plain text only — no layout structure, a single item-level page
  span — and never impersonates a structured backend.
- **Local embedding model downloads**: `ModelDownloadManager` fetches model
  files on first use following the transformers.js `localModelPath` layout.
  Endpoint resolution follows the existing "override > region-derived >
  built-in" order — mainland China defaults to hf-mirror.com, elsewhere
  huggingface.co; `embedding.local.mirror` accepts a self-hosted proxy under
  Settings ▸ Regional endpoints. Models were previously neither bundled nor
  downloadable, leaving vector features unusable on fresh installs. A dedicated
  window shows download progress with ready/failure copy.
- **Automatic JRE for OpenDataLoader** (`pdfParser.opendataloader.autoJre`,
  on by default): when the jar is present but no Java runtime is found, a
  Temurin portable JRE (~40–50 MB) is downloaded into the data directory —
  no admin rights required; concurrent consumers share one install. Never
  triggers without the jar.
- **Search term history**: recent queries persist across sessions (dynamic
  pref, case-insensitive dedup, newest first, capacity-capped, write failures
  silent). With an empty search box the Hub search row lists recent terms for
  one-click reuse, plus a clear button.
- **Citation explorer drill-down**: the citation dialog now stacks — drill
  from any result into its cited-by or references list, move back up the
  stack, switch direction in place, sort results, and import rows inline
  without leaving the dialog.

### Fixed

- **Bridge stack-overflow on cyclic or deep payloads** (`PostMessageBridge`):
  the structured-clone walker now replaces cycles with marker objects and caps
  traversal depth — previously a deep payload (button-click chains) could
  exhaust SpiderMonkey's stack ("too much recursion") instead of degrading.

### Changed

- **Journal list rows adopt the literature-card visual grammar**: badge shell
  recipes extracted to a single source (`badgeRecipes`) shared with the
  literature card; rows switch to the bottom-divider row form, journal names
  move to the title tier with query-hit highlighting, and quality badges
  (risk / quartile / top) get their own line.

## [1.3.0] - 2026-09-30

### Added

- **Persistent cross-session cache for summary translation**: translations are
  sharded on disk under content-addressed keys (engine fingerprint + language
  pair + normalized source text), so re-translating the same item no longer
  repeatedly consumes quota-limited engines — measured on a real machine:
  11843 ms on the first run (fallback engine succeeded after the primary timed
  out), 3 ms on the second run with byte-identical output. Enabled by default
  with a 200 MB cap, pruned automatically at startup; the settings panel gains
  three controls — toggle, size cap, and truncation cap (defaults: on /
  200 MB / 10000 characters).
- **Backoff retry on HTTP 429 for key-based sources**: the eight key-based
  sources — serpapi, brave, tavily, google, serper, perplexity, exa, bing —
  are uniformly wrapped with rate-limit handling: both 429 response shapes are
  recognized, the retry interval from response headers takes priority
  (abnormally long intervals terminate immediately instead of idling), and a
  5-second jittered backoff with a single retry is used when no header is
  present. Rate limiting has its own dedicated message.
- **Truncation guard for summary translation and quota-error classification**:
  overlong summaries are truncated at 10000 characters by default (adjustable,
  0 disables the limit); when truncated, the translation carries a yellow
  notice bar. Quota / rate-limit / billing errors are uniformly classified
  into the actionable error code (`ai-quota-exceeded`), a missing
  configuration becomes `ai-not-configured`, and the machine-translation
  engine name is passed through as-is — quota errors are no longer misreported
  as AI quota issues.

### Fixed

- **Purge of dead style classes (six missing references)**: the four section
  headings on the journal-metrics card referenced `hub-overline`, a class that
  existed nowhere in the repository, flattening the hierarchy into body text;
  the search-failure banner, the model-expired warning bar, and the item-filter
  dialog region label were likewise left unstyled. All of them now follow the
  design spec, and a new class-reference-integrity guard test prevents
  recurrence. Nine utility classes used in source but missing from the
  compiled bundle (citation-card borders, warning outlines, etc.) are restored
  as well.
- **Reasoning models returning empty translations**: the output budget was
  derived from text length and got consumed by internal reasoning, yielding
  `finish_reason=length` with empty content — the output floor is raised to
  4096 tokens with a per-request cap of 8192.
- **Missing `AbortSignal` global in the Zotero 10 bootstrap sandbox**: every
  keyless translation endpoint (Google and its Bing fallback) threw a
  ReferenceError within milliseconds — fixed with a three-tier shim (host
  signal → AbortController fallback → proceed without a signal).
- **Explicit `auto` source language on the Bing web endpoint**: the live
  endpoint rejects `auto`; it is now mapped to `auto-detect`.

### Changed

- **PDF chunk vectors moved to a separate database**: the vectors now live in
  `zsearch_pdf_vectors.sqlite` so the main database no longer carries large
  binary blobs; existing inline vectors migrate lazily (read old column →
  write external → verify bytes → clear old column), with compensating
  deletion when the write fails.
- **tw.css regeneration pipeline checked in**: the Tailwind compile input
  (`scripts/tw-source.css`) and the regeneration script are now in the
  repository and wired into the build, so the compiled artifact is no longer
  source-less; the artifact shrank from 5103 to about 1900 lines (historical
  dead classes scanned from the old codebase removed).
- **Legacy settings-page cleanup**: the React settings components superseded
  by the native preferences window and an unloaded 2118-line stylesheet were
  deleted, along with nine orphaned locale keys removed in all three
  languages.
- **Positive-control self-test for the dead-key guard**: dead-key detection is
  extracted into a pure function shared by the real guard and its self-test —
  a validator without a positive control cannot prove that it catches
  problems.

## [1.2.3] - 2026-09-29

### Fixed

- **Local search: no more doomed queries when no index exists**: the search
  button is disabled (tooltip: "Build the full-text index before searching
  local content") when the library contains no index at all, and pressing
  Enter is blocked the same way — previously, typing keywords and clicking
  Search gave no feedback while the page stayed on the index onboarding, so
  there was no way to tell whether the search had actually run.
- **Item-filter dialog gains a "Confirm" button**: the contract is unchanged —
  changes apply immediately and take effect on the next search — but the only
  way to keep changes used to be closing via the top-right ×, while "Cancel"
  actually meant "revert and close"; keeping changes therefore required the ×,
  which was semantically confusing. Now "Confirm = keep and close" and
  "Cancel = revert and close" are clearly distinct, and "Reset all" keeps the
  dialog open, as before.
- **Predatory badge no longer leaks the internal category value**: the
  journal-metrics card used to show "(standalone)" — the raw enum from the
  list data went straight to the screen without localization; it is now
  localized per interface language ("Predatory (standalone journal)" in
  English, with hijacked journals treated the same way), while newly added
  categories without a translation still render as-is so no information is
  lost.
- **First tab on the search page renamed "Academic Search"**: the tab actually
  searches external academic databases, and the old name "Web Search" clashed
  with the web-search source management in the settings; the README already
  called it "Academic Search", so the naming is now unified. English
  "Web Search" → "Academic Search"; Traditional Chinese updated in sync.
- **On-device test suite sync**: the six README screenshots (three per
  language) were re-shot against the new UI; the tab-label-coupled assertions
  in the search-ui-states and feature-matrix suites were renamed accordingly;
  fixed a pre-existing defect in hub-visual-search — the suite forces an
  English UI yet matched the domain tab against the exact Chinese label for
  "Journals", so both cases had failed since the three-segment redesign
  (2026-09-28); they now use a bilingual regex. Added the yyy-ui-audit
  screenshot-inspection suite (main window / local search / settings panel).

## [1.2.2] - 2026-09-29

### Changed

- **Removal of Leadero brand leftovers (rename wrap-up)**: UI strings in the
  locale files ("Leadero Settings", "Leadero Assistant", etc.) became
  z-search; the 12 `leadero-*.css` files were renamed to `zsearch-*.css`; the
  tag value of AI-generated notes changed from `leadero-ai-generated` to
  `zsearch-ai-generated` (existing notes keep the old tag; only new notes use
  the new value); the unreferenced `PREF_PREFIX` dead code was deleted, and
  stale brand wording in comments was cleaned up.
- **Secret-store realm renamed and migrated**: the secrets realm in the login
  manager changed from "Leadero AI Secrets" to "z-search AI Secrets". A
  one-time idempotent migration runs at startup: credentials already present
  under the new realm are skipped, and old-realm copies are cleared regardless
  of the migration outcome; the old realm stays readable as a fallback until
  the migration completes — API keys stored by users survive the rename.

## [1.2.1] - 2026-09-29

### Fixed

- **Logo handle re-attached to the lens rim**: the old handle start point sat
  exactly on the right tip of the white Z's bottom stroke, and the red cap
  matched the white stroke in width, covering the round cap entirely — the two
  strokes were center-aligned and equal in length yet visibly 38 vs 30, so the
  Z read as vertically asymmetric; moreover, the red segment's contrast
  against the ink disc was insufficient (about 2.9:1), making it invisible at
  16 px, so the "handle meets the Z corner" design intent existed only at
  larger sizes that bit into the white. The handle start point moved outward
  to the circle edge (60.5, 59), the red now grows from the lens rim, and the
  white Z remains fully visible and equal-length; visible handle length
  38.2 → 29.0 (radius ratio 0.52, still within the classic 0.5–0.8 range).
  icon-dark.svg was updated in sync and the three raster images re-rendered
  (48/96, dark 48); the three shape elements and the palette are unchanged.

## [1.2.0] - 2026-09-28

### Changed

- **Logo proportion tuning**: the toolbar/preferences icons looked unbalanced
  because three proportions fought each other — the white Z sat 5 units right
  of center inside the circle (the right stroke tip touched the circle
  boundary while 10 units of space remained on the left), the 21.9-unit handle
  centerline was only 0.32 of the diameter (classics run 0.5–0.8) and read as
  a red wedge, and the 68-diameter disc nearly filled the whole 96 canvas. The
  new version shrinks the disc to a diameter of 56 and shifts it up and left,
  shrinks the Z and centers it exactly on the disc (9 units of margin on each
  side), and lengthens the handle to 38.2 (radius ratio 0.68) so that it
  extends beyond the disc; the three shape elements (ink disc / white Z /
  crimson handle) and the palette are unchanged.
- **Search-page domain switching folded into the top-left tab row**: the
  "items/journals" icon-pair button at the right edge of the header retired
  (its list/grid icons were misread as a list/card layout toggle); the
  three-segment "Web Search | Local Search | Journals" tab row moved up to
  become the pane-level domain switcher; leaving Journals and coming back
  keeps the web/local state, and the context-menu "Find Similar Items" deep
  link still goes straight to local similar-item search.
- **Notification pipeline slim-down**: retired the four unreferenced bridge
  modules hubBridge / usePref / BackendEventNotifier / broadcastPrefChanged;
  progress-window management lost its fictional API (canClose and "close
  button probing" are not real Zotero APIs), and iframe-side notifications now
  uniformly travel up through the bridge's notify with the host sending them —
  search-page receipts no longer take the wrong RPC channel and trigger resend
  storms.
- **addonName renamed to Z-Search**: the add-on display name's casing is fixed,
  and the Hub window's fallback name dropped the Leadero historical leftover.

### Added

- **Network region selection**: the settings panel gains a "Network Region"
  group (Auto / International / Mainland China). The add-on previously hid all
  reachability differences inside implicit fallback chains (when Google was
  unreachable, wait 10 seconds for the timeout, then fall back to Bing),
  leaving users no way to declare which part of the internet they live in.
  Declaring a region changes only the four settings still at factory defaults
  (default web-search source, translation engine, Azure Translator
  subscription region, CASS partition visibility) — user-modified settings are
  never overridden; the "Apply recommended defaults" button can re-apply them
  (force) at any time.
- **CASS partition visibility follows the region**: the CAS partition (CASS)
  is data from China's research-evaluation system, so its visibility is now
  region-gated — shown when the network region is "Mainland China", and fully
  withdrawn from journal search, item-result badges, academic scoring, and the
  main-window item-tree badges when set to "International" (scoring degrades
  to pure JCR, so global users' rankings are no longer influenced by
  China-specific priors); with the region undeclared, historical behavior
  applies (offline local data shown by default). The "Network Region" group
  gains an independent dropdown (Auto / Show / Hide, `region.cassPartition`) —
  global users may well study Chinese journals, so this only changes default
  visibility and never removes access outright.
- **Region-restricted endpoints overridable**: four endpoints that operate
  only in their home region (or run language-specific sites) — easyScholar,
  MinerU cloud, the Adoptium JRE download, and the Wikipedia domain — can be
  pointed at a mirror or a self-hosted proxy in the settings panel's
  "Region-Restricted Endpoints" group; leave blank to use the built-ins.
  Invalid values (missing protocol, not a bare hostname) are rejected on the
  spot and never persisted.
- **Selectable translation engine**: `translate.engineType` enters the
  settings panel, including the new keyless "Bing Web" engine (the only
  reachable keyless option in mainland China; previously it was just an
  implicit fallback of Google); the Azure Translator subscription region
  (`translate.bing.region`, a pref that existed without any UI) gets an
  editable dropdown — a domestic Azure key no longer requires hand-editing
  prefs.js.
- **Import target selector**: the search-results toolbar gains an "Import to"
  dropdown — by default it follows the collection selected in the main window;
  a library (including group libraries) and a collection can be set
  explicitly, effective for both single and batch imports, with the choice
  persisted (`search.importTarget`). Items land via the native
  `libraryID/collections` options of `Zotero.Translate`; a stale target
  (collection deleted) silently falls back to the main-window selection.

### Fixed

- **Idempotent DOI batch import**: a normalized-DOI precheck before import
  returns the existing item on a hit instead of creating a duplicate (covers
  retry timeouts, repeated clicks on the citation dialog, and batches that mix
  in owned items); idempotent hits do not re-attach OA files; explicitly
  library-only targets no longer fall back to the main window's current
  collection, preventing cross-library misattachment; the citation-import
  button is disabled after success.
- **Journal search error triage**: OpenAlex server-side errors now surface
  with a failure state instead of falsely reporting "journal not found"; the
  JIF badge tooltip shows the full "Impact Factor Qx".
- **Multiple main-window isolation**: menus, toolbars, shortcuts, and the
  journal-badge column now register and unregister per window — previously,
  closing one main window tore down the entries of all remaining windows; the
  journal-badge column is reference-counted and removed only when the last
  main window unloads.
- **Settings-panel ApiKeyInput**: Escape rollback is no longer mis-committed
  as an edit on blur; entering edit mode focuses the input automatically.
- **Semantic-search error message localization**: no active pane / no selected
  items / missing item no longer produce raw English strings.

## [1.1.0] - 2026-09-27

Feature batch driven by user research (P0×4 + P1×2 + index expansion):

### Added

- **Journal-metrics column in the item tree**: IF / JCR quartile / CAS
  partition / top-journal / warning / predatory badges shown inline in the
  library list (offline data with journal-name matching; keyless, zero
  network)
- **Citation drilling**: the citation count on a result card is clickable
  (citing works), with a new "References" entry; OpenAlex drills in both
  directions, and sub-lists support direct import
- **Automatic OA PDF attachment on import**: direct-link hints on cards take
  priority with the OpenAlex `best_oa_location` as fallback; failures silently
  degrade to metadata only, and this can be turned off in settings
- **"In library" marker**: DOIs are compared against the local library to
  prevent duplicate imports (batch imports included)
- **OA filter**: open-access-only view (host-side filtering; caps apply to the
  filtered set)
- **Toolbar magnifier button + Ctrl/Cmd+Shift+K shortcut** (the button can be
  hidden in settings; toggling takes effect immediately)
- **Chinese core-journal badges** (PKU Core / CSCD / CSSCI / S&T Core):
  activated by filling in the free easyScholar API key; defensive parsing, and
  zero requests when unconfigured
- **PDF annotations included in the library index**: highlighted text and
  comments are now reachable by semantic search (coverage aligned with
  All Search)

### Fixed & engineering

- Plugin-sandbox field notes: no `Cc/Services` global (XPCOM goes through
  `Components.classes`); a runtime dynamic `import()` resolves to a second
  module instance (the api module must be referenced statically); the add-on's
  prefs actually live under the `extensions.zotero.zsearch.*` branch
- On-device suite at 28 cases (new toolbar registration/visibility, five
  easyScholar parsing cases, etc.); the discover visual case is a known
  environmental red when OpenAlex hits its daily-quota 429 (commented in the
  suite)

## [0.1.0] - 2026-09-24

First internal build: a four-in-one Zotero add-on — academic search / web
search / repository search / vector search.

[unreleased]: https://github.com/Liozhang/z-search/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Liozhang/z-search/compare/v1.2.3...v1.3.0
[1.2.3]: https://github.com/Liozhang/z-search/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/Liozhang/z-search/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Liozhang/z-search/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Liozhang/z-search/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Liozhang/z-search/compare/v1.0.2...v1.1.0
[0.1.0]: https://github.com/Liozhang/z-search/releases/tag/v0.1.0
