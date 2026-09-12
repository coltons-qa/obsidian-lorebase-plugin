import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { IntegrationService } from '../src/services/IntegrationService';
import type { AnimeDetails, GameDetails, VideoDetails } from '../src/services/integrations/types';
import { createMockApp } from './helpers/testHelpers';
import type { ManualCreateDraft } from '../src/modals/ManualCreateModal';
import { saveManualImageFileToVault } from '../src/services/integrations/imageStorage';
import { DEFAULT_SETTINGS } from '../src/constants';

describe('IntegrationService anime parts values', () => {
    it('does not let an unverified Steam search image override resolved SteamGridDB artwork', async () => {
        const service = new IntegrationService(createMockApp({}), () => structuredClone(DEFAULT_SETTINGS));
        const details: GameDetails = {
            kind: 'game',
            name: 'Watch Dogs',
            description: 'Description',
            poster: 'https://cdn2.steamgriddb.com/grid/watch-dogs.png',
            posterHorizontal: 'https://steamstatic.com/header.jpg',
            genres: ['Action'],
            platforms: ['windows'],
            developers: ['Ubisoft'],
            publishers: ['Ubisoft'],
            rating: '',
            metacritic: '77',
            released: 'May 27, 2014',
            year: '2014',
            url: 'https://store.steampowered.com/app/243470/',
        };

        const values = await (service as unknown as {
            buildGameValues(
                details: GameDetails,
                includeHowLongToBeat: boolean,
                fallbackImage: string,
                source: { provider: 'steam'; id: string }
            ): Promise<Record<string, unknown>>;
        }).buildGameValues(
            details,
            false,
            'https://steamstatic.com/steam/apps/243470/library_600x900.jpg',
            { provider: 'steam', id: '243470' }
        );

        expect(values.Poster).toBe('https://cdn2.steamgriddb.com/grid/watch-dogs.png');
    });

    it('fetches anime parts and provider community rating during source synchronization', async () => {
        const service = new IntegrationService(createMockApp({}), () => structuredClone(DEFAULT_SETTINGS));
        let fetchOptions: { includeParts?: boolean } | undefined;
        const details: AnimeDetails = {
            kind: 'anime',
            name: 'Another',
            description: 'Description',
            image: 'poster.jpg',
            imageHorizontal: 'wide.jpg',
            tags: ['Horror'],
            studios: ['P.A. Works'],
            year: '2012',
            imdbRating: '7.1',
            communityRating: '7.1',
            communityVotes: '175583',
            url: 'https://anilist.co/anime/11111',
            format: 'tv',
            parts: [
                { id: 'anilist-11111', kind: 'tv', title: 'Another', seasonNumber: 1, episodeCurrent: 0, episodeTotal: 12, status: 'planned' },
                { id: 'anilist-11701', kind: 'ova', title: 'Another: The Other', seasonNumber: null, episodeCurrent: 0, episodeTotal: 1, status: 'planned' },
            ],
        };
        (service as unknown as {
            fetchDetails(
                provider: string,
                id: string,
                apiKey: string,
                clientSecret: string,
                kind: string | undefined,
                options: { includeParts?: boolean }
            ): Promise<AnimeDetails | null>;
        }).fetchDetails = async (_provider, _id, _apiKey, _clientSecret, _kind, options) => {
            fetchOptions = options;
            return details;
        };

        const patch = await service.getMediaEnrichment('anime', {
            provider: 'anilist',
            id: '11111',
            title: 'Another',
        });

        expect(fetchOptions).toEqual({ includeParts: true });
        expect(patch?.values.integration_provider).toBe('anilist');
        expect(patch?.values.integration_id).toBe('11111');
        expect(patch?.values.anime_parts).toHaveLength(2);
        expect(patch?.values.communityRating).toBe(71);
        expect(patch?.values.communityVotes).toBe(175583);
        expect(patch?.values.communityRatingProvider).toBe('AniList');
    });

    it('keeps initial anime import free of provider parts while saving source identity', () => {
        const service = new IntegrationService(createMockApp({}), () => ({
            integrations: undefined,
        } as never));

        const details: AnimeDetails = {
            name: 'Series',
            description: 'Description',
            image: 'poster.jpg',
            imageHorizontal: 'wide.jpg',
            tags: ['fantasy'],
            studios: ['Studio'],
            year: '2024',
            imdbRating: '8.5',
            url: 'https://anilist.co/anime/42',
            format: 'tv',
            parts: [
                { id: 'anilist-1', kind: 'tv', title: 'Season 1', seasonNumber: 1, episodeCurrent: 0, episodeTotal: 12, status: 'planned' },
                { id: 'anilist-2', kind: 'ova', title: 'OVA', seasonNumber: null, episodeCurrent: 0, episodeTotal: 1, status: 'planned' },
            ],
        };

        const values = (service as unknown as {
            buildAnimeValues(details: AnimeDetails, source: unknown): Record<string, unknown>;
        }).buildAnimeValues(details, {
            provider: 'anilist',
            id: '42',
            parts: [],
        });

        expect(values.integrationProvider).toBe('anilist');
        expect(values.integrationId).toBe('42');
        expect(values.activePartId).toBe('');
        expect(values.episodeCurrent).toBe(0);
        expect(values.animePartsYaml).toBe('  []');
    });

    it('builds anime template values from reviewed parts and source identity', () => {
        const service = new IntegrationService(createMockApp({}), () => ({
            integrations: undefined,
        } as never));

        const details: AnimeDetails = {
            name: 'Series',
            description: 'Description',
            image: 'poster.jpg',
            imageHorizontal: 'wide.jpg',
            tags: ['fantasy'],
            studios: ['Studio'],
            year: '2024',
            imdbRating: '8.5',
            url: 'https://anilist.co/anime/42',
            format: 'tv',
            parts: [
                { id: 'anilist-1', kind: 'tv', title: 'Season 1', seasonNumber: 1, episodeCurrent: 0, episodeTotal: 12, status: 'planned' },
                { id: 'anilist-2', kind: 'ova', title: 'OVA', seasonNumber: null, episodeCurrent: 0, episodeTotal: 1, status: 'planned' },
            ],
        };

        const values = (service as unknown as {
            buildAnimeValues(details: AnimeDetails, source: unknown): Record<string, unknown>;
        }).buildAnimeValues(details, {
            parts: [
                { id: 'anilist-2', kind: 'ova', title: 'OVA', seasonNumber: null, episodeCurrent: 1, episodeTotal: 1, status: 'completed' },
            ],
            activePartId: 'anilist-2',
            status: 'watching',
            provider: 'anilist',
            id: '42',
        });

        expect(values.activePartId).toBe('anilist-2');
        expect(values.episodeCurrent).toBe(1);
        expect(values.status).toBe('watching');
        expect(values.integrationProvider).toBe('anilist');
        expect(values.integrationId).toBe('42');
        expect(values.animePartsYaml).toContain('id: "anilist-2"');
        expect(values.animePartsYaml).not.toContain('id: "anilist-1"');
    });

    it('leaves community values empty until a manual refresh in the editor', () => {
        const service = new IntegrationService(createMockApp({}), () => ({
            integrations: undefined,
        } as never));
        const details: AnimeDetails = {
            name: 'Series',
            description: '',
            image: '',
            tags: [],
            studios: [],
            year: '2024',
            imdbRating: '7.3',
            communityRating: '7.3',
            communityVotes: '262490',
            url: 'https://anilist.co/anime/42',
            format: 'tv',
        };

        const values = (service as unknown as {
            buildAnimeValues(details: AnimeDetails, source: unknown): Record<string, unknown>;
        }).buildAnimeValues(details, {
            provider: 'anilist',
            id: '42',
            parts: [],
        });

        expect(values.communityRating).toBe('');
        expect(values.communityVotes).toBe('');
        expect(values.communityRatingProvider).toBe('');
    });

    it('normalizes imported movie dates and splits comma-separated credits', () => {
        const service = new IntegrationService(createMockApp({}), () => ({
            integrations: undefined,
        } as never));
        const details: VideoDetails = {
            kind: 'video',
            name: 'The Wolf of Wall Street',
            description: '',
            poster: '',
            genres: ['Biography'],
            year: '2013',
            released: '25 Dec 2013',
            director: 'Martin Scorsese, martin scorsese',
            actors: 'Leonardo DiCaprio, Jonah Hill, Margot Robbie, leonardo dicaprio',
            url: 'https://www.imdb.com/title/tt0993846/',
        };

        const values = (service as unknown as {
            buildVideoValues(details: VideoDetails, kind: 'movies'): Record<string, unknown>;
        }).buildVideoValues(details, 'movies');

        expect(values.released).toBe('2013-12-25');
        expect(values.directors).toEqual(['Martin Scorsese']);
        expect(values.director).toEqual(['Martin Scorsese']);
        expect(values.actors).toEqual(['Leonardo DiCaprio', 'Jonah Hill', 'Margot Robbie']);
    });

    it('maps manual cover values to anime image fields and poster-based media fields', () => {
        const service = new IntegrationService(createMockApp({}), () => ({
            integrations: undefined,
        } as never));
        const buildManualValues = (service as unknown as {
            buildManualValues(draft: ManualCreateDraft): Record<string, unknown>;
        }).buildManualValues.bind(service);

        const animeValues = buildManualValues({
            ...createManualDraft('anime'),
            poster: 'covers/frieren.jpg',
            posterHorizontal: 'covers/frieren-wide.jpg',
        });
        const bookValues = buildManualValues({
            ...createManualDraft('books'),
            poster: 'covers/dune.jpg',
            posterHorizontal: 'covers/dune-wide.jpg',
        });

        expect(animeValues.image).toBe('covers/frieren.jpg');
        expect(animeValues.ImageHorizontal).toBe('covers/frieren-wide.jpg');
        expect(bookValues.Poster).toBe('covers/dune.jpg');
        expect(bookValues.PosterHorizontal).toBe('covers/dune-wide.jpg');
    });

    it('respects an empty simple template field selection', () => {
        const service = new IntegrationService(createMockApp({}), () => ({
            integrations: undefined,
        } as never));
        const getTemplate = (service as unknown as {
            getTemplate(
                kind: 'anime',
                enabled: boolean,
                mode: string | undefined,
                fields: string[] | undefined,
                advancedTemplate: string,
                howLongToBeatEnabled: boolean
            ): string | null;
        }).getTemplate.bind(service);

        const template = getTemplate('anime', true, 'simple', [], '', false);

        expect(template).toBe('---\n---');
    });

    it('builds the effective anime template only from selected simple fields', () => {
        const service = new IntegrationService(createMockApp({}), () => ({
            integrations: undefined,
        } as never));
        const getTemplate = (service as unknown as {
            getTemplate(
                kind: 'anime',
                enabled: boolean,
                mode: string | undefined,
                fields: string[] | undefined,
                advancedTemplate: string,
                howLongToBeatEnabled: boolean
            ): string | null;
        }).getTemplate.bind(service);

        const template = getTemplate('anime', true, 'simple', ['name', 'image'], '', false) ?? '';

        expect(template).toContain('title: "{{VALUE:name}}"');
        expect(template).toContain('image: "{{VALUE:image}}"');
        expect(template).not.toContain('tags:');
        expect(template).not.toContain('year:');
        expect(template).not.toContain('studios:');
        expect(template).not.toContain('format:');
        expect(template).not.toContain('anime_parts:');
        expect(template).not.toContain('rating:');
        expect(template).not.toContain('status:');
        expect(template).not.toContain('integration_provider:');
        expect(template).not.toContain('url:');
    });

    it('copies a manually selected cover file into the configured vault image folder', async () => {
        const writes: Array<{ path: string; data: ArrayBuffer }> = [];
        const folders: string[] = [];
        const app = {
            vault: {
                getAbstractFileByPath() {
                    return null;
                },
                async createFolder(path: string) {
                    folders.push(path);
                },
                adapter: {
                    async writeBinary(path: string, data: ArrayBuffer) {
                        writes.push({ path, data });
                    },
                },
            },
        } as unknown as App;
        const file = {
            name: 'cover.png',
            type: 'image/png',
            async arrayBuffer() {
                return new Uint8Array([1, 2, 3]).buffer;
            },
        } as File;

        const path = await saveManualImageFileToVault(app, file, {
            baseFolder: 'files/lorebase/images',
            kind: 'books',
            title: 'Dune',
            label: 'Poster',
        });

        expect(path).toBe('files/lorebase/images/books/Dune - Poster.png');
        expect(folders).toEqual(['files', 'files/lorebase', 'files/lorebase/images', 'files/lorebase/images/books']);
        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe(path);
    });

    it('uses the year to disambiguate same-title provider imports', () => {
        const app = createMockApp({});
        const service = new IntegrationService(app, () => ({
            integrations: undefined,
        } as never));
        const reservedPaths = new Set<string>();

        const first = (service as unknown as {
            resolveCreatePath(folderPath: string, title: string, options: unknown): { fullPath: string };
        }).resolveCreatePath('Movies', 'The Running Man', {
            preferYear: true,
            year: '2025',
            provider: 'tmdb',
            id: '123',
            reservedPaths,
        });
        reservedPaths.add(first.fullPath);
        const second = (service as unknown as {
            resolveCreatePath(folderPath: string, title: string, options: unknown): { fullPath: string };
        }).resolveCreatePath('Movies', 'The Running Man', {
            preferYear: true,
            year: '1987',
            provider: 'tmdb',
            id: '456',
            reservedPaths,
        });

        expect(first.fullPath).toBe('Movies/The Running Man 2025.md');
        expect(second.fullPath).toBe('Movies/The Running Man 1987.md');
    });
});

function createManualDraft(kind: ManualCreateDraft['kind']): ManualCreateDraft {
    return {
        kind,
        title: 'Manual',
        year: '',
        released: '',
        status: 'planned',
        url: '',
        poster: '',
        posterHorizontal: '',
        posterFile: null,
        genres: [],
        tags: [],
        rating: null,
        gameSeries: '',
        format: 'tv',
        animeParts: [{ id: 'tv-1', kind: 'tv', title: 'Season 1', seasonNumber: 1, episodeCurrent: 0, episodeTotal: null, status: 'planned' }],
        activeAnimePartId: 'tv-1',
        seasonNumber: kind === 'tv' ? 1 : null,
        episodeCurrent: 0,
        episodeTotal: kind === 'movies' ? 1 : null,
        pageCurrent: 0,
        pageTotal: null,
        chapterCurrent: 0,
        chapterTotal: null,
        volumeCurrent: kind === 'manga' ? 1 : null,
        volumeTotal: null,
    };
}
