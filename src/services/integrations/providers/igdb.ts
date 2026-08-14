import type { GameDlc } from '../../../types';
import { GameDetails, SearchResult } from '../types';
import { JsonFetcher, asObject, getArray, getString, mapStringList, stripHtml, toStringSafe } from './common';

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_GAMES_URL = 'https://api.igdb.com/v4/games';
const IGDB_EXTERNAL_GAMES_URL = 'https://api.igdb.com/v4/external_games';
// `external_game_source` 1 is Steam. IGDB retired the older `external_games.category`
// field: the query parser still accepts it, but it matches zero rows, so a stale
// filter fails silently with an empty result rather than an error.
const IGDB_EXTERNAL_GAME_SOURCE_STEAM = 1;
const IGDB_MAX_LIMIT = 500;
// Kept below IGDB_MAX_LIMIT on purpose. One appid normally maps to a single
// external_games row, but asking for exactly `limit` rows leaves no headroom: if
// any appid ever returned two rows, the overflow would be dropped silently with
// no error, and those games would lose their series.
const IGDB_EXTERNAL_GAMES_CHUNK = 400;

interface SearchPageOptions {
    page?: number;
    pageSize?: number;
}

function withHasNext<T>(items: T[], hasNext: boolean): T[] {
    Object.defineProperty(items, 'hasNext', {
        value: hasNext,
        enumerable: false,
        configurable: true,
    });
    return items;
}

function getNumber(source: Record<string, unknown> | null, key: string): number | null {
    if (!source) return null;
    const value = source[key];
    return typeof value === 'number' ? value : null;
}

function formatVoteCount(value: number | null): string {
    return value === null ? '' : String(Math.max(0, Math.trunc(value)));
}

function mapIgdbDlc(rawItems: unknown[]): GameDlc[] {
    const seen = new Set<string>();
    const mapped: GameDlc[] = [];

    for (const raw of rawItems) {
        const item = asObject(raw);
        if (!item) continue;
        const id = getString(item, 'id');
        const title = getString(item, 'name');
        if (!id || !title || seen.has(id)) continue;
        seen.add(id);

        const cover = asObject(item.cover);
        const websites = getArray(item, 'websites');
        const firstWebsiteUrl = getString(asObject(websites[0]), 'url');
        mapped.push({
            id,
            provider: 'igdb',
            title,
            imageUrl: getIgdbImageUrl(getString(cover, 'image_id'), 'cover_big_2x') || null,
            url: firstWebsiteUrl || `https://www.igdb.com/games/${id}`,
            userRating: null,
        });
    }

    return mapped;
}

function formatDate(timestamp: number | null): string {
    if (!timestamp) return '';
    return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function getYear(timestamp: number | null): string {
    if (!timestamp) return '';
    return new Date(timestamp * 1000).getUTCFullYear().toString();
}

function getIgdbImageUrl(imageId: string, size: 'cover_big_2x' | 'screenshot_huge'): string {
    return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : '';
}

function escapeIgdbString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function getAccessToken(fetchJson: JsonFetcher, clientId: string, clientSecret: string): Promise<string> {
    const params = new URLSearchParams();
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    params.set('grant_type', 'client_credentials');

    const token = asObject(await fetchJson(
        TWITCH_TOKEN_URL,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        'POST',
        params.toString()
    ));

    return getString(token, 'access_token');
}

async function fetchIgdbEndpoint(
    fetchJson: JsonFetcher,
    url: string,
    clientId: string,
    clientSecret: string,
    body: string
): Promise<unknown[]> {
    const token = await getAccessToken(fetchJson, clientId, clientSecret);
    if (!token) return [];

    const result: unknown = await fetchJson(
        url,
        {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Client-ID': clientId,
            'Content-Type': 'text/plain',
        },
        'POST',
        body
    );

    return Array.isArray(result) ? (result as unknown[]) : [];
}

function fetchIgdbGames(
    fetchJson: JsonFetcher,
    clientId: string,
    clientSecret: string,
    body: string
): Promise<unknown[]> {
    return fetchIgdbEndpoint(fetchJson, IGDB_GAMES_URL, clientId, clientSecret, body);
}

/**
 * IGDB exposes the specific series as `collections` and the broader IP as
 * `franchises`. The singular `collection`/`franchise` fields are still accepted
 * by the API but always return empty. Prefer the specific series, fall back to
 * the franchise.
 */
function pickGameSeries(game: Record<string, unknown> | null): string {
    return getString(asObject(getArray(game, 'collections')[0]), 'name')
        || getString(asObject(getArray(game, 'franchises')[0]), 'name');
}

export async function searchIgdb(
    fetchJson: JsonFetcher,
    query: string,
    clientId: string,
    clientSecret: string,
    options: SearchPageOptions = {}
): Promise<SearchResult[]> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, options.pageSize ?? 10);
    const body = [
        'fields name,first_release_date,cover.image_id;',
        `search "${escapeIgdbString(query)}";`,
        'where version_parent = null;',
        `limit ${pageSize + 1};`,
        `offset ${(page - 1) * pageSize};`,
    ].join('\n');

    const results = await fetchIgdbGames(fetchJson, clientId, clientSecret, body);
    const hasNext = results.length > pageSize;

    const mapped = results.slice(0, pageSize).map((item) => {
        const record = asObject(item);
        const released = getNumber(record, 'first_release_date');
        const cover = asObject(record?.cover);
        const year = getYear(released);

        return {
            id: getString(record, 'id'),
            title: getString(record, 'name') || 'Unknown',
            subtitle: year,
            year,
            image: getIgdbImageUrl(getString(cover, 'image_id'), 'cover_big_2x'),
            provider: 'igdb' as const,
        };
    });

    return withHasNext(mapped, hasNext);
}

export async function getIgdbDetails(
    fetchJson: JsonFetcher,
    id: string,
    clientId: string,
    clientSecret: string
): Promise<GameDetails | null> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;

    const body = [
        'fields name,summary,storyline,first_release_date,total_rating,total_rating_count,aggregated_rating,aggregated_rating_count,rating,rating_count,',
        'cover.image_id,screenshots.image_id,genres.name,platforms.name,',
        'collections.name,franchises.name,',
        'involved_companies.developer,involved_companies.publisher,involved_companies.company.name,websites.url;',
        `where id = ${numericId};`,
        'limit 1;',
    ].join('\n');

    const [rawItem] = await fetchIgdbGames(fetchJson, clientId, clientSecret, body);
    const item = asObject(rawItem);
    if (!item) return null;

    const released = getNumber(item, 'first_release_date');
    const involvedCompanies = getArray(item, 'involved_companies');
    const developers = mapStringList(
        involvedCompanies.filter((entry) => Boolean(asObject(entry)?.developer)),
        (entry) => getString(asObject(asObject(entry)?.company), 'name')
    );
    const publishers = mapStringList(
        involvedCompanies.filter((entry) => Boolean(asObject(entry)?.publisher)),
        (entry) => getString(asObject(asObject(entry)?.company), 'name')
    );
    const cover = asObject(item.cover);
    const screenshots = getArray(item, 'screenshots');
    const firstScreenshot = asObject(screenshots[0]);
    const websites = getArray(item, 'websites');
    const firstWebsiteUrl = getString(asObject(websites[0]), 'url');
    const gameSeries = pickGameSeries(item);

    return {
        kind: 'game',
        name: getString(item, 'name') || 'Unknown',
        description: stripHtml(getString(item, 'summary') || getString(item, 'storyline')),
        poster: getIgdbImageUrl(getString(cover, 'image_id'), 'cover_big_2x'),
        posterHorizontal: getIgdbImageUrl(getString(firstScreenshot, 'image_id'), 'screenshot_huge'),
        genres: mapStringList(getArray(item, 'genres'), (entry) => getString(asObject(entry), 'name')),
        platforms: mapStringList(getArray(item, 'platforms'), (entry) => getString(asObject(entry), 'name')),
        developers,
        publishers,
        gameSeries,
        rating: toStringSafe(item.total_rating || item.rating),
        metacritic: toStringSafe(item.aggregated_rating),
        released: formatDate(released),
        year: getYear(released),
        url: firstWebsiteUrl || `https://www.igdb.com/games/${id}`,
        communityRating: toStringSafe(item.total_rating || item.rating),
        communityVotes: formatVoteCount(
            getNumber(item, 'total_rating_count')
            ?? getNumber(item, 'rating_count')
            ?? getNumber(item, 'aggregated_rating_count')
        ),
    };
}

export interface IgdbSeriesLookupOptions {
    /**
     * Called when a single chunk fails. The remaining chunks still run, so this
     * reports a partial result rather than an aborted lookup.
     */
    onChunkFailure?: (error: unknown) => void;
    /**
     * Awaited before each chunk, so a long multi-chunk lookup can be paused or
     * stopped. Returning false stops early and keeps what was resolved so far.
     */
    beforeChunk?: () => Promise<boolean> | boolean;
}

/**
 * Resolves Steam appids to their series names via IGDB's `external_games`
 * mapping, which links a Steam appid to an IGDB game exactly (no name matching).
 *
 * Steam itself has no usable series data: the storefront API omits the field
 * entirely, and the store page's "Franchise:" row is publisher-authored and
 * missing for roughly half of all games. Batching keeps a whole library to one
 * request per 500 appids.
 *
 * Games with no collection and no franchise are left out of the map, so callers
 * can distinguish "IGDB has no series" from "not looked up".
 */
export async function getIgdbSeriesBySteamAppIds(
    fetchJson: JsonFetcher,
    appIds: string[],
    clientId: string,
    clientSecret: string,
    options: IgdbSeriesLookupOptions = {}
): Promise<Map<string, string>> {
    const series = new Map<string, string>();
    const uniqueIds = Array.from(new Set(appIds.map((appId) => appId.trim()).filter(Boolean)));
    if (!uniqueIds.length) return series;

    for (let offset = 0; offset < uniqueIds.length; offset += IGDB_EXTERNAL_GAMES_CHUNK) {
        if (options.beforeChunk && (await options.beforeChunk()) === false) break;

        const chunk = uniqueIds.slice(offset, offset + IGDB_EXTERNAL_GAMES_CHUNK);
        const uidList = chunk.map((appId) => `"${escapeIgdbString(appId)}"`).join(',');
        const body = [
            'fields uid,game.collections.name,game.franchises.name;',
            `where uid = (${uidList}) & external_game_source = ${IGDB_EXTERNAL_GAME_SOURCE_STEAM};`,
            `limit ${IGDB_MAX_LIMIT};`,
        ].join('\n');

        let rows: unknown[];
        try {
            rows = await fetchIgdbEndpoint(fetchJson, IGDB_EXTERNAL_GAMES_URL, clientId, clientSecret, body);
        } catch (error) {
            // Keep the series already resolved by earlier chunks. Throwing here
            // would discard every successful chunk along with the failed one.
            options.onChunkFailure?.(error);
            continue;
        }

        for (const row of rows) {
            const record = asObject(row);
            const uid = getString(record, 'uid');
            const name = pickGameSeries(asObject(record?.game));
            if (uid && name) series.set(uid, name);
        }
    }

    return series;
}

export async function getIgdbDlcForGame(
    fetchJson: JsonFetcher,
    id: string,
    clientId: string,
    clientSecret: string
): Promise<GameDlc[]> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return [];

    const body = [
        'fields dlcs.id,dlcs.name,dlcs.cover.image_id,dlcs.websites.url,',
        'expansions.id,expansions.name,expansions.cover.image_id,expansions.websites.url;',
        `where id = ${numericId};`,
        'limit 1;',
    ].join('\n');

    const [rawItem] = await fetchIgdbGames(fetchJson, clientId, clientSecret, body);
    const item = asObject(rawItem);
    if (!item) return [];

    return mapIgdbDlc([
        ...getArray(item, 'dlcs'),
        ...getArray(item, 'expansions'),
    ]);
}
