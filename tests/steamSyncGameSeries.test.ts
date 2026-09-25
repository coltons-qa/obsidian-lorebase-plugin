import { beforeEach, describe, expect, it } from 'vitest';
import { TFile, TFolder, __setRequestUrlMock } from './mocks/obsidian';
import { DEFAULT_SETTINGS } from '../src/constants';
import { SteamSyncService } from '../src/services/SteamSyncService';
import { MetadataService } from '../src/services/MetadataService';
import { resetIntegrationRequestStateForTests } from '../src/services/integrations/shared';
import type { LorebaseSettings } from '../src/types';

/**
 * Steam Sync resolves series from IGDB (see the "IGDB Steam appid series
 * lookup" suite for why Steam's own data is unusable). Three separate hand-listed
 * field maps feed a game note -- buildTemplateValues for new notes,
 * updateExistingGame for re-syncs, and the enrichment map in IntegrationService --
 * so it is easy to wire a new field into one and forget the others.
 */

type CacheEntry = { frontmatter: Record<string, unknown> };
type MockApp = {
    metadataCache: { getFileCache(file: TFile): CacheEntry | null };
    vault: {
        getFiles(): TFile[];
        getAbstractFileByPath(path: string): TFile | TFolder | null;
        create(path: string, content: string): Promise<TFile>;
        createFolder(path: string): Promise<void>;
        created: Record<string, string>;
    };
    fileManager: {
        processFrontMatter(file: TFile, callback: (frontmatter: Record<string, unknown>) => void): Promise<void>;
    };
};

const STEAM_PROFILE_URL = 'https://steamcommunity.com/id/MURcHIIK/';
const TEST_STEAM_ID64 = '76561198445048905';

function createFile(path: string): TFile {
    const name = path.split('/').pop() ?? path;
    const basename = name.replace(/\.md$/, '');
    const file = new TFile(path, basename);
    file.path = path;
    file.name = name;
    file.basename = basename;
    file.extension = 'md';
    return file;
}

function createMockApp(initialFiles: Array<{ path: string; frontmatter: Record<string, unknown> }> = []): MockApp {
    const files = initialFiles.map((entry) => createFile(entry.path));
    const cache = new Map<string, CacheEntry>();
    initialFiles.forEach((entry) => {
        cache.set(entry.path, { frontmatter: { ...entry.frontmatter } });
    });
    const folders = new Set<string>(['Games']);
    const created: Record<string, string> = {};

    return {
        metadataCache: {
            getFileCache(file: TFile): CacheEntry | null {
                return cache.get(file.path) ?? null;
            },
        },
        vault: {
            getFiles: () => files,
            getAbstractFileByPath(path: string): TFile | TFolder | null {
                const file = files.find((entry) => entry.path === path);
                if (file) return file;
                if (folders.has(path)) return new TFolder(path);
                return null;
            },
            async create(path: string, content: string): Promise<TFile> {
                const file = createFile(path);
                files.push(file);
                created[path] = content;
                cache.set(path, { frontmatter: {} });
                return file;
            },
            async createFolder(path: string): Promise<void> {
                folders.add(path);
            },
            created,
        },
        fileManager: {
            async processFrontMatter(file: TFile, callback: (frontmatter: Record<string, unknown>) => void): Promise<void> {
                let entry = cache.get(file.path);
                if (!entry) {
                    entry = { frontmatter: {} };
                    cache.set(file.path, entry);
                }
                callback(entry.frontmatter);
            },
        },
    };
}

function createSteamSyncService(app: MockApp): SteamSyncService {
    const appForService = app as unknown as never;
    return new SteamSyncService(appForService, new MetadataService(appForService));
}

function buildSettings(options: { igdb?: boolean } = {}): LorebaseSettings {
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as LorebaseSettings;
    settings.steamSync.steamId = STEAM_PROFILE_URL;
    settings.steamSync.importWishlist = false;
    settings.steamSync.importOwnedGames = true;
    if (options.igdb ?? true) {
        settings.integrations!.enabled = true;
        settings.integrations!.providers.igdb.enabled = true;
        settings.integrations!.providers.igdb.apiKey = 'client-id';
        settings.integrations!.providers.igdb.clientSecret = 'client-secret';
    } else {
        settings.integrations!.providers.igdb.enabled = false;
        settings.integrations!.providers.igdb.apiKey = '';
        settings.integrations!.providers.igdb.clientSecret = '';
    }
    return settings;
}

interface SteamMockOptions {
    apps: Array<{ appid: number; name: string; playtime_forever?: number }>;
    series?: Record<string, string>;
    igdbFails?: boolean;
    /**
     * Return every known series regardless of which appids were asked for, so a
     * game can end up in the series map even though the prefetch filter would
     * have excluded it. That is what lets a test exercise the write-side guard
     * on its own instead of having the filter mask it.
     */
    igdbReturnsAll?: boolean;
}

function mockSteamAndIgdb(options: SteamMockOptions): { igdbRequests: string[] } {
    const igdbRequests: string[] = [];
    const series = options.series ?? {};

    __setRequestUrlMock((request) => {
        const url = typeof request === 'string' ? request : request.url;
        const body = typeof request === 'string' || typeof request.body !== 'string' ? '' : request.body;

        if (url.includes('steamcommunity.com/id/MURcHIIK')) {
            return { json: {}, text: `<profile><steamID64>${TEST_STEAM_ID64}</steamID64></profile>` };
        }
        if (url.includes('GetOwnedGames')) {
            return { json: { response: { games: options.apps } } };
        }
        if (url.includes('wishlist')) {
            return { json: {} };
        }
        if (url.includes('appdetails')) {
            const appid = new URL(url).searchParams.get('appids') ?? '';
            const app = options.apps.find((entry) => String(entry.appid) === appid);
            return {
                json: {
                    [appid]: {
                        success: true,
                        data: {
                            name: app?.name ?? `App ${appid}`,
                            short_description: `Description ${appid}`,
                            genres: [{ description: 'RPG' }],
                            platforms: { windows: true },
                            developers: ['Dev'],
                            publishers: ['Pub'],
                            release_date: { date: 'Jan 1, 2020' },
                            header_image: `https://cdn.example/${appid}.jpg`,
                        },
                    },
                },
            };
        }
        if (url.includes('oauth2/token')) {
            return { json: { access_token: 'token' } };
        }
        if (url.includes('external_games')) {
            igdbRequests.push(body);
            if (options.igdbFails) throw new Error('Request failed, status 503');
            const rows = Object.entries(series)
                .filter(([uid]) => options.igdbReturnsAll || body.includes(`"${uid}"`))
                .map(([uid, name]) => ({ uid, game: { name: `Game ${uid}`, collections: [{ name }] } }));
            return { json: rows };
        }
        return { json: {} };
    });

    return { igdbRequests };
}

describe('Steam Sync series', () => {
    beforeEach(() => {
        resetIntegrationRequestStateForTests();
        __setRequestUrlMock(null);
    });

    it('writes the IGDB series into a newly created game note', async () => {
        mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2', playtime_forever: 500 }],
            series: { 220: 'Half-Life' },
        });
        const app = createMockApp();
        const service = createSteamSyncService(app);

        const result = await service.sync(buildSettings());

        expect(result).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 });
        expect(app.vault.created['Games/Half-Life 2.md']).toContain('series: "Half-Life"');
    });

    it('looks the whole library up in one batched request', async () => {
        const { igdbRequests } = mockSteamAndIgdb({
            apps: [
                { appid: 220, name: 'Half-Life 2' },
                { appid: 620, name: 'Portal 2' },
                { appid: 413150, name: 'Stardew Valley' },
            ],
            series: { 220: 'Half-Life', 620: 'Portal' },
        });
        const app = createMockApp();
        const service = createSteamSyncService(app);

        await service.sync(buildSettings());

        expect(igdbRequests).toHaveLength(1);
        expect(app.vault.created['Games/Half-Life 2.md']).toContain('series: "Half-Life"');
        expect(app.vault.created['Games/Portal 2.md']).toContain('series: "Portal"');
        expect(app.vault.created['Games/Stardew Valley.md']).toContain('series: ""');
    });

    it('backfills series on a re-sync when the existing note leaves it empty', async () => {
        mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2', playtime_forever: 500 }],
            series: { 220: 'Half-Life' },
        });
        const app = createMockApp([
            { path: 'Games/Half-Life 2.md', frontmatter: { 'steam-app-id': 220, series: '' } },
        ]);
        const settings = buildSettings();
        settings.steamSync.duplicateMode = 'update';
        const service = createSteamSyncService(app);

        const result = await service.sync(settings);
        const frontmatter = app.metadataCache.getFileCache(app.vault.getFiles()[0])?.frontmatter;

        expect(result).toEqual({ created: 0, updated: 1, skipped: 0, failed: 0 });
        expect(frontmatter?.series).toBe('Half-Life');
    });

    it('backfills series when the existing note has no such property at all', async () => {
        mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2', playtime_forever: 500 }],
            series: { 220: 'Half-Life' },
        });
        const app = createMockApp([
            { path: 'Games/Half-Life 2.md', frontmatter: { 'steam-app-id': 220 } },
        ]);
        const settings = buildSettings();
        settings.steamSync.duplicateMode = 'update';
        const service = createSteamSyncService(app);

        await service.sync(settings);

        expect(app.metadataCache.getFileCache(app.vault.getFiles()[0])?.frontmatter.series).toBe('Half-Life');
    });

    it('never overwrites a series the user set by hand', async () => {
        // The whole point of the backfill rule: a re-sync may fill a blank field
        // but must leave a curated value alone, even when IGDB disagrees.
        mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2', playtime_forever: 500 }],
            series: { 220: 'Half-Life' },
        });
        const app = createMockApp([
            { path: 'Games/Half-Life 2.md', frontmatter: { 'steam-app-id': 220, series: 'My Favourites' } },
        ]);
        const settings = buildSettings();
        settings.steamSync.duplicateMode = 'update';
        const service = createSteamSyncService(app);

        await service.sync(settings);

        expect(app.metadataCache.getFileCache(app.vault.getFiles()[0])?.frontmatter.series).toBe('My Favourites');
    });

    it('refuses to overwrite even when a series for that game is already loaded', async () => {
        // Pins the write-side guard on its own. The prefetch filter normally
        // keeps curated games out of the series map entirely, which means the
        // test above passes even if updateExistingGame writes unconditionally.
        // Here the series IS in the map, so only the guard can protect the note.
        mockSteamAndIgdb({
            apps: [
                { appid: 220, name: 'Half-Life 2', playtime_forever: 500 },
                { appid: 620, name: 'Portal 2', playtime_forever: 100 },
            ],
            series: { 220: 'Half-Life', 620: 'Portal' },
            igdbReturnsAll: true,
        });
        const app = createMockApp([
            { path: 'Games/Half-Life 2.md', frontmatter: { 'steam-app-id': 220, series: 'My Favourites' } },
        ]);
        const settings = buildSettings();
        settings.steamSync.duplicateMode = 'update';
        const service = createSteamSyncService(app);

        await service.sync(settings);

        const existing = app.vault.getFiles().find((file) => file.path === 'Games/Half-Life 2.md') as TFile;
        expect(app.metadataCache.getFileCache(existing)?.frontmatter.series).toBe('My Favourites');
        // The game that had nothing still gets filled in.
        expect(app.vault.created['Games/Portal 2.md']).toContain('series: "Portal"');
    });

    it('treats a List-type series as filled rather than empty', async () => {
        // Obsidian's property editor can turn series into a List, making the
        // frontmatter value an array. A string-only emptiness check read that as
        // blank and overwrote the user's list with a plain string.
        mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2', playtime_forever: 500 }],
            series: { 220: 'Half-Life' },
            igdbReturnsAll: true,
        });
        const app = createMockApp([
            { path: 'Games/Half-Life 2.md', frontmatter: { 'steam-app-id': 220, series: ['My Favourites'] } },
        ]);
        const settings = buildSettings();
        settings.steamSync.duplicateMode = 'update';
        const service = createSteamSyncService(app);

        await service.sync(settings);

        const existing = app.vault.getFiles().find((file) => file.path === 'Games/Half-Life 2.md') as TFile;
        expect(app.metadataCache.getFileCache(existing)?.frontmatter.series).toEqual(['My Favourites']);
    });

    it('leaves series empty and makes no IGDB request when IGDB is not configured', async () => {
        const { igdbRequests } = mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2' }],
            series: { 220: 'Half-Life' },
        });
        const app = createMockApp();
        const service = createSteamSyncService(app);

        const result = await service.sync(buildSettings({ igdb: false }));

        expect(igdbRequests).toEqual([]);
        expect(result).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 });
        expect(app.vault.created['Games/Half-Life 2.md']).toContain('series: ""');
    });

    it('completes the sync when the IGDB lookup fails', async () => {
        // A dead or rate-limited IGDB must degrade to a blank series, never fail
        // the Steam import that the user actually asked for.
        mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2' }],
            series: { 220: 'Half-Life' },
            igdbFails: true,
        });
        const app = createMockApp();
        const service = createSteamSyncService(app);

        const result = await service.sync(buildSettings());

        expect(result).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 });
        expect(app.vault.created['Games/Half-Life 2.md']).toContain('series: ""');
    });

    it('skips the lookup when every note already has a series', async () => {
        const { igdbRequests } = mockSteamAndIgdb({
            apps: [{ appid: 220, name: 'Half-Life 2', playtime_forever: 500 }],
            series: { 220: 'Half-Life' },
        });
        const app = createMockApp([
            { path: 'Games/Half-Life 2.md', frontmatter: { 'steam-app-id': 220, series: 'Half-Life' } },
        ]);
        const settings = buildSettings();
        settings.steamSync.duplicateMode = 'update';
        const service = createSteamSyncService(app);

        await service.sync(settings);

        expect(igdbRequests).toEqual([]);
    });
});
