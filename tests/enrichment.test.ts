import { describe, expect, it } from 'vitest';
import {
    mergeProviderMetadata,
    normalizeCommunityRating,
    SOURCE_SNAPSHOT_FIELD,
    synchronizeProviderMetadata,
} from '../src/services/integrations/enrichment';

describe('media enrichment merge', () => {
    it('fills missing provider fields while preserving personal and custom fields', () => {
        const current = {
            title: 'Gothic 1 Remake',
            platforms: 'PC',
            status: 'beaten',
            Storefront: 'steam',
            hours: 45.4,
            comment: 'Keep this',
            poster: '',
        };
        const result = mergeProviderMetadata(current, {
            name: 'Gothic 1 Remake',
            poster: 'https://example.com/gothic.jpg',
            plot: 'Provider description',
            year: 2026,
            integration_provider: 'steam',
            integration_id: '1297900',
        });

        expect(result.values).toMatchObject({
            title: 'Gothic 1 Remake',
            platforms: 'PC',
            status: 'beaten',
            Storefront: 'steam',
            hours: 45.4,
            comment: 'Keep this',
            poster: 'https://example.com/gothic.jpg',
            synopsis: 'Provider description',
            year: 2026,
            'integration-provider': 'steam',
            'integration-id': '1297900',
        });
        expect(result.patch).not.toHaveProperty('title');
        expect(result.patch).not.toHaveProperty('status');
    });

    it('respects blacklist except for explicitly selected source identity', () => {
        const result = mergeProviderMetadata({}, {
            poster: 'cover.jpg',
            plot: 'Description',
            integration_provider: 'anilist',
            integration_id: '123',
        }, ['poster', 'integration_provider', 'integration_id']);

        expect(result.values).not.toHaveProperty('poster');
        expect(result.values).toMatchObject({
            synopsis: 'Description',
            'integration-provider': 'anilist',
            'integration-id': '123',
        });
    });

    it('merges parts by structural fallback and preserves progress', () => {
        const result = mergeProviderMetadata({
            anime_parts: [{
                id: 'manual-season-one',
                kind: 'tv',
                title: 'Season 1',
                season: 1,
                episode_current: 6,
                episode_total: null,
                status: 'watching',
            }],
        }, {
            anime_parts: [
                {
                    id: 'provider-100',
                    kind: 'tv',
                    title: 'Season 1',
                    season: 1,
                    episode_current: 0,
                    episode_total: 12,
                    status: 'planned',
                },
                {
                    id: 'provider-200',
                    kind: 'tv',
                    title: 'Season 2',
                    season: 2,
                    episode_current: 0,
                    episode_total: 12,
                    status: 'planned',
                },
            ],
        });

        const parts = result.values.anime_parts as Array<Record<string, unknown>>;
        expect(parts).toHaveLength(2);
        expect(parts[0]).toMatchObject({
            id: 'manual-season-one',
            episode_current: 6,
            episode_total: 12,
            status: 'watching',
        });
        expect(parts[1]).toMatchObject({ id: 'provider-200', season: 2 });
    });

    it('replaces provider metadata in synchronization mode while preserving custom fields', () => {
        const result = mergeProviderMetadata({
            title: 'Old title',
            synopsis: 'Old description',
            platforms: ['PC'],
            status: 'completed',
            favorite: true,
            my_notes: 'Keep me',
        }, {
            name: 'New title',
            plot: 'New description',
            platforms: ['PC', 'PlayStation 5'],
            integration_provider: 'rawg',
            integration_id: '42',
        }, [], { overwriteProviderFields: true });

        expect(result.values).toMatchObject({
            title: 'New title',
            synopsis: 'New description',
            platforms: ['PC', 'PlayStation 5'],
            status: 'completed',
            favorite: true,
            my_notes: 'Keep me',
            'integration-provider': 'rawg',
            'integration-id': '42',
        });
        expect(result.patch).not.toHaveProperty('status');
        expect(result.patch).not.toHaveProperty('favorite');
        expect(result.patch).not.toHaveProperty('my_notes');
    });

    it('synchronizes structured provider fields, adds new parts, and preserves personal progress', () => {
        const result = mergeProviderMetadata({
            anime_parts: [{
                id: 'local-season-one',
                kind: 'tv',
                title: 'Season One',
                season: 1,
                episode_current: 6,
                episode_total: 12,
                status: 'watching',
            }],
        }, {
            anime_parts: [
                {
                    id: 'provider-season-one',
                    kind: 'tv',
                    title: 'Season One Remastered',
                    season: 1,
                    episode_current: 0,
                    episode_total: 13,
                    status: 'planned',
                },
                {
                    id: 'provider-season-two',
                    kind: 'tv',
                    title: 'Season Two',
                    season: 2,
                    episode_current: 0,
                    episode_total: 24,
                    status: 'planned',
                },
            ],
        }, [], { overwriteProviderFields: true });

        const parts = result.values.anime_parts as Array<Record<string, unknown>>;
        expect(parts).toHaveLength(2);
        expect(parts[0]).toMatchObject({
            id: 'local-season-one',
            title: 'Season One Remastered',
            episode_current: 6,
            episode_total: 13,
            status: 'watching',
        });
        expect(parts[1]).toMatchObject({ id: 'provider-season-two', season: 2, episode_total: 24 });
    });

    it('preserves custom list additions and intentional removals across source updates', () => {
        const source = { provider: 'anilist' as const, id: '42' };
        const first = synchronizeProviderMetadata({
            genres: ['Любимое'],
        }, {
            integration_provider: 'anilist',
            integration_id: '42',
            genres: ['Action', 'RPG'],
        }, source);

        expect(first.values.genres).toEqual(['Action', 'RPG', 'Любимое']);
        expect(first.values).toHaveProperty(SOURCE_SNAPSHOT_FIELD);

        const secondCurrent = {
            ...first.values,
            genres: ['RPG', 'Любимое', 'Мрачное'],
        };
        const second = synchronizeProviderMetadata(secondCurrent, {
            integration_provider: 'anilist',
            integration_id: '42',
            genres: ['Action', 'RPG', 'Adventure'],
        }, source);

        expect(second.values.genres).toEqual(['RPG', 'Adventure', 'Любимое', 'Мрачное']);
    });

    it('updates untouched scalar fields but preserves scalars edited after the previous source snapshot', () => {
        const source = { provider: 'tmdb' as const, id: '100' };
        const first = synchronizeProviderMetadata({
            synopsis: 'Old provider plot',
            year: 2020,
        }, {
            integration_provider: 'tmdb',
            integration_id: '100',
            plot: 'First provider plot',
            year: 2021,
        }, source);

        expect(first.values.synopsis).toBe('First provider plot');
        expect(first.values.year).toBe(2021);

        const second = synchronizeProviderMetadata({
            ...first.values,
            synopsis: 'Моё описание',
        }, {
            integration_provider: 'tmdb',
            integration_id: '100',
            plot: 'Second provider plot',
            year: 2022,
        }, source);

        expect(second.values.synopsis).toBe('Моё описание');
        expect(second.values.year).toBe(2022);
    });

    it('uses the previous provider snapshot when changing sources so custom values survive relinking', () => {
        const oldSource = { provider: 'tmdb' as const, id: '100' };
        const first = synchronizeProviderMetadata({}, {
            integration_provider: 'tmdb',
            integration_id: '100',
            name: 'Provider title',
            genres: ['Drama', 'Crime'],
        }, oldSource);

        const relinked = synchronizeProviderMetadata({
            ...first.values,
            title: 'Моё название',
            genres: ['Drama', 'Любимое'],
        }, {
            integration_provider: 'omdb',
            integration_id: 'tt100',
            name: 'New source title',
            genres: ['Drama', 'Thriller'],
        }, { provider: 'omdb', id: 'tt100' });

        expect(relinked.values.title).toBe('Моё название');
        expect(relinked.values.genres).toEqual(['Drama', 'Thriller', 'Любимое']);
        expect(relinked.values['integration-provider']).toBe('omdb');
    });

    it('preserves edited part titles while refreshing provider totals and adding new parts', () => {
        const source = { provider: 'anilist' as const, id: '42' };
        const first = synchronizeProviderMetadata({}, {
            integration_provider: 'anilist',
            integration_id: '42',
            anime_parts: [{
                id: 'season-1', kind: 'tv', title: 'Season 1', season: 1,
                episode_current: 0, episode_total: 12, status: 'planned',
            }],
        }, source);
        const currentParts = structuredClone(first.values.anime_parts) as Array<Record<string, unknown>>;
        currentParts[0].title = 'Мой первый сезон';
        currentParts[0].episode_current = 7;
        currentParts[0].status = 'watching';

        const second = synchronizeProviderMetadata({
            ...first.values,
            anime_parts: currentParts,
        }, {
            integration_provider: 'anilist',
            integration_id: '42',
            anime_parts: [
                {
                    id: 'season-1', kind: 'tv', title: 'Season One', season: 1,
                    episode_current: 0, episode_total: 13, status: 'planned',
                },
                {
                    id: 'season-2', kind: 'tv', title: 'Season 2', season: 2,
                    episode_current: 0, episode_total: 24, status: 'planned',
                },
            ],
        }, source);

        const parts = second.values.anime_parts as Array<Record<string, unknown>>;
        expect(parts).toHaveLength(2);
        expect(parts[0]).toMatchObject({
            title: 'Мой первый сезон',
            episode_current: 7,
            episode_total: 13,
            status: 'watching',
        });
    });

    it('normalizes provider rating scales consistently', () => {
        expect(normalizeCommunityRating('rawg', 4.42)).toBe(88.4);
        expect(normalizeCommunityRating('anilist', 84)).toBe(84);
        expect(normalizeCommunityRating('shikimori', 6.52)).toBe(65.2);
    });

    describe('kebab-case notes (migration stage 3a)', () => {
        // findExistingAlias picks which key to write by searching the note for any
        // spelling listed in FIELD_ALIASES, and falls back to the provider field name
        // when nothing matches. After the stage 2 rename the aliases no longer matched,
        // so a refresh from source wrote a duplicate legacy property beside every
        // migrated one. These lock that shut.
        const source = { provider: 'igdb' as const, id: '15' };

        // A game note in its post-migration shape.
        function migratedGame(): Record<string, unknown> {
            return {
                type: 'game',
                title: 'Fallout 3',
                poster: 'https://cdn.example/fallout3.jpg',
                'poster-b': 'https://cdn.example/fallout3-wide.jpg',
                synopsis: 'Post-apocalyptic Washington DC.',
                series: 'Fallout',
                author: 'Bethesda Game Studios',
                publishers: 'Bethesda Softworks',
                'community-rating': 86.2,
                'community-votes': 1774,
                'community-rating-provider': 'IGDB',
                released: '2008-10-28',
                year: 2008,
                url: 'https://example.com/fallout3',
            };
        }

        // Keys as IntegrationService actually emits them.
        function incomingGame(): Record<string, unknown> {
            return {
                name: 'Fallout 3',
                poster: 'https://cdn.example/fallout3.jpg',
                poster_b: 'https://cdn.example/fallout3-wide-v2.jpg',
                plot: 'Updated provider description.',
                gameSeries: 'Fallout',
                developers: 'Bethesda Game Studios',
                publishers: 'Bethesda Softworks',
                communityRating: 87.1,
                communityVotes: 1801,
                communityRatingProvider: 'IGDB',
                released: '2008-10-28',
                year: 2008,
                url: 'https://example.com/fallout3',
            };
        }

        it('writes no duplicate legacy properties when refreshing a migrated game', () => {
            const current = migratedGame();
            const before = new Set(Object.keys(current));

            const result = synchronizeProviderMetadata(current, incomingGame(), source);

            const added = Object.keys(result.values)
                .filter((key) => !before.has(key) && key !== SOURCE_SNAPSHOT_FIELD);

            expect(added).toEqual([]);
        });

        it('updates the migrated key in place rather than creating a sibling', () => {
            const result = synchronizeProviderMetadata(migratedGame(), incomingGame(), source);

            expect(result.values['poster-b']).toBe('https://cdn.example/fallout3-wide-v2.jpg');
            expect(result.values.synopsis).toBe('Updated provider description.');
            expect(result.values['community-rating']).toBe(87.1);
            expect(result.values['community-votes']).toBe(1801);

            expect(result.values).not.toHaveProperty('poster_b');
            expect(result.values).not.toHaveProperty('plot');
            expect(result.values).not.toHaveProperty('gameSeries');
            expect(result.values).not.toHaveProperty('developers');
            expect(result.values).not.toHaveProperty('communityRating');
            expect(result.values).not.toHaveProperty('communityVotes');
            expect(result.values).not.toHaveProperty('communityRatingProvider');
        });

        it('writes no duplicate legacy properties when refreshing a migrated series', () => {
            const current: Record<string, unknown> = {
                type: 'series',
                title: 'Severance',
                'poster-b': 'https://cdn.example/severance-wide.jpg',
                synopsis: 'Work life balance, literally.',
                author: 'Dan Erickson',
                cast: 'Adam Scott',
                episodes: 9,
                'community-rating': 88.4,
            };
            const before = new Set(Object.keys(current));

            const result = synchronizeProviderMetadata(current, {
                name: 'Severance',
                poster_b: 'https://cdn.example/severance-wide-v2.jpg',
                plot: 'Updated description.',
                director: 'Dan Erickson',
                actors: 'Adam Scott, Britt Lower',
                episode_total: 10,
                communityRating: 89.0,
            }, { provider: 'tmdb', id: '95396' });

            const added = Object.keys(result.values)
                .filter((key) => !before.has(key) && key !== SOURCE_SNAPSHOT_FIELD);

            expect(added).toEqual([]);
        });

        it('merges refreshed TV seasons into season-data without a tv_parts sibling or lost progress', () => {
            // IntegrationService emits TV seasons under `tv_parts`. With no alias to
            // `season-data`, a refresh appended a whole second season list to the note.
            const current: Record<string, unknown> = {
                type: 'tv',
                title: 'Silo',
                'season-data': [
                    { id: 'season-87578', kind: 'season', title: 'Season 1', 'season-number': 1, 'episode-current': 10, episodes: 10, status: 'completed' },
                    { id: 'season-153476', kind: 'season', title: 'Season 2', 'season-number': 2, 'episode-current': 4, episodes: 10, status: 'watching' },
                ],
            };

            const result = synchronizeProviderMetadata(current, {
                name: 'Silo',
                tv_parts: [
                    { id: 'season-196076', kind: 'season', title: 'Season 1', 'season-number': 1, 'episode-current': 0, episodes: 10, status: 'planned' },
                    { id: 'season-404198', kind: 'season', title: 'Season 2', 'season-number': 2, 'episode-current': 0, episodes: 10, status: 'planned' },
                    { id: 'season-500001', kind: 'season', title: 'Season 3', 'season-number': 3, 'episode-current': 0, episodes: 10, status: 'planned' },
                ],
            }, { provider: 'tmdb', id: '125988' });

            expect(result.values).not.toHaveProperty('tv_parts');
            const seasons = result.values['season-data'] as Array<Record<string, unknown>>;
            expect(seasons).toHaveLength(3);
            expect(seasons[0]).toMatchObject({ id: 'season-87578', 'episode-current': 10, status: 'completed' });
            expect(seasons[1]).toMatchObject({ id: 'season-153476', 'episode-current': 4, status: 'watching' });
            expect(seasons[2]).toMatchObject({ 'season-number': 3, episodes: 10 });
        });

        it('writes no duplicate legacy properties when refreshing a migrated book', () => {
            const current: Record<string, unknown> = {
                type: 'book',
                title: 'Dune',
                'poster-b': 'https://cdn.example/dune-wide.jpg',
                synopsis: 'Spice and sandworms.',
                author: ['Frank Herbert'],
                publisher: 'Chilton Books',
                'page-total': 412,
                'chapter-total': 48,
            };
            const before = new Set(Object.keys(current));

            const result = synchronizeProviderMetadata(current, {
                name: 'Dune',
                poster_b: 'https://cdn.example/dune-wide-v2.jpg',
                plot: 'Updated description.',
                authors: ['Frank Herbert'],
                publisher: 'Chilton Books',
                page_total: 604,
                chapter_total: 50,
            }, { provider: 'hardcover', id: '4242' });

            const added = Object.keys(result.values)
                .filter((key) => !before.has(key) && key !== SOURCE_SNAPSHOT_FIELD);

            expect(added).toEqual([]);
        });

    });

    describe('book series alias', () => {
        it('maps bookSeries to the series frontmatter key', () => {
            const current: Record<string, unknown> = {
                type: 'book',
                title: 'The Way of Kings',
                poster: 'https://img.example/wok.jpg',
                author: 'Brandon Sanderson',
                status: 'planned',
            };
            const incoming: Record<string, unknown> = {
                name: 'The Way of Kings',
                poster: 'https://img.example/wok.jpg',
                bookSeries: 'The Stormlight Archive',
                seriesPosition: 1,
            };
            const source = { provider: 'hardcover', id: '42' };

            const result = mergeProviderMetadata(current, incoming, source);

            expect(result.values.series).toBe('The Stormlight Archive');
            expect(result.values['series-position']).toBe(1);
            // The provider key should not appear in the output — only the alias.
            expect(result.values).not.toHaveProperty('bookSeries');
            expect(result.values).not.toHaveProperty('seriesPosition');
        });

        it('preserves existing series value when provider sends the same', () => {
            const current: Record<string, unknown> = {
                type: 'book',
                title: 'The Way of Kings',
                series: 'The Stormlight Archive',
                'series-position': 1,
                status: 'reading',
            };
            const incoming: Record<string, unknown> = {
                name: 'The Way of Kings',
                bookSeries: 'The Stormlight Archive',
                seriesPosition: 1,
            };
            const source = { provider: 'hardcover', id: '42' };

            const result = synchronizeProviderMetadata(current, incoming, source);

            expect(result.values.series).toBe('The Stormlight Archive');
            expect(result.values['series-position']).toBe(1);
            expect(result.values.status).toBe('reading');
        });
    });
});
