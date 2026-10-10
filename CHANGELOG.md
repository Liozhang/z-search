# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
Release notes published with a version are taken verbatim from that version's
section in this file (see `release.changelog` in `zotero-plugin.config.ts`).

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
