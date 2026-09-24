/**
 * Zotero Translate API Integration
 *
 * Automatic metadata extraction from URLs, DOIs, and identifiers
 */

export interface MetadataExtractionResult {
  success: boolean;
  itemType?: string;
  title?: string;
  creators?: Array<{
    firstName?: string;
    lastName?: string;
    creatorType?: string;
  }>;
  abstract?: string;
  year?: string;
  date?: string;
  publicationTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  isbn?: string;
  url?: string;
  tags?: string[];
  pmid?: string;
  error?: string;
  /** Zotero item ID if Translate API already created the item */
  zoteroItemId?: number;

  // ── Patent-specific fields (populated when itemType === "patent") ──
  patentNumber?: string;
  applicationNumber?: string;
  assignee?: string;
  filingDate?: string;
  issueDate?: string;
  priorityDate?: string;
  priorityNumbers?: string;
  legalStatus?: string;
  country?: string;
  authority?: string;
}

import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import { toErrorMessage } from "../../utils/error";
import { getPrefDynamic } from "../../utils/prefs";
import { ncbiThrottle } from "../../utils/ncbiThrottle";
import {
  looksLikePatentNumber,
  parsePatentNumber,
} from "../patent/PatentNumberNormalizer";
import { safeDebug } from "../../utils/logger";

export type TranslationSource =
  "url" | "doi" | "isbn" | "pmid" | "arxiv" | "patent" | "manual";

class MetadataExtractor {
  private translationCache: Map<string, MetadataExtractionResult> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async extract(
    source: TranslationSource,
    identifier: string,
  ): Promise<MetadataExtractionResult> {
    const cacheKey = `${source}:${identifier}`;

    const cached = this.translationCache.get(cacheKey);
    if (cached && Date.now() - (cached as any).timestamp < this.cacheTimeout) {
      return cached;
    }

    let result: MetadataExtractionResult;

    try {
      switch (source) {
        case "url":
          result = await this.extractFromURL(identifier);
          break;
        case "doi":
          result = await this.extractFromDOI(identifier);
          break;
        case "isbn":
          result = await this.extractFromISBN(identifier);
          break;
        case "pmid":
          result = await this.extractFromPMID(identifier);
          break;
        case "arxiv":
          result = await this.extractFromArXiv(identifier);
          break;
        case "patent":
          result = await this.extractFromPatent(identifier);
          break;
        case "manual":
          result = await this.extractManual(identifier);
          break;
        default:
          result = { success: false, error: "Unknown source type" };
      }
    } catch (e) {
      result = { success: false, error: (e as Error).message };
    }

    (result as any).timestamp = Date.now();
    this.translationCache.set(cacheKey, result);

    return result;
  }

  /**
   * Run Zotero.Translate.Search with proper handler pattern (Zotero 8).
   * Must call callback in select handler and await translate.translate().
   */
  private async runTranslateSearch(
    identifier: Record<string, string>,
  ): Promise<MetadataExtractionResult> {
    const Translate = (Zotero as any).Translate;
    if (!Translate || !Translate.Search) {
      throw new Error("Translate API not available");
    }

    const translate = new Translate.Search();
    translate.setIdentifier(identifier);

    const translators = await translate.getTranslators();
    if (!translators || translators.length === 0) {
      return { success: false, error: "No translators found" };
    }
    translate.setTranslator(translators);

    // Zotero 8 handler pattern: select must call callback, translate() returns items
    translate.setHandler(
      "select",
      (trans: any, items: any[], callback: any) => {
        for (const i in items) {
          const obj: Record<string, any> = {};
          obj[i] = items[i];
          callback(obj);
          return;
        }
      },
    );

    translate.setHandler("error", (trans: any, error: any) => {
      throw new Error(toErrorMessage(error));
    });

    const newItems: any[] = await translate.translate({
      saveAttachments: false,
    });

    if (!newItems || newItems.length === 0) {
      return { success: false, error: "No items found" };
    }

    const item = newItems[0];
    return {
      success: true,
      zoteroItemId: item.id,
      itemType: item.itemType,
      title: item.title,
      creators: item.creators,
      abstract: item.abstractNote,
      date: item.date,
      publicationTitle: item.publicationTitle,
      volume: item.volume,
      issue: item.issue,
      pages: item.pages,
      doi: item.DOI,
      isbn: item.ISBN,
      url: item.url,
      tags: item.tags?.map((t: any) => t.tag) || [],
    };
  }

  private async extractFromURL(url: string): Promise<MetadataExtractionResult> {
    const doiMatch = url.match(/doi\.org\/(10\.\d{4,9}\/[^\s]+)/);
    const arxivMatch = url.match(/arxiv\.org\/abs\/(\d+\.\d+)/);

    if (doiMatch) {
      return await this.runTranslateSearch({ DOI: doiMatch[1] });
    } else if (arxivMatch) {
      return await this.runTranslateSearch({ arXiv: arxivMatch[1] });
    }
    return {
      success: false,
      error: "Could not detect DOI or arXiv ID from URL",
    };
  }

  private async extractFromDOI(doi: string): Promise<MetadataExtractionResult> {
    const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, "");
    return await this.runTranslateSearch({ DOI: cleanDoi });
  }

  private async extractFromISBN(
    isbn: string,
  ): Promise<MetadataExtractionResult> {
    // Use Google Books API
    try {
      const response = await Zotero.HTTP.request(
        "GET",
        `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`,
        {
          headers: {
            Accept: "application/json",
            ...ZSEARCH_HTTP_HEADERS,
          },
        },
      );

      if (response.status === 200 && response.responseText) {
        const data = JSON.parse(response.responseText);
        if (data.items && data.items.length > 0) {
          const info = data.items[0].volumeInfo;
          return {
            success: true,
            itemType: "book",
            title: info.title,
            creators: (info.authors || []).map((a: any) => ({
              firstName: a.split(" ").slice(0, -1).join(" "),
              lastName: a.split(" ").pop(),
              creatorType: "author",
            })),
            abstract: info.description,
            year: info.publishedDate?.substring(0, 4),
            isbn: isbn,
            tags: [],
          };
        }
      }
    } catch (e) {
      safeDebug("[z-search] ISBN lookup error: " + e);
    }

    // Fallback to Zotero translators
    return await this.extractFromURL(`https://worldcat.org/isbn/${isbn}`);
  }

  private async extractFromPMID(
    pmid: string,
  ): Promise<MetadataExtractionResult> {
    // Zotero Translate doesn't support PMID directly; use NCBI E-utilities API
    try {
      const apiKey = getPrefDynamic("apis.pubmed.apiKey") as string;
      let url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json&tool=leadero`;
      if (apiKey) url += `&api_key=${encodeURIComponent(apiKey)}`;

      await ncbiThrottle();
      const response = await Zotero.HTTP.request("GET", url, {
        headers: {
          Accept: "application/json",
          ...ZSEARCH_HTTP_HEADERS,
        },
        timeout: 15000,
      } as any);

      if (response.status >= 400 || !response.responseText) {
        return { success: false, error: `NCBI API error: ${response.status}` };
      }

      const data = JSON.parse(response.responseText);
      const result = data.result?.[pmid];
      if (!result) {
        return { success: false, error: "No PubMed record found" };
      }

      const authors = (result.authors || []).map((a: any) => ({
        firstName: (a.name || "").split(" ").slice(0, -1).join(" "),
        lastName: (a.name || "").split(" ").pop() || "",
        creatorType: "author",
      }));

      return {
        success: true,
        itemType: "journalArticle",
        title: result.title || "",
        creators: authors,
        abstract: "",
        date: result.pubdate?.substring(0, 4) || "",
        publicationTitle: result.fulljournalname || result.source || "",
        volume: result.volume || "",
        pages: result.pages || "",
        doi: result.elocationid?.replace("doi: ", "") || "",
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        tags: [],
        pmid,
      };
    } catch (e: any) {
      return { success: false, error: `PubMed lookup failed: ${e.message}` };
    }
  }

  private async extractFromArXiv(
    arxivId: string,
  ): Promise<MetadataExtractionResult> {
    const cleanId = arxivId
      .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
      .replace(/^https?:\/\/arxiv\.org\//, "");
    return await this.runTranslateSearch({ arXiv: cleanId });
  }

  /**
   * Extract patent metadata by patent number.
   * USPTO ODP for US applications (needs X-Api-Key, covers pending apps post-2001).
   * Non-US or granted patents are not in ODP scope — user must use search-patents tool.
   */
  private async extractFromPatent(
    patentNumber: string,
  ): Promise<MetadataExtractionResult> {
    const parsed = parsePatentNumber(patentNumber);
    if (!parsed) {
      return {
        success: false,
        error: `Could not parse patent number: "${patentNumber}". Expected format like US9999999B2 or EP1234567A1.`,
      };
    }

    // USPTO ODP covers US applications only
    if (parsed.countryCode !== "us") {
      return {
        success: false,
        error: `Direct patent metadata extraction supports US applications only (got ${parsed.countryCode.toUpperCase()}). For non-US patents, use the search-patents or get-patent-details tool with EPO OPS / Lens configured.`,
      };
    }

    const apiKey = getPrefDynamic("apis.uspto.apiKey") as string;
    if (!apiKey) {
      return {
        success: false,
        error:
          "USPTO ODP API key required (apis.uspto.apiKey). Register at https://data.uspto.gov/apis/getting-started.",
      };
    }

    try {
      const url =
        `https://api.uspto.gov/api/v1/patent/applications/search` +
        `?query=${encodeURIComponent(parsed.number)}&start=0&rows=1`;

      const response = await Zotero.HTTP.request("GET", url, {
        headers: {
          Accept: "application/json",
          "X-Api-Key": apiKey,
          ...ZSEARCH_HTTP_HEADERS,
        },
        timeout: 30000,
        errorDelayMax: 0,
      } as any);

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: `USPTO auth failed (${response.status}). Check apis.uspto.apiKey.`,
        };
      }
      if (response.status >= 400) {
        return { success: false, error: `USPTO API error: ${response.status}` };
      }

      const data = JSON.parse(response.responseText ?? "");
      // ODP response shape variations: patents / results / applications / items
      const raw: any = (data.patents ||
        data.results ||
        data.applications ||
        data.items ||
        [])[0];
      if (!raw) {
        return {
          success: false,
          error: `Application not found in USPTO ODP: ${patentNumber}. ODP covers pending US applications (post-2001-01-01). Granted patents are not in ODP — use search-patents with EPO OPS.`,
        };
      }

      // Field name variations across ODP response versions
      const appNum =
        raw.patent_number ||
        raw.app_number ||
        raw.applicationNumber ||
        raw.appApplicationNumber ||
        "";
      const title =
        raw.patent_title ||
        raw.app_title ||
        raw.inventionTitle ||
        raw.appInventionTitle ||
        "";
      const abstract =
        raw.patent_abstract || raw.app_abstract || raw.briefSummaryText || "";

      const inventorsRaw: any[] =
        raw.inventors || raw.app_inventors || raw.inventorsList || [];
      const inventors = inventorsRaw.map((inv: any) => ({
        firstName:
          typeof inv === "string"
            ? ""
            : inv.inventor_first_name || inv.firstName || "",
        lastName:
          typeof inv === "string"
            ? inv
            : inv.inventor_last_name || inv.lastName || "",
        creatorType: "inventor" as const,
      }));

      const assigneesRaw: any[] =
        raw.assignees || raw.app_assignees || raw.assigneesList || [];
      const assignees = assigneesRaw
        .map((a: any) => {
          if (typeof a === "string") return a;
          return (
            a.assignee_organization ||
            a.name ||
            `${a.assignee_individual_first_name || ""} ${a.assignee_individual_last_name || ""}`.trim()
          );
        })
        .filter(Boolean);

      const cpcsRaw: any[] = raw.cpcs || raw.cpcSubclassesList || [];
      const cpcClass = cpcsRaw
        .map((c: any) =>
          typeof c === "string"
            ? c
            : c.cpc_group_id || c.cpcSubclassId || c.classification || "",
        )
        .filter(Boolean);

      const date =
        raw.patent_date ||
        raw.app_filing_date ||
        raw.filingDate ||
        raw.appFilingDate ||
        "";

      return {
        success: true,
        itemType: "patent",
        title,
        creators: inventors,
        abstract,
        date,
        url: `https://patents.google.com/patent/US${appNum}`,
        tags: cpcClass,
        // Patent-specific fields
        patentNumber: `US${appNum}`,
        assignee: assignees[0] || "",
        issueDate: date,
        country: "US",
        authority: "USPTO",
        // Application stage: not granted yet
        legalStatus: "pending",
      };
    } catch (e: any) {
      return { success: false, error: `Patent lookup failed: ${e.message}` };
    }
  }

  private async extractManual(data: string): Promise<MetadataExtractionResult> {
    // Try to detect the type of input
    if (data.match(/^10\.\d{4,9}/)) {
      return await this.extractFromDOI(data);
    } else if (data.match(/\d{10,13}/)) {
      return await this.extractFromISBN(data);
    } else if (data.startsWith("http")) {
      return await this.extractFromURL(data);
    }

    return { success: false, error: "Could not identify input type" };
  }

  async autoDetect(input: string): Promise<MetadataExtractionResult> {
    if (input.match(/^10\.\d{4,9}/) || input.includes("doi.org/")) {
      const doi = input.replace(/.*doi\.org\//, "").replace(/.*doi\//, "");
      return await this.extract("doi", doi);
    }

    if (input.startsWith("http://") || input.startsWith("https://")) {
      return await this.extract("url", input);
    }

    if (input.match(/\d{4}\.\d{4,5}/) || input.includes("arxiv.org/")) {
      const arxivId = input.replace(/.*arxiv\.org\//, "").replace(/abs\//, "");
      return await this.extract("arxiv", arxivId);
    }

    if (
      input.match(
        /^(?:ISBN(?:-1[03])?:? )?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]?){3})[- 0-9X]{13}$)/i,
      )
    ) {
      const isbn = input.replace(/[^0-9X]/gi, "");
      return await this.extract("isbn", isbn);
    }

    // Detect PMID (PubMed ID)
    if (input.match(/^\d+$/) && input.length <= 8) {
      return await this.extract("pmid", input);
    }

    // Detect patent number (e.g., US9999999B2, EP1234567A1, CN-12345678-A)
    if (looksLikePatentNumber(input)) {
      return await this.extract("patent", input);
    }

    return { success: false, error: "Could not auto-detect input type" };
  }

  async batchExtract(
    inputs: Array<{ source: TranslationSource; identifier: string }>,
  ): Promise<MetadataExtractionResult[]> {
    const results: MetadataExtractionResult[] = [];

    const batchSize = 3;
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(({ source, identifier }) => this.extract(source, identifier)),
      );
      results.push(...batchResults);

      if (i + batchSize < inputs.length) {
        await new Promise((resolve) =>
          (globalThis as any).setTimeout(resolve, 500),
        );
      }
    }

    return results;
  }

  async createItemFromMetadata(
    metadata: MetadataExtractionResult,
    collectionID?: number,
  ): Promise<number | null> {
    if (!metadata.success) {
      return null;
    }

    try {
      // If Translate API already created the item, just add to collection
      if (metadata.zoteroItemId) {
        if (collectionID !== undefined) {
          const item = Zotero.Items.get(metadata.zoteroItemId);
          if (item) {
            const collections = item.getCollections();
            if (!collections.includes(collectionID)) {
              collections.push(collectionID);
              item.setCollections(collections);
              await item.saveTx();
            }
          }
        }
        return metadata.zoteroItemId;
      }

      // Create new item manually (for non-Translate sources like ISBN/PMID)
      const itemType = (metadata.itemType as any) || "book";
      const item = new Zotero.Item(itemType);
      item.setField("title", metadata.title || "");

      if (metadata.creators) {
        for (const creator of metadata.creators) {
          (item as any).setCreator(item.getCreators?.()?.length ?? 0, {
            firstName: creator.firstName || "",
            lastName: creator.lastName || "",
            creatorType: creator.creatorType || "author",
          });
        }
      }

      item.setField("abstractNote", metadata.abstract || "");
      item.setField("date", metadata.date || "");
      item.setField("publicationTitle", metadata.publicationTitle || "");
      item.setField("volume", metadata.volume || "");
      item.setField("issue", metadata.issue || "");
      item.setField("pages", metadata.pages || "");
      item.setField("DOI", metadata.doi || "");
      item.setField("ISBN", metadata.isbn || "");
      item.setField("url", metadata.url || "");

      // Patent-specific fields (only when itemType === "patent")
      if (itemType === "patent") {
        const patentFields: Record<string, any> = {
          patentNumber: metadata.patentNumber,
          applicationNumber: metadata.applicationNumber,
          assignee: metadata.assignee,
          filingDate: metadata.filingDate,
          issueDate: metadata.issueDate,
          priorityDate: metadata.priorityDate,
          priorityNumbers: metadata.priorityNumbers,
          legalStatus: metadata.legalStatus,
          country: metadata.country,
          authority: metadata.authority,
        };
        for (const [field, value] of Object.entries(patentFields)) {
          if (value) {
            try {
              item.setField(field, value);
            } catch (e) {
              safeDebug("[z-search] MetadataExtractor: " + e);
              // Field name not valid for this itemType variant — skip silently
            }
          }
        }
      }

      if (metadata.tags) {
        for (const tag of metadata.tags) {
          item.addTag(tag);
        }
      }

      // Add to collection if specified
      if (collectionID !== undefined) {
        item.setCollections([collectionID]);
      }

      await item.saveTx();
      return item.id;
    } catch (_e) {
      return null;
    }
  }

  async updateItemFromMetadata(
    itemID: number,
    metadata: MetadataExtractionResult,
  ): Promise<boolean> {
    if (!metadata.success) {
      return false;
    }

    const item = Zotero.Items.get(itemID);
    if (!item) {
      return false;
    }

    try {
      // Update fields that are present in metadata
      if (metadata.title) item.setField("title", metadata.title);
      if (metadata.abstract) item.setField("abstractNote", metadata.abstract);
      if (metadata.date) item.setField("date", metadata.date);
      if (metadata.publicationTitle)
        item.setField("publicationTitle", metadata.publicationTitle);
      if (metadata.volume) item.setField("volume", metadata.volume);
      if (metadata.issue) item.setField("issue", metadata.issue);
      if (metadata.pages) item.setField("pages", metadata.pages);
      if (metadata.doi) item.setField("DOI", metadata.doi);
      if (metadata.isbn) item.setField("ISBN", metadata.isbn);
      if (metadata.url) item.setField("url", metadata.url);

      if (metadata.tags) {
        for (const tag of metadata.tags) {
          item.addTag(tag);
        }
      }

      await item.saveTx();
      return true;
    } catch (_e) {
      return false;
    }
  }

  clearCache(): void {
    this.translationCache.clear();
  }

  getCacheSize(): number {
    return this.translationCache.size;
  }
}

const metadataExtractor = new MetadataExtractor();

export default metadataExtractor;
export { MetadataExtractor };
