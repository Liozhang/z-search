/**
 * Search atoms — Full-text search state, results, history, filters.
 * Also contains in-conversation search atoms.
 */

import { atom } from "jotai";

/** Current search query (cross-session message search) */
export const searchQueryAtom = atom<string>("");

/** In-conversation search: whether the search bar is visible */
export const inChatSearchActiveAtom = atom<boolean>(false);

/** In-conversation search: current query string (debounced) */
export const inChatSearchQueryAtom = atom<string>("");

/** In-conversation search: current match index for navigation */
export const inChatSearchIndexAtom = atom<number>(0);

/** In-conversation search: total match count */
export const inChatSearchCountAtom = atom<number>(0);

/** Search results */
export interface SearchResult {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  matchSnippet: string;
  matchRole: string;
  matchTimestamp: number;
  score: number;
}
export const searchResultsAtom = atom<SearchResult[]>([]);

/** Current match index for next/prev navigation (-1 = none) */
export const searchMatchIndexAtom = atom<number>(-1);

/** Search error message (null = no error) */
export const searchErrorAtom = atom<string | null>(null);

/** Search history entries */
export interface SearchHistoryEntry {
  query: string;
  resultCount: number;
  timestamp: number;
}
export const searchHistoryAtom = atom<SearchHistoryEntry[]>([]);
