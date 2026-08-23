import type { AnimeFormat } from '../../../types';
import { AnimeDetails, IntegrationAnimePart, IntegrationMangaPart, MangaDetails, SearchResult } from '../types';
import {
    JsonFetcher,
    asObject,
    getArray,
    getObject,
    getString,
    mapAnimeFormat,
    mapStringList,
    stripHtml,
} from './common';

interface JikanSearchOptions {
    page?: number;
    pageSize?: number;
}

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';
const SHIKIMORI_GRAPHQL_URL = 'https://shikimori.net/api/graphql';
const JIKAN_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'LOREBASE/2.0 (Obsidian plugin; metadata search)',
};

function withHasNext<T>(items: T[], hasNext: boolean): T[] {
    Object.defineProperty(items, 'hasNext', {
        value: hasNext,
        enumerable: false,
        configurable: true,
    });
    return items;
}

export async function searchJikan(
    fetchJson: JsonFetcher,
    query: string,
    options: JikanSearchOptions = {}
): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(25, Math.max(1, options.pageSize ?? 10));
    const url = new URL(`${JIKAN_BASE_URL}/anime`);
    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('sfw', 'true');

    let root: Record<string, unknown> | null = null;
    try {
        root = asObject(await fetchJson(url.toString(), JIKAN_HEADERS));
    } catch {
        return searchJikanViaShikimori(fetchJson, normalizedQuery, page, pageSize);
    }
    const results = getArray(root, 'data');
    if (!results.length) {
        return searchJikanViaShikimori(fetchJson, normalizedQuery, page, pageSize);
    }
    const mapped = results.map((entry) => {
        const item = asObject(entry);
        const image = getJikanImage(item);
        const title = getJikanTitle(item);
        const originalTitle = getString(item, 'title');
        return {
            id: getString(item, 'mal_id'),
            title,
            subtitle: originalTitle && originalTitle !== title ? originalTitle : getString(item, 'title_japanese'),
            provider: 'jikan' as const,
            image,
            year: getJikanYear(item),
            format: mapAnimeFormat(getString(item, 'type')),
        };
    }).filter((item) => item.id && item.title);

    const pagination = getObject(root, 'pagination');
    return withHasNext(mapped, Boolean(pagination?.has_next_page));
}

async function searchJikanViaShikimori(
    fetchJson: JsonFetcher,
    query: string,
    page: number,
    pageSize: number
): Promise<SearchResult[]> {
    const gql = `query ($search: String!, $limit: Int!, $page: Int!) {
  animes(search: $search, limit: $limit, page: $page) {
    id
    malId
    name
    russian
    kind
    airedOn {
      year
    }
    poster {
      originalUrl
      mainUrl
    }
  }
}`;
    const root = asObject(await fetchJson(
        SHIKIMORI_GRAPHQL_URL,
        { ...JIKAN_HEADERS, 'Content-Type': 'application/json' },
        'POST',
        JSON.stringify({
            query: gql,
            variables: { search: query, limit: pageSize, page },
        })
    ));
    const data = getObject(root, 'data');
    const results = getArray(data, 'animes');
    const mapped = results.map((entry) => {
        const item = asObject(entry);
        const malId = getString(item, 'malId') || getString(item, 'id');
        const title = getString(item, 'name') || getString(item, 'russian') || 'Unknown';
        const russian = getString(item, 'russian');
        return {
            id: malId,
            title,
            subtitle: russian && russian !== title ? russian : '',
            provider: 'jikan' as const,
            image: getShikimoriImage(item),
            year: getString(getObject(item, 'airedOn'), 'year'),
            format: mapAnimeFormat(getString(item, 'kind')),
            sortScore: getFallbackSearchScore(title, russian, query),
        };
    }).filter((item) => item.id && item.title)
        .sort((a, b) => b.sortScore - a.sortScore)
        .map(({ sortScore: _sortScore, ...item }) => item);

    return withHasNext(mapped, results.length >= pageSize);
}

export async function getJikanDetails(
    fetchJson: JsonFetcher,
    id: string,
    options: { includeParts?: boolean } = {}
): Promise<AnimeDetails | null> {
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) return null;

    const root = asObject(await fetchJson(
        `${JIKAN_BASE_URL}/anime/${numericId}/full`,
        JIKAN_HEADERS
    ));
    const item = getObject(root, 'data');
    if (!item) return null;

    const tags = [
        ...mapStringList(getArray(item, 'genres'), getNamedEntry),
        ...mapStringList(getArray(item, 'explicit_genres'), getNamedEntry),
        ...mapStringList(getArray(item, 'themes'), getNamedEntry),
        ...mapStringList(getArray(item, 'demographics'), getNamedEntry),
    ];
    const studios = mapStringList(getArray(item, 'studios'), getNamedEntry);
    const score = getString(item, 'score');
    const image = getJikanImage(item);
    const parts = options.includeParts === false ? [] : [buildJikanRootPart(item, numericId)];

    return {
        kind: 'anime',
        name: getJikanTitle(item),
        description: stripHtml(getString(item, 'synopsis')),
        image,
        imageHorizontal: image,
        tags: Array.from(new Set(tags)),
        studios,
        year: getJikanYear(item),
        imdbRating: score,
        communityRating: score,
        communityVotes: getString(item, 'scored_by'),
        url: getString(item, 'url') || `https://myanimelist.net/anime/${numericId}`,
        format: mapAnimeFormat(getString(item, 'type')),
        parts,
    };
}

/**
 * Loads metadata for manga notes created by Lorebase versions where Jikan was
 * a manga provider. It is intentionally details-only: new manga searches use
 * AniList, Shikimori, MangaUpdates, or MangaDex, while existing MAL ids remain
 * refreshable until the user explicitly relinks the note.
 */
export async function getLegacyJikanMangaDetails(
    fetchJson: JsonFetcher,
    id: string
): Promise<MangaDetails | null> {
    const numericId = Number.parseInt(id, 10);
    if (!Number.isFinite(numericId)) return null;

    const root = asObject(await fetchJson(
        `${JIKAN_BASE_URL}/manga/${numericId}`,
        JIKAN_HEADERS
    ));
    const item = getObject(root, 'data');
    if (!item) return null;

    const contributors = getArray(item, 'authors').map(asObject);
    const authors = mapStringList(contributors, getNamedEntry);
    const artists = mapStringList(
        contributors.filter((entry) => getString(entry, 'type').toLowerCase().includes('art')),
        getNamedEntry
    );
    const genres = [
        ...mapStringList(getArray(item, 'genres'), getNamedEntry),
        ...mapStringList(getArray(item, 'explicit_genres'), getNamedEntry),
        ...mapStringList(getArray(item, 'themes'), getNamedEntry),
        ...mapStringList(getArray(item, 'demographics'), getNamedEntry),
    ];
    const score = getString(item, 'score');
    const image = getJikanImage(item);

    return {
        kind: 'manga',
        name: getJikanTitle(item),
        description: stripHtml(getString(item, 'synopsis')),
        poster: image,
        posterHorizontal: image,
        authors,
        artists,
        genres: Array.from(new Set(genres)),
        year: getJikanYear(item),
        chapters: getString(item, 'chapters'),
        volumes: getString(item, 'volumes'),
        rating: score,
        communityRating: score,
        communityVotes: getString(item, 'scored_by'),
        url: getString(item, 'url') || `https://myanimelist.net/manga/${numericId}`,
        parts: buildLegacyJikanMangaParts(item),
    };
}

function buildLegacyJikanMangaParts(item: Record<string, unknown>): IntegrationMangaPart[] {
    const volumes = getNumber(item, 'volumes');
    if (!volumes || volumes <= 0) return [];
    const chapters = getNumber(item, 'chapters');
    const chaptersPerVolume = chapters && chapters > 0 ? Math.ceil(chapters / volumes) : null;
    return Array.from({ length: Math.min(volumes, 200) }, (_, index) => ({
        id: `volume-${index + 1}`,
        kind: 'volume',
        title: `Volume ${index + 1}`,
        volumeNumber: index + 1,
        chapterCurrent: 0,
        chapterTotal: chaptersPerVolume,
        status: 'planned',
    }));
}

function buildJikanRootPart(item: Record<string, unknown>, id: number): IntegrationAnimePart {
    const kind = mapJikanKind(getString(item, 'type'));
    return {
        id: `jikan-${id}`,
        kind,
        title: getJikanTitle(item),
        seasonNumber: kind === 'tv' ? 1 : null,
        episodeCurrent: 0,
        episodeTotal: getNumber(item, 'episodes'),
        status: 'planned',
    };
}

function getNamedEntry(entry: unknown): string {
    return getString(asObject(entry), 'name');
}

function getJikanTitle(item: Record<string, unknown> | null): string {
    return getString(item, 'title_english')
        || getString(item, 'title')
        || getString(item, 'title_japanese')
        || 'Unknown';
}

function getJikanImage(item: Record<string, unknown> | null): string {
    const images = getObject(item, 'images');
    const jpg = getObject(images, 'jpg');
    const webp = getObject(images, 'webp');
    return getString(jpg, 'large_image_url')
        || getString(webp, 'large_image_url')
        || getString(jpg, 'image_url')
        || getString(webp, 'image_url');
}

function getShikimoriImage(item: Record<string, unknown> | null): string {
    const poster = getObject(item, 'poster');
    const path = getString(poster, 'originalUrl') || getString(poster, 'mainUrl');
    if (!path) return '';
    if (path.startsWith('//')) return `https:${path}`;
    if (/^https?:\/\//i.test(path)) return path;
    return `https://shikimori.net${path.startsWith('/') ? '' : '/'}${path}`;
}

function getFallbackSearchScore(title: string, alternateTitle: string, query: string): number {
    const normalizedQuery = query.trim().toLowerCase();
    const candidates = [title, alternateTitle].map((value) => value.trim().toLowerCase()).filter(Boolean);
    let score = 0;
    for (const candidate of candidates) {
        if (candidate === normalizedQuery) score = Math.max(score, 100);
        else if (candidate.startsWith(normalizedQuery)) score = Math.max(score, 60);
        else if (candidate.includes(normalizedQuery)) score = Math.max(score, 30);
    }
    return score - (title.length / 1_000);
}

function getJikanYear(item: Record<string, unknown> | null): string {
    const year = getString(item, 'year');
    if (year) return year;
    const published = getObject(item, 'published');
    const publishedFrom = getString(published, 'from');
    if (publishedFrom) return publishedFrom.slice(0, 4);
    const aired = getObject(item, 'aired');
    const from = getString(aired, 'from');
    return from ? from.slice(0, 4) : '';
}

function mapJikanKind(format: string): AnimeFormat {
    const value = format.toLowerCase();
    if (value === 'movie') return 'movie';
    if (value === 'ova') return 'ova';
    if (value === 'ona') return 'ona';
    if (value === 'special' || value === 'music') return 'special';
    return 'tv';
}

function getNumber(source: Record<string, unknown> | null, key: string): number | null {
    if (!source) return null;
    const value = source[key];
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
}
