import { describe, expect, it } from 'vitest';
import {
    getIgdbDetails,
    getIgdbDlcForGame,
    getIgdbSeriesBySteamAppIds,
    searchIgdb,
} from '../src/services/integrations/providers/igdb';
import type { JsonFetcher } from '../src/services/integrations/providers/common';

describe('IGDB provider', () => {
    it('authenticates with Twitch and maps paged search results', async () => {
        const calls: Array<{ url: string; headers?: Record<string, string>; method?: string; body?: string }> = [];
        const fetchJson: JsonFetcher = async (url, headers, method, body) => {
            calls.push({ url, headers, method, body });
            if (url.includes('oauth2/token')) return { access_token: 'token-123' };
            return [
                { id: 1, name: 'Portal', first_release_date: 1193356800, cover: { image_id: 'portal' } },
                { id: 2, name: 'Portal 2', first_release_date: 1303430400, cover: { image_id: 'portal-2' } },
                { id: 3, name: 'Extra page item' },
            ];
        };

        const results = await searchIgdb(fetchJson, 'Portal "Test"', 'client-id', 'client-secret', { page: 2, pageSize: 2 });

        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({ method: 'POST' });
        expect(calls[0].body).toContain('client_id=client-id');
        expect(calls[0].body).toContain('client_secret=client-secret');
        expect(calls[1].headers).toMatchObject({
            Authorization: 'Bearer token-123',
            'Client-ID': 'client-id',
        });
        expect(calls[1].body).toContain('search "Portal \\"Test\\"";');
        expect(calls[1].body).toContain('limit 3;');
        expect(calls[1].body).toContain('offset 2;');
        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({
            id: '1',
            title: 'Portal',
            provider: 'igdb',
            year: '2007',
            image: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/portal.jpg',
        });
        expect((results as typeof results & { hasNext?: boolean }).hasNext).toBe(true);
    });

    it('maps details, companies, ratings, and image variants', async () => {
        const fetchJson: JsonFetcher = async (url) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            return [{
                id: 1,
                name: 'Portal',
                summary: '<b>Puzzle</b> game.',
                first_release_date: 1193356800,
                total_rating: 90.5,
                total_rating_count: 12345,
                aggregated_rating: 88,
                cover: { image_id: 'cover-id' },
                screenshots: [{ image_id: 'screen-id' }],
                genres: [{ name: 'Puzzle' }],
                platforms: [{ name: 'PC' }],
                involved_companies: [
                    { developer: true, company: { name: 'Valve' } },
                    { publisher: true, company: { name: 'Electronic Arts' } },
                ],
                websites: [{ url: 'https://example.com/portal' }],
                collections: [{ name: 'Portal' }],
                franchises: [{ name: 'Half-Life' }],
            }];
        };

        const details = await getIgdbDetails(fetchJson, '1', 'client', 'secret');

        expect(details).toMatchObject({
            kind: 'game',
            name: 'Portal',
            gameSeries: 'Portal',
            description: 'Puzzle game.',
            poster: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cover-id.jpg',
            posterHorizontal: 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/screen-id.jpg',
            genres: ['Puzzle'],
            platforms: ['PC'],
            developers: ['Valve'],
            publishers: ['Electronic Arts'],
            communityRating: '90.5',
            communityVotes: '12345',
            metacritic: '88',
            released: '2007-10-26',
            url: 'https://example.com/portal',
        });
    });

    it('requests the plural series fields and falls back to franchise', async () => {
        // IGDB accepts the singular `collection`/`franchise` fields but always
        // returns them empty, so the query must use the plural forms.
        const bodies: string[] = [];
        const fetchJson: JsonFetcher = async (url, _headers, _method, body) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            bodies.push(body ?? '');
            return [{
                id: 1,
                name: 'Fallout Tactics',
                franchises: [{ name: 'Fallout' }],
            }];
        };

        const details = await getIgdbDetails(fetchJson, '1', 'client', 'secret');

        expect(bodies[0]).toContain('collections.name');
        expect(bodies[0]).toContain('franchises.name');
        expect(details).toMatchObject({ gameSeries: 'Fallout' });
    });

    it('leaves gameSeries empty when neither collection nor franchise exists', async () => {
        const fetchJson: JsonFetcher = async (url) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            return [{ id: 1, name: 'Standalone Game' }];
        };

        const details = await getIgdbDetails(fetchJson, '1', 'client', 'secret');

        expect(details?.gameSeries).toBe('');
    });

    it('combines and deduplicates DLC and expansion records', async () => {
        const fetchJson: JsonFetcher = async (url) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            return [{
                dlcs: [
                    { id: 10, name: 'Episode One', cover: { image_id: 'ep1' } },
                ],
                expansions: [
                    { id: 10, name: 'Duplicate Episode One' },
                    { id: 11, name: 'Episode Two', websites: [{ url: 'https://example.com/ep2' }] },
                ],
            }];
        };

        const dlc = await getIgdbDlcForGame(fetchJson, '1', 'client', 'secret');

        expect(dlc).toHaveLength(2);
        expect(dlc[0]).toMatchObject({ id: '10', provider: 'igdb', title: 'Episode One' });
        expect(dlc[1]).toMatchObject({ id: '11', url: 'https://example.com/ep2' });
    });
});

/**
 * Steam's own store data has no usable series field: the storefront API omits it
 * entirely and the store page's "Franchise:" row is publisher-authored marketing
 * copy that is missing for roughly half of all games. IGDB's `external_games`
 * endpoint maps a Steam appid to an IGDB game exactly, so Steam Sync resolves the
 * series there instead, batching the whole library into one request.
 */
describe('IGDB Steam appid series lookup', () => {
    interface Recorder {
        fetchJson: JsonFetcher;
        urls: string[];
        bodies: string[];
    }

    const recordFetch = (rows: unknown[] | ((body: string) => unknown[])): Recorder => {
        const urls: string[] = [];
        const bodies: string[] = [];
        const fetchJson: JsonFetcher = async (url, _headers, _method, body) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            urls.push(url);
            bodies.push(body ?? '');
            return typeof rows === 'function' ? rows(body ?? '') : rows;
        };
        return { fetchJson, urls, bodies };
    };

    it('maps Steam appids to their series in a single batched request', async () => {
        const { fetchJson, urls, bodies } = recordFetch([
            { uid: '220', game: { name: 'Half-Life 2', collections: [{ name: 'Half-Life' }] } },
            { uid: '620', game: { name: 'Portal 2', collections: [{ name: 'Portal' }] } },
        ]);

        const series = await getIgdbSeriesBySteamAppIds(fetchJson, ['220', '620'], 'client', 'secret');

        expect(urls).toEqual(['https://api.igdb.com/v4/external_games']);
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).toContain('"220"');
        expect(bodies[0]).toContain('"620"');
        expect(series.get('220')).toBe('Half-Life');
        expect(series.get('620')).toBe('Portal');
    });

    it('filters on external_game_source rather than the retired category field', async () => {
        // IGDB replaced `external_games.category` with `external_game_source`.
        // The old field is still accepted by the query parser but always matches
        // zero rows, so a stale filter fails silently with an empty result.
        const { fetchJson, bodies } = recordFetch([]);

        await getIgdbSeriesBySteamAppIds(fetchJson, ['220'], 'client', 'secret');

        expect(bodies[0]).toContain('external_game_source = 1');
        expect(bodies[0]).not.toContain('category');
        expect(bodies[0]).toContain('game.collections.name');
        expect(bodies[0]).toContain('game.franchises.name');
    });

    it('falls back to the franchise when the game has no collection', async () => {
        const { fetchJson } = recordFetch([
            { uid: '377160', game: { name: 'Fallout 4', franchises: [{ name: 'Fallout' }] } },
        ]);

        const series = await getIgdbSeriesBySteamAppIds(fetchJson, ['377160'], 'client', 'secret');

        expect(series.get('377160')).toBe('Fallout');
    });

    it('prefers the specific collection over the broader franchise', async () => {
        const { fetchJson } = recordFetch([
            {
                uid: '400',
                game: {
                    name: 'Portal',
                    collections: [{ name: 'Portal' }],
                    franchises: [{ name: 'Half-Life' }],
                },
            },
        ]);

        const series = await getIgdbSeriesBySteamAppIds(fetchJson, ['400'], 'client', 'secret');

        expect(series.get('400')).toBe('Portal');
    });

    it('omits standalone games that have neither a collection nor a franchise', async () => {
        // Stardew Valley resolves to an IGDB game but genuinely belongs to no
        // series. It must be absent from the map, not present with an empty
        // string, so callers can tell "no series" from "not looked up".
        const { fetchJson } = recordFetch([
            { uid: '413150', game: { name: 'Stardew Valley' } },
        ]);

        const series = await getIgdbSeriesBySteamAppIds(fetchJson, ['413150'], 'client', 'secret');

        expect(series.has('413150')).toBe(false);
        expect(series.size).toBe(0);
    });

    const echoSeriesForRequestedIds = (body: string): unknown[] => {
        const uids = body.match(/"(\d+)"/g) ?? [];
        return uids.map((quoted) => {
            const uid = quoted.replace(/"/g, '');
            return { uid, game: { name: `Game ${uid}`, collections: [{ name: `Series ${uid}` }] } };
        });
    };

    it('chunks below the row limit so a doubled row cannot silently truncate', async () => {
        // The chunk size is deliberately smaller than `limit 500`. Requesting
        // exactly `limit` ids leaves no headroom: one appid returning two rows
        // would push the last row past the limit and drop it with no error.
        const { fetchJson, bodies } = recordFetch(echoSeriesForRequestedIds);

        const series = await getIgdbSeriesBySteamAppIds(
            fetchJson,
            Array.from({ length: 401 }, (_, index) => String(index + 1)),
            'client',
            'secret'
        );

        expect(bodies).toHaveLength(2);
        expect(bodies[0]).toContain('limit 500;');
        expect((bodies[0].match(/"\d+"/g) ?? []).length).toBeLessThan(500);
        expect(series.size).toBe(401);
        expect(series.get('1')).toBe('Series 1');
        expect(series.get('401')).toBe('Series 401');
    });

    it('keeps series from earlier chunks when a later chunk fails', async () => {
        // A throw used to escape the whole function, discarding every chunk that
        // had already succeeded rather than just the one that failed.
        let call = 0;
        const failures: unknown[] = [];
        const fetchJson: JsonFetcher = async (url, _headers, _method, body) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            call++;
            if (call === 2) throw new Error('Request failed, status 503');
            return echoSeriesForRequestedIds(body ?? '');
        };

        const series = await getIgdbSeriesBySteamAppIds(
            fetchJson,
            Array.from({ length: 801 }, (_, index) => String(index + 1)),
            'client',
            'secret',
            { onChunkFailure: (error) => failures.push(error) }
        );

        expect(failures).toHaveLength(1);
        // First chunk survived, second was lost, third still ran.
        expect(series.get('1')).toBe('Series 1');
        expect(series.has('500')).toBe(false);
        expect(series.get('801')).toBe('Series 801');
    });

    it('stops between chunks when beforeChunk returns false', async () => {
        const { fetchJson, bodies } = recordFetch(echoSeriesForRequestedIds);
        let chunk = 0;

        const series = await getIgdbSeriesBySteamAppIds(
            fetchJson,
            Array.from({ length: 1201 }, (_, index) => String(index + 1)),
            'client',
            'secret',
            { beforeChunk: () => ++chunk <= 1 }
        );

        expect(bodies).toHaveLength(1);
        // What was already resolved is kept rather than thrown away.
        expect(series.get('1')).toBe('Series 1');
    });

    it('makes no request when there are no appids to look up', async () => {
        const { fetchJson, urls } = recordFetch([]);

        const series = await getIgdbSeriesBySteamAppIds(fetchJson, [], 'client', 'secret');

        expect(urls).toEqual([]);
        expect(series.size).toBe(0);
    });
});
