import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { VideoService } from '../src/services/VideoService';
import type { MovieItem, TvItem } from '../src/types';
import { createMetadataService, createMockApp, createMockFile } from './helpers/testHelpers';

describe('VideoService', () => {
    it('parses movie frontmatter from cache', () => {
        const file = createMockFile('Movies/Blade Runner.md', 'Blade Runner');
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    type: 'movie',
                    title: 'Blade Runner',
                    poster: 'https://cdn.example/blade-runner.jpg',
                    'poster-b': 'https://cdn.example/blade-runner-wide.jpg',
                    synopsis: 'Replicants and memory.',
                    status: 'completed',
                    'user-rating': '5',
                    favorite: 'true',
                    year: '1982',
                    genres: 'Sci-Fi, Noir',
                    tags: ['Cyberpunk'],
                    released: '1982-06-25',
                    runtime: '117 min',
                    author: 'Ridley Scott',
                    cast: 'Harrison Ford',
                    rating: '8.1',
                    'integration-provider': 'tmdb',
                    'integration-id': 78,
                    'related-media': [
                        { type: 'tv', path: 'Series/Blade Runner Black Lotus.md', title: 'Black Lotus' },
                    ],
                },
                tags: [{ tag: '#Classic' }],
            },
        });

        const service = new VideoService(app, 'movie', 'Movies', createMetadataService(app));
        const parsed = service.parseFromCache(file);

        expect(parsed).not.toBeNull();
        expect(parsed?.type).toBe('movie');
        expect(parsed?.displayName).toBe('Blade Runner');
        expect(parsed?.status).toBe('completed');
        expect(parsed?.userRating).toBe(5);
        expect(parsed?.favorite).toBe(true);
        expect(parsed?.year).toBe(1982);
        expect(parsed?.imageUrl).toBe('https://cdn.example/blade-runner.jpg');
        expect(parsed?.horizontalImageUrl).toBe('https://cdn.example/blade-runner-wide.jpg');
        expect(parsed?.genres).toContain('sci-fi');
        expect(parsed?.tags).toContain('classic');
        expect((parsed as MovieItem)?.author).toEqual(['Ridley Scott']);
        expect(parsed?.integrationProvider).toBe('tmdb');
        expect(parsed?.integrationId).toBe('78');
        expect(parsed?.relatedMedia).toEqual([
            { type: 'tv', path: 'Series/Blade Runner Black Lotus.md', title: 'Black Lotus' },
        ]);
    });

    it('resolves local poster paths to Obsidian resource URLs', () => {
        const file = createMockFile('Movies/Conclave.md', 'Conclave');
        const posterFile = createMockFile('_attachments/movies/Conclave - Poster.webp', 'Conclave - Poster');
        posterFile.name = 'Conclave - Poster.webp';
        posterFile.extension = 'webp';
        const app = {
            metadataCache: {
                getFileCache(target: { path: string }): unknown {
                    if (target.path !== file.path) return null;
                    return {
                        frontmatter: {
                            type: 'movie',
                            title: 'Conclave',
                            poster: '_attachments/movies/Conclave - Poster.webp',
                        },
                    };
                },
            },
            vault: {
                getAbstractFileByPath(path: string): TFile | null {
                    return path === posterFile.path ? posterFile : null;
                },
                getFiles(): TFile[] {
                    return [posterFile];
                },
                getResourcePath(target: TFile): string {
                    return `app://vault/${encodeURIComponent(target.path)}?123`;
                },
            },
        } as unknown as App;

        const service = new VideoService(app, 'movie', 'Movies', createMetadataService(app));
        const parsed = service.parseFromCache(file);

        expect(parsed?.poster).toBe('_attachments/movies/Conclave - Poster.webp');
        expect(parsed?.imageUrl).toBe('app://vault/_attachments%2Fmovies%2FConclave%20-%20Poster.webp?123');
    });

    it('retries local poster resolution after a previously missing file appears', () => {
        const file = createMockFile('Series/Shameless.md', 'Shameless');
        const posterPath = 'files/lorebase/images/series/Shameless - Poster.jpg';
        const posterFile = createMockFile(posterPath, 'Shameless - Poster');
        posterFile.name = 'Shameless - Poster.jpg';
        posterFile.extension = 'jpg';
        let posterExists = false;
        const app = {
            metadataCache: {
                getFileCache(target: { path: string }): unknown {
                    if (target.path !== file.path) return null;
                    return {
                        frontmatter: {
                            type: 'tv',
                            title: 'Shameless',
                            poster: posterPath,
                        },
                    };
                },
            },
            vault: {
                getAbstractFileByPath(path: string): TFile | null {
                    return posterExists && path === posterPath ? posterFile : null;
                },
                getFiles(): TFile[] {
                    return posterExists ? [posterFile] : [];
                },
                getResourcePath(target: TFile): string {
                    return `app://vault/${encodeURIComponent(target.path)}?456`;
                },
            },
        } as unknown as App;
        const metadataService = createMetadataService(app);
        const service = new VideoService(app, 'tv', 'Series', metadataService);

        expect(service.parseFromCache(file)?.imageUrl).toBe(posterPath);

        posterExists = true;
        expect(service.parseFromCache(file)?.imageUrl).toBe('app://vault/files%2Florebase%2Fimages%2Fseries%2FShameless%20-%20Poster.jpg?456');
    });

    it('parses series parts and uses the active part for progress', () => {
        const file = createMockFile('Series/Show.md', 'Show');
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    type: 'tv',
                    title: 'Show',
                    status: 'watching',
                    'season-id-current': 'season-2',
                    'season-data': [
                        {
                            id: 'season-1',
                            title: 'Season 1',
                            'season-number': 1,
                            'episode-current': 10,
                            episodes: 10,
                            status: 'completed',
                        },
                        {
                            id: 'season-2',
                            title: 'Season 2',
                            'season-number': 2,
                            'episode-current': 3,
                            episodes: 8,
                            status: 'watching',
                        },
                    ],
                },
            },
        });

        const service = new VideoService(app, 'tv', 'Series', createMetadataService(app));
        const parsed = service.parseFromCache(file) as TvItem | null;

        expect(parsed).not.toBeNull();
        expect(parsed?.type).toBe('tv');
        expect(parsed?.parts).toHaveLength(2);
        expect(parsed?.activePartId).toBe('season-2');
        expect(parsed?.episodeCurrent).toBe(3);
        expect(parsed?.episodeTotal).toBe(8);
        expect(parsed?.seasons).toBe(2);
    });

    it('normalizes movie release dates and writes comma-separated video credits as YAML arrays', async () => {
        const file = createMockFile('Movies/Ensemble.md', 'Ensemble');
        const frontmatter: Record<string, unknown> = {
            type: 'movie',
            title: 'Ensemble',
            released: '25 Dec 2013',
            director: 'Old Director',
            cast: 'Old Actor',
        };
        const app = {
            metadataCache: {
                getFileCache(target: TFile): unknown {
                    return target.path === file.path ? { frontmatter } : null;
                },
            },
            vault: {
                getAbstractFileByPath(path: string): TFile | null {
                    return path === file.path ? file : null;
                },
                getFiles(): TFile[] {
                    return [];
                },
                getResourcePath(): string {
                    return '';
                },
            },
            fileManager: {
                async processFrontMatter(_file: TFile, handler: (value: Record<string, unknown>) => void): Promise<void> {
                    handler(frontmatter);
                },
            },
        } as unknown as App;
        const service = new VideoService(app, 'movie', 'Movies', createMetadataService(app));
        const item = service.parseFromCache(file);

        expect(item).not.toBeNull();
        expect((item as MovieItem).releaseDate).toBe('2013-12-25');
        await service.updateItem(item!, {
            releaseDate: '1 Jan 2014',
            author: ['Lana Wachowski', 'Lilly Wachowski', 'lana wachowski'],
            actors: 'Keanu Reeves, Carrie-Anne Moss',
        });

        // director/directors consolidate onto `author`, actors onto `cast`.
        expect(frontmatter).toMatchObject({
            released: '2014-01-01',
            author: ['Lana Wachowski', 'Lilly Wachowski'],
            cast: ['Keanu Reeves', 'Carrie-Anne Moss'],
        });
        expect(frontmatter).not.toHaveProperty('director');
        expect(frontmatter).not.toHaveProperty('directors');
        expect(frontmatter).not.toHaveProperty('actors');
    });

    it('trashes video notes instead of deleting them directly', async () => {
        const file = createMockFile('Movies/Safe Delete.md', 'Safe Delete');
        let trashedFile: TFile | null = null;
        let deleteCalled = false;
        const app = {
            metadataCache: {
                getFileCache(): unknown {
                    return { frontmatter: {} };
                },
            },
            vault: {
                getAbstractFileByPath(path: string): TFile | null {
                    return path === file.path ? file : null;
                },
                async delete(): Promise<void> {
                    deleteCalled = true;
                },
            },
            fileManager: {
                async trashFile(target: TFile): Promise<void> {
                    trashedFile = target;
                },
            },
        } as unknown as App;

        const service = new VideoService(app, 'movie', 'Movies', createMetadataService(app));
        await service.deleteItem({
            type: 'movie',
            filePath: file.path,
            displayName: 'Safe Delete',
            nameLower: 'safe delete',
            year: null,
            description: '',
            summary: '',
            userRating: null,
            favorite: false,
            poster: null,
            imageUrl: '',
            horizontalImageUrl: null,
            hasCustomPoster: false,
            status: 'planned',
            genres: [],
            tags: [],
            sourceUrl: null,
            integrationProvider: null,
            integrationId: null,
            parts: [],
            activePartId: null,
            relatedMedia: [],
        });

        expect(trashedFile).toBe(file);
        expect(deleteCalled).toBe(false);
    });

    describe('kebab-case frontmatter (migration stage 1)', () => {
        // Stage 1 of the frontmatter migration: readers must accept the new kebab-case
        // keys so the bulk data rewrite in stage 2 cannot break the library.
        function parseSeries(frontmatter: Record<string, unknown>): TvItem | null {
            const file = createMockFile('Library/Severance.md', 'Severance');
            const app = createMockApp({ [file.path]: { frontmatter } });
            const service = new VideoService(app, 'tv', 'Library', createMetadataService(app));
            return service.parseFromCache(file) as TvItem | null;
        }

        function parseMovie(frontmatter: Record<string, unknown>): MovieItem | null {
            const file = createMockFile('Library/Arrival.md', 'Arrival');
            const app = createMockApp({ [file.path]: { frontmatter } });
            const service = new VideoService(app, 'movie', 'Library', createMetadataService(app));
            return service.parseFromCache(file) as MovieItem | null;
        }

        it('reads renamed series keys in their new spelling', () => {
            const series = parseSeries({
                type: 'series',
                title: 'Severance',
                'poster-b': 'https://cdn.example/severance-wide.jpg',
                synopsis: 'Work life balance, literally.',
                author: 'Dan Erickson',
                cast: 'Adam Scott, Britt Lower',
                'user-rating': 6,
                'community-rating': 88.4,
                'community-votes': 2200,
                'community-rating-provider': 'TMDB',
                'integration-provider': 'tmdb',
                'integration-id': '95396',
                seasons: 2,
                'episode-current': 5,
                episodes: 10,
            });

            expect(series?.displayName).toBe('Severance');
            expect(series?.description).toBe('Work life balance, literally.');
            expect(series?.author).toEqual(['Dan Erickson']);
            expect(series?.actors).toBe('Adam Scott, Britt Lower');
            expect(series?.userRating).toBe(6);
            expect(series?.communityRating).toBe(88.4);
            expect(series?.communityVotes).toBe(2200);
            expect(series?.communityRatingProvider).toBe('TMDB');
            expect(series?.integrationProvider).toBe('tmdb');
            expect(series?.integrationId).toBe('95396');
            expect(series?.seasons).toBe(2);
            expect(series?.episodeCurrent).toBe(5);
            expect(series?.episodeTotal).toBe(10);
            expect(series?.horizontalImageUrl).toBe('https://cdn.example/severance-wide.jpg');
        });

        it('reads season-data with kebab nested keys, driven by season-id-current', () => {
            const series = parseSeries({
                type: 'series',
                title: 'Severance',
                'season-data': [
                    { id: 'season-1', title: 'Season 1', 'season-number': 1, 'episode-current': 9, episodes: 9, status: 'completed' },
                    { id: 'season-2', title: 'Season 2', 'season-number': 2, 'episode-current': 4, episodes: 10, status: 'watching' },
                ],
                'season-id-current': 'season-2',
            });

            expect(series?.parts).toHaveLength(2);
            expect(series?.activePartId).toBe('season-2');
            // Top-level progress mirrors the active season, not the first one.
            expect(series?.episodeCurrent).toBe(4);
            expect(series?.episodeTotal).toBe(10);
            expect(series?.parts?.[1]?.seasonNumber).toBe(2);
        });

        it('reads renamed movie keys in their new spelling', () => {
            const movie = parseMovie({
                type: 'movie',
                title: 'Arrival',
                'poster-b': 'https://cdn.example/arrival-wide.jpg',
                synopsis: 'Linguistics and time.',
                author: 'Denis Villeneuve',
                cast: 'Amy Adams, Jeremy Renner',
                'user-rating': 7,
                'integration-provider': 'tmdb',
                'integration-id': '329865',
            });

            expect(movie?.displayName).toBe('Arrival');
            expect(movie?.description).toBe('Linguistics and time.');
            expect(movie?.author).toEqual(['Denis Villeneuve']);
            expect(movie?.actors).toBe('Amy Adams, Jeremy Renner');
            expect(movie?.userRating).toBe(7);
            expect(movie?.integrationProvider).toBe('tmdb');
            expect(movie?.integrationId).toBe('329865');
        });

    });
});
