/**
 * LOREBASE - Card customization setting names
 *
 * Card customization is stored per media kind and card orientation under names like
 * `badges`, `horizontalBadges`, `movieBadges`, `movieHorizontalBadges`. Games use the
 * bare name; every other kind prefixes it. This computes the name instead of each
 * getter and setter repeating a six-way chain.
 */

import type { LorebaseSettings } from '../types';
import type { MediaKind } from '../services/integrations/types';

export type CardOrientationKey = 'vertical' | 'horizontal';
export type CustomizationSetting = 'descriptionLines' | 'overlayTextLayout' | 'overlayTextVisibility' | 'badges';

const PREFIX: Record<MediaKind, string> = {
    games: '',
    anime: 'anime',
    movies: 'movie',
    tv: 'tv',
    books: 'book',
    manga: 'manga',
};

/** The settings property holding one customization value for a kind and orientation. */
export function customizationKey(
    kind: MediaKind,
    orientation: CardOrientationKey,
    setting: CustomizationSetting
): keyof LorebaseSettings {
    const capitalized = setting.charAt(0).toUpperCase() + setting.slice(1);
    const prefix = PREFIX[kind];
    if (!prefix) {
        return (orientation === 'horizontal' ? `horizontal${capitalized}` : setting) as keyof LorebaseSettings;
    }
    return `${prefix}${orientation === 'horizontal' ? 'Horizontal' : ''}${capitalized}` as keyof LorebaseSettings;
}

/**
 * The setting a missing value is copied from when settings load: other kinds fall back to
 * the games value for the same orientation, and games' horizontal values fall back to
 * games' vertical ones, except the text layout, which has its own horizontal default.
 * Anime's horizontal visibility and badges fall back to anime's own vertical values, as
 * they always have.
 */
export function customizationFallbackKey(
    kind: MediaKind,
    orientation: CardOrientationKey,
    setting: CustomizationSetting
): keyof LorebaseSettings | undefined {
    if (kind === 'anime' && orientation === 'horizontal' && (setting === 'overlayTextVisibility' || setting === 'badges')) {
        return customizationKey('anime', 'vertical', setting);
    }
    if (kind !== 'games') return customizationKey('games', orientation, setting);
    if (orientation === 'horizontal' && setting !== 'overlayTextLayout') return customizationKey('games', 'vertical', setting);
    return undefined;
}
