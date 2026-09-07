import { describe, expect, it } from 'vitest';
import { MAX_USER_RATING, RATING_CONFIG } from '../src/constants';
import { GameService } from '../src/services/GameService';
import { AnimeService } from '../src/services/AnimeService';
import type { AnimeItem, GameItem, UserRatingValue } from '../src/types';
import { createMockApp, createMetadataService } from './helpers/testHelpers';

/**
 * Stats builders used to seed ratingDistribution from a {1..5} literal and
 * increment with a bare ++, so a rating of 6 or 7 incremented an absent key
 * and stored NaN. The stats modal reads that with `|| 0`, so the affected
 * items silently disappeared from the chart while still counting toward the
 * average.
 */
describe('rating distribution covers the whole scale', () => {
    const makeGame = (rating: UserRatingValue): GameItem => ({
        userRating: rating,
        status: 'completed',
        gameSeries: '',
    } as GameItem);

    const makeAnime = (rating: UserRatingValue): AnimeItem => ({
        userRating: rating,
        status: 'completed',
    } as AnimeItem);

    it('counts every rung for games, including the two new top ratings', () => {
        const app = createMockApp({});
        const service = new GameService(app, createMetadataService(app));
        const games = RATING_CONFIG.map((entry) => makeGame(entry.value));

        const stats = service.calculateStats(games);

        for (const entry of RATING_CONFIG) {
            expect(stats.ratingDistribution[entry.value]).toBe(1);
        }
        const counted = Object.values(stats.ratingDistribution).reduce((sum, n) => sum + n, 0);
        expect(counted).toBe(MAX_USER_RATING);
        expect(Number.isNaN(counted)).toBe(false);
    });

    it('counts every rung for anime, including the two new top ratings', () => {
        const app = createMockApp({});
        const service = new AnimeService(app, createMetadataService(app));
        const items = RATING_CONFIG.map((entry) => makeAnime(entry.value));

        const stats = service.calculateStats(items);

        for (const entry of RATING_CONFIG) {
            expect(stats.ratingDistribution[entry.value]).toBe(1);
        }
        expect(Number.isNaN(Object.values(stats.ratingDistribution).reduce((sum, n) => sum + n, 0))).toBe(false);
    });
});
