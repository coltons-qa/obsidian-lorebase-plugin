import { describe, expect, it } from 'vitest';
import { createRatingDistribution, MAX_USER_RATING, RATING_CONFIG, RATING_EMOJI } from '../src/constants';
import { parseUserRating } from '../src/services/media/parsers';
import { GameService } from '../src/services/GameService';
import { AnimeService } from '../src/services/AnimeService';
import type { AnimeItem, GameItem, UserRatingValue } from '../src/types';
import { createMockApp, createMetadataService } from './helpers/testHelpers';
import { t } from '../src/localization';

describe('user rating scale', () => {
    it('uses a seven point scale', () => {
        expect(MAX_USER_RATING).toBe(7);
    });

    it('accepts every rung of the scale and rejects values outside it', () => {
        for (let value = 1; value <= MAX_USER_RATING; value++) {
            expect(parseUserRating(value)).toBe(value);
            expect(parseUserRating(String(value))).toBe(value);
        }
        expect(parseUserRating(0)).toBeNull();
        expect(parseUserRating(MAX_USER_RATING + 1)).toBeNull();
        expect(parseUserRating('')).toBeNull();
        expect(parseUserRating(null)).toBeNull();
    });

    it('configures exactly one entry per rung, highest first', () => {
        expect(RATING_CONFIG).toHaveLength(MAX_USER_RATING);
        expect(RATING_CONFIG.map((entry) => entry.value)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    });

    it('gives every rung a distinct emoji and colour', () => {
        const emojis = RATING_CONFIG.map((entry) => entry.emoji);
        const colors = RATING_CONFIG.map((entry) => entry.color);
        expect(new Set(emojis).size).toBe(MAX_USER_RATING);
        expect(new Set(colors).size).toBe(MAX_USER_RATING);
    });

    it('resolves a real label for every rung', () => {
        for (const entry of RATING_CONFIG) {
            const label = t(entry.labelKey);
            // A missing translation falls back to the key itself.
            expect(label).not.toBe(entry.labelKey);
            expect(label.length).toBeGreaterThan(0);
        }
        expect(RATING_CONFIG.map((entry) => t(entry.labelKey))).toEqual([
            'Masterpiece', 'Excellent', 'Good', 'Passable', 'Bad', 'Atrocious', 'Evil',
        ]);
    });

    it('keeps the emoji lookup in sync with the config', () => {
        for (const entry of RATING_CONFIG) {
            expect(RATING_EMOJI[entry.value]).toBe(entry.emoji);
        }
        expect(Object.keys(RATING_EMOJI)).toHaveLength(MAX_USER_RATING);
    });

    it('seeds a distribution bucket for every rung', () => {
        const distribution = createRatingDistribution();
        expect(Object.keys(distribution)).toHaveLength(MAX_USER_RATING);
        for (const entry of RATING_CONFIG) {
            expect(distribution[entry.value]).toBe(0);
        }
    });
});

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
