import { describe, expect, it } from 'vitest';
import { customizationFallbackKey, customizationKey, type CustomizationSetting } from '../src/settings/customizationKeys';
import { DEFAULT_SETTINGS } from '../src/constants';
import type { MediaKind } from '../src/services/integrations/types';

describe('customizationKey', () => {
    const kinds: MediaKind[] = ['games', 'anime', 'movies', 'tv', 'books', 'manga'];
    const settings: CustomizationSetting[] = ['descriptionLines', 'overlayTextLayout', 'overlayTextVisibility', 'badges'];

    it('names a real setting for every kind, orientation and setting', () => {
        for (const kind of kinds) {
            for (const orientation of ['vertical', 'horizontal'] as const) {
                for (const setting of settings) {
                    expect(DEFAULT_SETTINGS).toHaveProperty(customizationKey(kind, orientation, setting));
                }
            }
        }
    });

    it('uses bare names for games and prefixed names otherwise', () => {
        expect(customizationKey('games', 'vertical', 'badges')).toBe('badges');
        expect(customizationKey('games', 'horizontal', 'badges')).toBe('horizontalBadges');
        expect(customizationKey('movies', 'vertical', 'overlayTextLayout')).toBe('movieOverlayTextLayout');
        expect(customizationKey('books', 'horizontal', 'descriptionLines')).toBe('bookHorizontalDescriptionLines');
    });

    it('falls back to games, games horizontal to games vertical, and anime to its own vertical', () => {
        expect(customizationFallbackKey('games', 'vertical', 'badges')).toBeUndefined();
        expect(customizationFallbackKey('games', 'horizontal', 'badges')).toBe('badges');
        expect(customizationFallbackKey('games', 'horizontal', 'overlayTextLayout')).toBeUndefined();
        expect(customizationFallbackKey('movies', 'horizontal', 'overlayTextLayout')).toBe('horizontalOverlayTextLayout');
        expect(customizationFallbackKey('anime', 'horizontal', 'badges')).toBe('animeBadges');
        expect(customizationFallbackKey('anime', 'horizontal', 'overlayTextVisibility')).toBe('animeOverlayTextVisibility');
        expect(customizationFallbackKey('anime', 'horizontal', 'descriptionLines')).toBe('horizontalDescriptionLines');
    });
});
