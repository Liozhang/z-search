/**
 * Zotero global type augmentations
 */

// Augment the _Zotero interface for event methods
declare namespace Zotero {
  interface _Zotero {
    notify(event: string, data?: any): void;
    on(
      event: string,
      callback: (
        event: string,
        type: string,
        ids: (string | number)[],
        extraData: { [key: string]: any },
      ) => void,
    ): void;
    off(
      event: string,
      callback: (
        event: string,
        type: string,
        ids: (string | number)[],
        extraData: { [key: string]: any },
      ) => void,
    ): void;

    // Additional Zotero API methods
    getSelectedCollection?(): any;
    getGlobal?(key: string): any;
  }

  // Core module namespaces (XPCOM)
  namespace Feeds {
    /**
     * Get all feeds
     * @returns Promise<Feed[]>
     */
    function getAll(): Promise<Feed[]>;

    /**
     * Get a feed by its key
     * @param key - Feed key
     * @returns Promise<Feed | null>
     */
    function getByKey(key: string): Promise<Feed | null>;

    /**
     * Get a feed by its URL
     * @param url - Feed URL
     * @returns Promise<Feed | null>
     */
    function getByURL(url: string): Promise<Feed | null>;

    /**
     * Check if a feed with this URL exists
     * @param url - Feed URL
     * @returns Promise<boolean>
     */
    function existsByURL(url: string): Promise<boolean>;

    /**
     * Subscribe to a new RSS/Atom feed
     * @param url - Feed URL
     * @param name - Display name
     * @param refreshInterval - Hours between updates
     * @returns Promise<{ feed: Feed }>
     */
    function subscribe(
      url: string,
      name?: string,
      refreshInterval?: number,
    ): Promise<{ feed: Feed }>;

    /**
     * List items from feeds
     * @param feedKey - null for all feeds, or specific feed key
     * @param options - { unreadOnly?: boolean, limit?: number }
     * @returns Promise<{ items: FeedItem[], total: number, feed?: { key: string; name: string } }>
     */
    function listItems(
      feedKey: string | null,
      options?: { unreadOnly?: boolean; limit?: number },
    ): Promise<{
      items: FeedItem[];
      total: number;
      feed?: { key: string; name: string };
    }>;

    /**
     * Delete a feed
     * @param feedKey - Feed key
     * @returns Promise<boolean>
     */
    function deleteFeed(feedKey: string): Promise<boolean>;
  }

  namespace FeedItems {
    /**
     * Mark items as read/unread
     * @param ids - Array of item IDs
     * @param isRead - Desired read state
     * @returns Promise<void>
     */
    function toggleReadByID(ids: number[], isRead: boolean): Promise<void>;
  }

  namespace Duplicates {
    /**
     * Create a Duplicates helper for finding duplicates
     */
    class Duplicates {
      constructor();
      /**
       * Get a Search object that returns duplicate set info
       * @param libraryID - Library to search
       * @returns Search with temporary table { duplicateSetID, itemID }
       */
      getSearchObject(libraryID?: number): Search;
      /**
       * Get the duplicate set ID for an item
       * @param itemID - Item ID
       * @returns setID or null
       */
      getItemSetID(itemID: number): Promise<number | null>;
      /**
       * Get all item IDs in the same duplicate set as this item
       * @param itemID - Item ID
       * @returns Array of item IDs
       */
      getSetItemsByItemID(itemID: number): Promise<number[]>;
    }
  }

  namespace Retractions {
    /**
     * Initialize the retraction database (downloads from server)
     * @returns Promise<void>
     */
    function init(): Promise<void>;

    /**
     * Whether the retractions module is initialized
     */
    let initialized: boolean;

    /**
     * Check if an item is retracted
     * @param item - Zotero.Item object
     * @returns boolean
     */
    function isRetracted(item: Item): boolean;

    /**
     * Get retraction reason for an item
     * @param item - Zotero.Item object
     * @returns string or null
     */
    function getRetractionReason(item: Item): string | null;

    /**
     * Get retraction source for an item
     * @param item - Zotero.Item object
     * @returns string or null
     */
    function getRetractionSource(item: Item): string | null;

    /**
     * Check retraction by identifier (DOI/PMID)
     * @param identifier - DOI or PMID string
     * @returns boolean
     */
    function isRetractedByIdentifier(identifier: string): boolean;
  }

  // Feed class (extends Library)
  interface Feed {
    id: number;
    key: string;
    url: string;
    name: string;
    libraryID: number;
    refreshInterval: number;
    cleanupReadAfter: number;
    cleanupUnreadAfter: number;
    lastUpdate: number;
    lastError: string;
    dateAdded: number;
    dateModified: number;

    /**
     * Update feed from remote source
     * @returns AsyncGenerator<FeedItem, void, unknown>
     */
    updateFeed(): AsyncGenerator<FeedItem>;

    /**
     * Get all items from this feed
     * @returns Promise<FeedItem[]>
     */
    getItems(): Promise<FeedItem[]>;

    /**
     * Save to database
     * @returns Promise<void>
     */
    saveTx(): Promise<void>;

    /**
     * Delete this feed
     * @returns Promise<void>
     */
    eraseTx(): Promise<void>;

    /**
     * Clean up old items based on cleanup settings
     * @returns Promise<number> count deleted
     */
    cleanupOldItems(): Promise<number>;
  }

  // FeedItem class (extends Item)
  interface FeedItem extends Item {
    feedID: number;
    guid: string;
    title: string;
    url: string;
    abstractNote: string;
    creators: Array<{
      name: string;
      firstName?: string;
      lastName?: string;
      field?: string;
    }>;
    isRead: boolean;
    isTranslated: boolean;
  }

  // Notifier
  namespace Notifier {
    type NotifierObserverLike =
      | {
          notify: (
            event: string,
            type: string,
            ids: (string | number)[],
            extraData: { [key: string]: any },
          ) => void | Promise<void>;
        }
      | ((
          event: string,
          type: string,
          ids: (string | number)[],
          extraData: { [key: string]: any },
        ) => void | Promise<void>);

    /**
     * Register observer for events
     * @param observer - callback function or object with notify method
     * @param types - array of event types or null for all
     * @param id - observer identifier
     * @param priority - priority number
     */
    function registerObserver(
      observer: NotifierObserverLike,
      types: string[] | null,
      id?: string,
      priority?: number,
    ): string;

    /**
     * Unregister observer by ID or by reference
     * @param observerOrId - observer ID string or observer reference
     * @param types - array of event types (optional when using ID)
     * @param id - observer identifier (optional)
     */
    function unregisterObserver(
      observerOrId: string | NotifierObserverLike,
      types?: string[],
      id?: string,
    ): void;

    /**
     * Trigger an event
     */
    function trigger(
      event: string,
      type?: string,
      ids?: (string | number)[],
      extraData?: { [key: string]: any },
    ): void;
  }

  // Augment Item instance type with common getters
  interface Item {
    id: number;
    key: string;
    title: string;
    date: string;
    DOI?: string;
    ISBN?: string;
    PMID?: string;
    URL?: string;
    abstractNote?: string;
    creators?: Array<{
      name: string;
      firstName?: string;
      lastName?: string;
      field?: string;
    }>;
    itemType: string;
    dateAdded: number;
    dateModified: number;

    getField(field: string): any;
    setField(field: string, value: any): void;
    getTags(): { tag: string }[];
    addTag(tag: string | { tag: string }): Promise<void>;
    getCollections(): Collection[];
    saveTx(): Promise<void>;
    eraseTx(): Promise<void>;
    isNote(): boolean;
    isAttachment(): boolean;
    /** Removed in Zotero 10.0.1 — use utils/itemDisplayName shim. */
    getDisplayName?(): string;
    getDisplayTitle(): string;
  }

  // Collection class
  interface Collection {
    id: number;
    key: string;
    name: string;
    libraryID: number;

    addItem(item: Item): Promise<boolean>;
    addItems(itemIDs: number[]): Promise<void>;
    getItems(): Promise<Item[]>;
    removeItems(itemIDs: number[]): Promise<void>;
    saveTx(): Promise<void>;
    eraseTx(): Promise<void>;
  }

  // Search class
  class Search {
    name: string;
    id: number;
    constructor();
    addCondition(field: string, operator: string, value: any): void;
    search(): Promise<number[]>;
    saveTx(): Promise<void>;
  }

  // Attachments
  namespace Attachments {
    function getByItem(itemID: number): Promise<Attachment[]>;
    function importFromFile(options: {
      file: any;
      parentItemID?: number;
      fileContentType?: string;
      fileTitle?: string;
    }): Promise<any>;
    function importFromSnapshotContent(options: {
      url: string;
      snapshotContent: string;
      parentItemID?: number;
      title?: string;
      collections?: number[];
      saveOptions?: any;
    }): Promise<any>;
    const LINK_MODE_LINKED_FILE: number;
    const LINK_MODE_IMPORTED_FILE: number;
  }

  // FullText (Zotero uses both FullText and Fulltext)
  namespace FullText {
    function getItemText(item: any): Promise<string>;
  }

  namespace Fulltext {
    function getItemText(item: any): Promise<string>;
  }

  interface Attachment extends Item {
    itemID: number;
    url: string;
    contentType: string;
  }

  // Notes
  namespace Notes {
    function getByItem(itemID: number): Promise<Note[]>;
  }

  interface Note extends Item {
    note: string;
    getNote(): string;
    setNote(note: string): void;
  }

  // DB
  namespace DB {
    function queryAsync(
      sql: string,
      params?: any[],
      options?: any,
    ): Promise<any[]>;
    function valueQueryAsync(sql: string, params?: any[]): Promise<any>;
    function columnQueryAsync(sql: string, params?: any[]): Promise<any[]>;
    function executeTransaction<T>(fn: () => Promise<T>): Promise<T>;
    function columnQuery(sql: string, params?: any[]): any[] | null;
    function query(sql: string, params?: any[]): any[];
    function valueQuery(sql: string, params?: any[]): any;
  }

  // HTTP
  namespace HTTP {
    interface HTTPResponse {
      status: number;
      response: any;
      statusText?: string;
      responseText?: string;
      getResponseHeader(name: string): string | null;
    }
    function request(
      method: string,
      url: string,
      options?: {
        body?: string;
        responseType?: string;
        headers?: Record<string, string>;
        timeout?: number;
      },
    ): Promise<HTTPResponse>;
    function download(
      url: string,
      path: string,
      options?: {
        headers?: Record<string, string>;
        timeout?: number;
      },
    ): Promise<void>;
  }

  // File
  namespace File {
    function pathToFile(path: string): any;
    function getContentsAsync(
      path: string,
      encoding?: string | null,
      maxBytes?: number,
    ): Promise<string>;
    function putContentsAsync(path: string, content: string): Promise<void>;
    function exists(path: string): boolean;
    function createDirectory(path: string): void;
  }

  // Utilities
  function debug(message: string, ...args: any[]): void;
  function getSelectedCollection(): any;
  function getGlobal(key: string): any;

  // Utilities.Item — CSL JSON conversion
  namespace Utilities {
    namespace Item {
      function itemToCSLJSON(item: Item): any;
    }
  }

  // URI — item URI generation and parsing
  namespace URI {
    function getItemURI(item: Item): string;
    function getURIItemLibraryKey(
      uri: string,
    ): { libraryID: number; key: string; itemType: string } | false;
  }

  // EditorInstanceUtilities — citation formatting (may not be available in all contexts)
  const EditorInstanceUtilities:
    | {
        formatCitation(citation: {
          citationItems: any[];
          properties: any;
        }): string | null;
      }
    | undefined;
}

// ZoteroPane global (window.ZoteroPane)
declare const ZoteroPane: {
  getSelectedCollection?(): any;
};

// Notifier observer type
type NotifierObserver = (
  event: string,
  type: string,
  ids: (string | number)[],
  extraData: { [key: string]: any },
) => void;
