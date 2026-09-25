import { describe, expect, it } from 'vitest';
import { extractMarkdownSection, GameService, upsertMarkdownSection } from '../src/services/GameService';
import type { GameItem } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/constants';
import { createMockApp, createBaseFilter, createMetadataService, createMockFile, createMockFolder } from './helpers/testHelpers';
import { getSortOptionsForMediaType, getStatusOptionsForMediaType } from '../src/views/library/viewOptions';

describe('GameService', () => {
    it('parses frontmatter from cache into game model', () => {
        const file = createMockFile('Games/Mass Effect.md', 'Mass Effect');
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    type: 'game',
                    poster: 'https://cdn.example/me.jpg',
                    status: 'played',
                    'user-rating': '5',
                    year: '2007',
                    synopsis: 'Sci-fi RPG',
                    favorite: true,
                    series: 'Mass Effect',
                    dateCompleted: '2024-05-10',
                    started: '2024-04-01',
                    finished: '2024-05-10',
                    dlc: [
                        {
                            id: '123',
                            provider: 'steam',
                            title: 'Citadel',
                            image: 'https://cdn.example/dlc.jpg',
                            url: 'https://store.steampowered.com/app/123/',
                            'user-rating': 4,
                        },
                    ],
                    'related-media': [
                        {
                            type: 'manga',
                            path: 'Manga/Mass Effect - Redemption.md',
                            title: 'Mass Effect: Redemption',
                        },
                    ],
                    genres: ['RPG'],
                    platforms: ['Windows PC', 'PlayStation 5'],
                    tags: ['Sci-Fi'],
                },
                tags: [{ tag: '#Space' }],
            },
        });

        const service = new GameService(app, createMetadataService(app));
        const parsed = service.parseGameFromCache(file);

        expect(parsed).not.toBeNull();
        expect(parsed?.type).toBe('game');
        expect(parsed?.status).toBe('completed');
        expect(parsed?.userRating).toBe(5);
        expect(parsed?.year).toBe(2007);
        expect(parsed?.tags).toContain('sci-fi');
        expect(parsed?.tags).toContain('space');
        expect(parsed?.genres).toContain('rpg');
        expect(parsed?.platforms).toEqual(['Windows PC', 'PlayStation 5']);
        expect(parsed?.dateCompleted).toBeTypeOf('number');
        expect(parsed?.started).toBe('2024-04-01');
        expect(parsed?.finished).toBe('2024-05-10');
        expect(parsed?.dlc).toEqual([
            {
                id: '123',
                provider: 'steam',
                title: 'Citadel',
                imageUrl: 'https://cdn.example/dlc.jpg',
                url: 'https://store.steampowered.com/app/123/',
                userRating: 4,
                owned: undefined,
            },
        ]);
        expect(parsed?.relatedMedia).toEqual([
            {
                type: 'manga',
                path: 'Manga/Mass Effect - Redemption.md',
                title: 'Mass Effect: Redemption',
            },
        ]);
    });

    it('serializes related media when a game is edited', async () => {
        const file = createMockFile('Games/Mass Effect.md', 'Mass Effect');
        const frontmatter: Record<string, unknown> = { type: 'game', title: 'Mass Effect' };
        const app = createMockApp({
            [file.path]: { frontmatter },
        });
        app.vault.getAbstractFileByPath = () => file;
        app.fileManager.processFrontMatter = async (_file, handler) => {
            handler(frontmatter);
        };

        const service = new GameService(app, createMetadataService(app));
        const game = service.parseGameFromCache(file);
        expect(game).not.toBeNull();

        await service.updateGame(game!, {
            relatedMedia: [
                {
                    type: 'book',
                    path: 'Books/Mass Effect - Revelation.md',
                    title: 'Mass Effect: Revelation',
                },
            ],
        });

        expect(frontmatter['related-media']).toEqual([
            {
                type: 'book',
                path: 'Books/Mass Effect - Revelation.md',
                title: 'Mass Effect: Revelation',
            },
        ]);
    });

    it('extracts and updates the My Notes markdown section', () => {
        const content = [
            '---',
            'name: "Game"',
            '---',
            '',
            '# Game',
            '',
            '## My Notes',
            '',
            'Line one.',
            'Line two.',
            '',
            '## Other',
            '',
            'Keep me.',
        ].join('\n');

        expect(extractMarkdownSection(content)).toBe('Line one.\nLine two.');

        const updated = upsertMarkdownSection(content, 'My Notes', 'New note');
        expect(updated).toContain('## My Notes\n\nNew note');
        expect(updated).toContain('## Other\n\nKeep me.');
    });

    it('keeps local poster paths available when direct resource resolution is not ready', () => {
        const file = createMockFile('Games/Cyberpunk 2077.md', 'Cyberpunk 2077');
        const posterPath = 'files/lorebase/images/games/Cyberpunk 2077 - Poster.jpg';
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    type: 'game',
                    title: 'Cyberpunk 2077',
                    poster: posterPath,
                },
            },
        });

        const service = new GameService(app, createMetadataService(app));
        const parsed = service.parseGameFromCache(file);

        expect(parsed?.imageUrl).toBe(posterPath);
    });

    it('filters and sorts games by rules', () => {
        const app = createMockApp({});
        const service = new GameService(app, createMetadataService(app));
        const games: GameItem[] = [
            {
                type: 'game',
                filePath: 'a.md',
                displayName: 'Bravo',
                nameLower: 'bravo',
                year: 2020,
                description: '',
                userRating: 4,
                favorite: false,
                poster: '',
                imageUrl: '',
                horizontalImageUrl: null,
                hasCustomPoster: false,
                status: 'completed',
                series: '',
                dateCompleted: null,
                tags: [],
                genres: [],
            },
            {
                type: 'game',
                filePath: 'b.md',
                displayName: 'Alpha',
                nameLower: 'alpha',
                year: 2021,
                description: '',
                userRating: 5,
                favorite: true,
                poster: '',
                imageUrl: '',
                horizontalImageUrl: null,
                hasCustomPoster: true,
                status: 'playing',
                series: '',
                dateCompleted: null,
                tags: [],
                genres: [],
            },
            {
                type: 'game',
                filePath: 'c.md',
                displayName: 'Charlie',
                nameLower: 'charlie',
                year: 2019,
                description: '',
                userRating: 3,
                favorite: false,
                poster: '',
                imageUrl: '',
                horizontalImageUrl: null,
                hasCustomPoster: false,
                status: 'dropped',
                series: '',
                dateCompleted: null,
                tags: [],
                genres: [],
            },
        ];

        // The 18+ flag was removed, so nothing is hidden by default any more.
        const base = service.filterAndSort(games, createBaseFilter(), 'name', 'asc');
        expect(base.map((item) => item.displayName)).toEqual(['Alpha', 'Bravo', 'Charlie']);

        const defaultViewFilter = createBaseFilter();
        defaultViewFilter.rules = DEFAULT_SETTINGS.games.viewState.rules;
        const defaultView = service.filterAndSort(games, defaultViewFilter, 'name', 'asc');
        // Only the custom-poster rule remains in the defaults; Alpha has one, so it hides.
        expect(defaultView.map((item) => item.displayName)).toEqual(['Bravo', 'Charlie']);

        const searchFilter = createBaseFilter();
        searchFilter.searchTerm = 'alpha';
        const withSearch = service.filterAndSort(games, searchFilter, 'name', 'asc');
        expect(withSearch.map((item) => item.displayName)).toEqual(['Alpha']);
    });

    it('shows series as the primary game sort option', () => {
        expect(getSortOptionsForMediaType('game')[0]).toMatchObject({ field: 'series' });
    });

    it('sorts games chronologically inside series groups', () => {
        const app = createMockApp({});
        const service = new GameService(app, createMetadataService(app));
        const createGame = (displayName: string, year: number): GameItem => ({
            type: 'game',
            filePath: `${displayName}.md`,
            displayName,
            nameLower: displayName.toLowerCase(),
            year,
            description: '',
            userRating: null,
            favorite: false,
            poster: '',
            imageUrl: '',
            horizontalImageUrl: null,
            hasCustomPoster: false,
            status: 'planned',
            series: 'Same series',
            dateCompleted: null,
            tags: [],
            genres: [],
        });

        const sortedByName = [
            createGame('Alpha', 2024),
            createGame('Bravo', 1999),
            createGame('Charlie', 2010),
        ];

        const grouped = service.groupBySeries(sortedByName, 'asc');
        const seriesItems = Array.from(grouped.values())[0] ?? [];

        expect(seriesItems.map((item) => item.displayName)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    });

    it('uses custom status labels without changing status values', () => {
        const options = getStatusOptionsForMediaType('game', {
            games: { completed: 'Cleared on easy' },
            anime: {},
            movies: {},
            tv: {},
            books: {},
            manga: {},
        });

        expect(options.find((option) => option.status === 'completed')).toEqual({
            status: 'completed',
            label: 'Cleared on easy',
        });
    });

    it('exposes paused as a game status option', () => {
        expect(getStatusOptionsForMediaType('game')).toContainEqual({
            status: 'paused',
            label: 'Paused',
        });
    });

    it('migrates legacy wishlist and not_started statuses to planned', () => {
        const wishlistStatusFile = createMockFile('Games/Wish Status.md', 'Wish Status');
        const wishlistFlagFile = createMockFile('Games/Wish Flag.md', 'Wish Flag');
        const notStartedFile = createMockFile('Games/Not Started.md', 'Not Started');
        const app = createMockApp({
            [wishlistStatusFile.path]: {
                frontmatter: {
                    status: 'wishlist',
                },
            },
            [wishlistFlagFile.path]: {
                frontmatter: {
                    wishlist: 'true',
                },
            },
            [notStartedFile.path]: {
                frontmatter: {
                    status: 'not_started',
                },
            },
        });

        const service = new GameService(app, createMetadataService(app));

        expect(service.parseGameFromCache(wishlistStatusFile)?.status).toBe('planned');
        expect(service.parseGameFromCache(wishlistFlagFile)?.status).toBe('planned');
        expect(service.parseGameFromCache(notStartedFile)?.status).toBe('planned');
    });

    it('counts planned and paused games in statistics', () => {
        const app = createMockApp({});
        const service = new GameService(app, createMetadataService(app));
        const plannedGame: GameItem = {
            type: 'game',
            filePath: 'plan.md',
            displayName: 'Planned',
            nameLower: 'planned',
            year: 2026,
            description: '',
            userRating: null,
            favorite: false,
            poster: '',
            imageUrl: '',
            horizontalImageUrl: null,
            hasCustomPoster: false,
            status: 'planned',
            series: '',
            dateCompleted: null,
            tags: [],
            genres: [],
        };
        const pausedGame: GameItem = { ...plannedGame, filePath: 'pause.md', displayName: 'Paused', nameLower: 'paused', status: 'paused' };

        const stats = service.calculateStats([plannedGame, pausedGame]);

        expect(stats.planned).toBe(1);
        expect(stats.paused).toBe(1);
        expect(stats.statusPercentages.planned).toBe(50);
        expect(stats.statusPercentages.paused).toBe(50);
    });

    it('filters plan presets as regular tags', () => {
        const app = createMockApp({});
        const service = new GameService(app, createMetadataService(app));
        const games: GameItem[] = [
            {
                type: 'game',
                filePath: 'a.md',
                displayName: 'Tagged',
                nameLower: 'tagged',
                year: 2020,
                description: '',
                userRating: null,
                favorite: false,
                poster: '',
                imageUrl: '',
                horizontalImageUrl: null,
                hasCustomPoster: false,
                status: 'planned',
                series: '',
                dateCompleted: null,
                tags: ['next-in-queue'],
                genres: [],
            },
            {
                type: 'game',
                filePath: 'b.md',
                displayName: 'Plain',
                nameLower: 'plain',
                year: 2021,
                description: '',
                userRating: null,
                favorite: false,
                poster: '',
                imageUrl: '',
                horizontalImageUrl: null,
                hasCustomPoster: false,
                status: 'planned',
                series: '',
                dateCompleted: null,
                tags: [],
                genres: [],
            },
        ];
        const filter = createBaseFilter();
        filter.tags = ['next-in-queue'];

        const result = service.filterAndSort(games, filter, 'name', 'asc');

        expect(result.map((item) => item.displayName)).toEqual(['Tagged']);
    });

    it('normalizes legacy plan tags with spaces from frontmatter', () => {
        const file = createMockFile('Games/Plans.md', 'Plans');
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    title: 'Plans',
                    tags: ['play soon', 'wait early access'],
                },
            },
        });
        const service = new GameService(app, createMetadataService(app));

        const parsed = service.parseGameFromCache(file);

        expect(parsed?.tags).toContain('play-soon');
        expect(parsed?.tags).toContain('wait-early-access');
    });

    it('does not treat string false flags as true', () => {
        const file = createMockFile('Games/Test.md', 'Test');
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    played: 'false',
                    favorite: 'false',
                },
            },
        });

        const service = new GameService(app, createMetadataService(app));
        const parsed = service.parseGameFromCache(file);

        expect(parsed).not.toBeNull();
        expect(parsed?.status).toBe('planned');
        expect(parsed?.favorite).toBe(false);
    });

    it('reads release and studio fields from canonical frontmatter keys', () => {
        const file = createMockFile('Games/AC2.md', 'AC2');
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    type: 'game',
                    released: '2009-11-17',
                    author: ['Ubisoft Montreal'],
                    publishers: ['Ubisoft Entertainment'],
                },
            },
        });

        const service = new GameService(app, createMetadataService(app));
        const parsed = service.parseGameFromCache(file);

        expect(parsed).not.toBeNull();
        expect(parsed?.releaseDate).toBe('2009-11-17');
        expect(parsed?.author).toEqual(['Ubisoft Montreal']);
        expect(parsed?.publisher).toBe('Ubisoft Entertainment');
    });

    it('stores comma-separated developers and publishers as YAML lists', async () => {
        const file = createMockFile('Games/Black Flag.md', 'Black Flag');
        const frontmatter: Record<string, unknown> = {
            type: 'game',
            name: 'Black Flag',
            developer: 'Ubisoft Montreal',
            publisher: 'Ubisoft',
        };
        const app = createMockApp({ [file.path]: { frontmatter } });
        app.vault.getAbstractFileByPath = () => file;
        app.fileManager.processFrontMatter = async (_file, handler) => handler(frontmatter);

        const service = new GameService(app, createMetadataService(app));
        const game = service.parseGameFromCache(file);
        expect(game).not.toBeNull();

        await service.updateGame(game!, {
            author: ['Ubisoft Montreal', 'Ubisoft'],
            publisher: 'Ubisoft, Ubisoft Entertainment',
        });

        // developer/developers consolidate onto `author`; publishers keeps its own key.
        expect(frontmatter.author).toEqual(['Ubisoft Montreal', 'Ubisoft']);
        expect(frontmatter.publishers).toEqual(['Ubisoft', 'Ubisoft Entertainment']);
        expect(frontmatter.developer).toBeUndefined();
        expect(frontmatter.developers).toBeUndefined();
        expect(frontmatter.publisher).toBeUndefined();
    });

    it('stores edited platforms as a YAML list', async () => {
        const file = createMockFile('Games/Platforms.md', 'Platforms');
        const frontmatter: Record<string, unknown> = {
            type: 'game',
            title: 'Platforms',
            platforms: 'Windows PC',
        };
        const app = createMockApp({ [file.path]: { frontmatter } });
        app.vault.getAbstractFileByPath = () => file;
        app.fileManager.processFrontMatter = async (_file, handler) => handler(frontmatter);

        const service = new GameService(app, createMetadataService(app));
        const game = service.parseGameFromCache(file);
        expect(game?.platforms).toEqual(['Windows PC']);

        await service.updateGame(game!, {
            platforms: ['Windows PC', 'Xbox Series X|S'],
        });

        expect(frontmatter.platforms).toEqual(['Windows PC', 'Xbox Series X|S']);
    });

    describe('new manual fields (migration stage 4c)', () => {
        function parse(frontmatter: Record<string, unknown>) {
            const file = createMockFile('Library/Halo.md', 'Halo');
            const app = createMockApp({ [file.path]: { frontmatter } });
            return new GameService(app, createMetadataService(app)).parseGameFromCache(file);
        }

        it('reads owned, count, repeatable and my-platform', () => {
            const game = parse({
                type: 'game',
                title: 'Halo',
                owned: 'physical',
                count: 3,
                repeatable: true,
                'my-platform': 'Xbox Series X',
            });

            expect(game?.owned).toBe('physical');
            expect(game?.count).toBe(3);
            expect(game?.repeatable).toBe(true);
            expect(game?.myPlatform).toBe('Xbox Series X');
        });

        it('defaults cleanly when the keys are absent', () => {
            const game = parse({ type: 'game', title: 'Halo' });

            expect(game?.owned).toBeNull();
            expect(game?.count).toBeNull();
            expect(game?.repeatable).toBe(false);
            expect(game?.myPlatform).toBe('');
        });

        it('writes them back under their canonical keys', async () => {
            const file = createMockFile('Library/Halo.md', 'Halo');
            const frontmatter: Record<string, unknown> = { type: 'game', title: 'Halo' };
            const app = createMockApp({ [file.path]: { frontmatter } });
            app.vault.getAbstractFileByPath = () => file;
            app.fileManager.processFrontMatter = async (_file, handler) => { handler(frontmatter); };

            const service = new GameService(app, createMetadataService(app));
            const game = service.parseGameFromCache(file);
            await service.updateGame(game!, {
                owned: 'digital',
                count: 2,
                repeatable: true,
                myPlatform: 'PC',
            });

            expect(frontmatter.owned).toBe('digital');
            expect(frontmatter.count).toBe(2);
            expect(frontmatter.repeatable).toBe(true);
            expect(frontmatter['my-platform']).toBe('PC');
        });
    });

    describe('canonical kebab-case frontmatter', () => {
        // After migration stage 5, readers accept only canonical keys.
        const kebabFrontmatter = {
            type: 'game',
            title: 'Mass Effect',
            poster: 'https://cdn.example/me.jpg',
            'poster-b': 'https://cdn.example/me-wide.jpg',
            synopsis: 'Sci-fi RPG',
            series: 'Mass Effect',
            author: 'BioWare',
            publishers: 'EA',
            'user-rating': 5,
            'community-rating': 86.2,
            'community-votes': 1774,
            'community-rating-provider': 'IGDB',
            'integration-provider': 'igdb',
            'integration-id': '15',
            'steam-app-id': '17460',
            released: '2007-11-20',
            'related-media': [{ type: 'book', path: 'Library/Revelation.md', title: 'Revelation' }],
        };

        function parse(frontmatter: Record<string, unknown>): GameItem | null {
            const file = createMockFile('Library/Mass Effect.md', 'Mass Effect');
            const app = createMockApp({ [file.path]: { frontmatter } });
            return new GameService(app, createMetadataService(app)).parseGameFromCache(file);
        }

        it('reads kebab-case DLC entries and round-trips them', () => {
            const file = createMockFile('Library/Fallout 3.md', 'Fallout 3');
            const frontmatter: Record<string, unknown> = {
                type: 'game',
                title: 'Fallout 3',
                dlc: [
                    {
                        id: '22370',
                        provider: 'steam',
                        title: 'Operation Anchorage',
                        image: 'https://cdn.example/anchorage.jpg',
                        url: 'https://store.steampowered.com/app/22370/',
                        'user-rating': 4,
                        owned: true,
                    },
                ],
            };
            const app = createMockApp({ [file.path]: { frontmatter } });
            const service = new GameService(app, createMetadataService(app));
            const game = service.parseGameFromCache(file);

            expect(game?.dlc).toHaveLength(1);
            expect(game?.dlc?.[0]).toMatchObject({
                id: '22370',
                title: 'Operation Anchorage',
                imageUrl: 'https://cdn.example/anchorage.jpg',
                userRating: 4,
                owned: true,
            });
        });

        it('passes the literal note keys through to rawFields', () => {
            // Documents the coupling that makes custom `yaml:<key>` filter rules
            // migration-sensitive: a rule saved against `yaml:gameSeries` will not match
            // once the note says `series`. See the migration plan's settings check.
            const kebab = parse(kebabFrontmatter);

            expect(kebab?.rawFields).toHaveProperty('series');
            expect(kebab?.rawFields).not.toHaveProperty('gameSeries');
        });

        it('reads each renamed key in its new spelling', () => {
            const game = parse(kebabFrontmatter);

            expect(game?.displayName).toBe('Mass Effect');
            expect(game?.description).toBe('Sci-fi RPG');
            expect(game?.series).toBe('Mass Effect');
            expect(game?.author).toEqual(['BioWare']);
            expect(game?.publisher).toBe('EA');
            expect(game?.userRating).toBe(5);
            expect(game?.communityRating).toBe(86.2);
            expect(game?.communityVotes).toBe(1774);
            expect(game?.communityRatingProvider).toBe('IGDB');
            expect(game?.integrationProvider).toBe('igdb');
            expect(game?.integrationId).toBe('15');
            expect(game?.steamAppId).toBe('17460');
            expect(game?.releaseDate).toBe('2007-11-20');
            expect(game?.horizontalImageUrl).toBe('https://cdn.example/me-wide.jpg');
            expect(game?.relatedMedia?.[0]?.path).toBe('Library/Revelation.md');
        });

    });

    describe('getSeriesList', () => {
        function createServiceWithLibrary(): GameService {
            const bg3 = createMockFile('Library/Baldur\'s Gate III.md', 'Baldur\'s Gate III');
            const bg2 = createMockFile('Library/Baldur\'s Gate II.md', 'Baldur\'s Gate II');
            const halo = createMockFile('Library/Halo.md', 'Halo');
            const orphan = createMockFile('Library/Untitled Goose Game.md', 'Untitled Goose Game');
            const app = createMockApp({
                [bg3.path]: { frontmatter: { type: 'game', title: 'Baldur\'s Gate III', series: 'Baldur\'s Gate' } },
                [bg2.path]: { frontmatter: { type: 'game', title: 'Baldur\'s Gate II', series: 'Baldur\'s Gate' } },
                [halo.path]: { frontmatter: { type: 'game', title: 'Halo', series: 'Halo' } },
                [orphan.path]: { frontmatter: { type: 'game', title: 'Untitled Goose Game' } },
            });
            const folder = createMockFolder('Library', [bg3, bg2, halo, orphan]);
            app.vault.getAbstractFileByPath = () => folder;

            const service = new GameService(app, createMetadataService(app));
            service.setFolderPath('Library');
            return service;
        }

        it('returns de-duplicated, sorted series from the loaded library', async () => {
            const service = createServiceWithLibrary();
            await service.loadGames();

            expect(service.getSeriesList()).toEqual(['Baldur\'s Gate', 'Halo']);
        });

        it('still returns series after the cache is invalidated by an unrelated vault edit', async () => {
            const service = createServiceWithLibrary();
            await service.loadGames();

            // Any metadata change in the vault invalidates the cache, which happens
            // constantly. The already-loaded games are still fine as a suggestion list.
            service.invalidateCache();

            expect(service.getSeriesList()).toEqual(['Baldur\'s Gate', 'Halo']);
        });

        it('returns nothing when no games have been loaded', () => {
            const service = createServiceWithLibrary();

            expect(service.getSeriesList()).toEqual([]);
        });
    });
});
