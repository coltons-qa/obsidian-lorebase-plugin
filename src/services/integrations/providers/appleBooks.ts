import { JsonFetcher, asObject, asArray, getString } from './common';

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

export interface AppleBooksCoverResult {
    trackId: number;
    trackName: string;
    artistName: string;
    /** Max-resolution cover URL (10000x10000, Apple CDN returns actual max) */
    coverUrl: string;
    /** 300px thumbnail for grid display */
    thumbnailUrl: string;
}

/**
 * Search Apple Books for cover images matching a book title and author.
 *
 * Uses the iTunes Search API (no auth required). Matching strategy from Calibre:
 * 1. Search by title tokens
 * 2. Filter results by title + author token matching
 * 3. If no matches, retry with combined title + author query
 */
export async function searchAppleBookCovers(
    fetchJson: JsonFetcher,
    title: string,
    author: string,
    options?: { limit?: number }
): Promise<AppleBooksCoverResult[]> {
    const limit = options?.limit ?? 10;
    const strippedTitle = stripSubtitle(title);
    const titleTokens = tokenize(strippedTitle);
    if (!titleTokens.length) return [];
    const authorTokens = author ? tokenize(author) : [];

    // First search: title only
    let results = await fetchItunesEbooks(fetchJson, strippedTitle, limit);
    let filtered = filterResults(results, titleTokens, authorTokens);

    // Fallback: title + author combined
    if (filtered.length === 0 && author) {
        results = await fetchItunesEbooks(fetchJson, `${strippedTitle} ${author}`, limit);
        filtered = filterResults(results, titleTokens, authorTokens);
    }

    return filtered.map(mapToResult).filter((r): r is AppleBooksCoverResult => r !== null);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchItunesEbooks(
    fetchJson: JsonFetcher,
    term: string,
    limit: number
): Promise<Record<string, unknown>[]> {
    const url = new URL(ITUNES_SEARCH_URL);
    url.searchParams.set('term', term);
    url.searchParams.set('entity', 'ebook');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('version', '2');
    url.searchParams.set('country', 'US');

    const root = asObject(await fetchJson(url.toString(), {
        'Accept': 'application/json',
    }));
    if (!root) return [];
    return asArray(root.results)
        .map((entry) => asObject(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function filterResults(
    results: Record<string, unknown>[],
    titleTokens: string[],
    authorTokens: string[]
): Record<string, unknown>[] {
    return results.filter((r) => {
        const name = getString(r, 'trackName');
        const artist = getString(r, 'artistName');
        return matchesTokens(name, titleTokens)
            && (authorTokens.length === 0 || matchesTokens(artist, authorTokens));
    });
}

function mapToResult(raw: Record<string, unknown>): AppleBooksCoverResult | null {
    const artworkUrl = getString(raw, 'artworkUrl100');
    if (!artworkUrl) return null;
    const trackId = typeof raw.trackId === 'number' ? raw.trackId : 0;
    return {
        trackId,
        trackName: getString(raw, 'trackName'),
        artistName: getString(raw, 'artistName'),
        coverUrl: toResizedUrl(artworkUrl, 10000),
        thumbnailUrl: toResizedUrl(artworkUrl, 300),
    };
}

/** Replace the size component of an iTunes artwork URL. */
function toResizedUrl(artworkUrl100: string, size: number): string {
    const lastSlash = artworkUrl100.lastIndexOf('/');
    if (lastSlash < 0) return artworkUrl100;
    return `${artworkUrl100.substring(0, lastSlash)}/${size}x${size}bb.jpg`;
}

/**
 * Strip subtitle from a book title (everything after the first `:`, `—`, or ` - `).
 * "Project Hail Mary: A Novel" → "Project Hail Mary"
 */
function stripSubtitle(title: string): string {
    return title.split(/[:—–]|( - )/)[0].trim();
}

/** Tokenize a string into lowercase words, stripping punctuation. */
function tokenize(str: string): string[] {
    return str.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
}

/** Check that every token appears as a substring in the text (case-insensitive, punctuation-stripped). */
function matchesTokens(text: string, tokens: string[]): boolean {
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, '');
    return tokens.every((token) => normalized.includes(token));
}
