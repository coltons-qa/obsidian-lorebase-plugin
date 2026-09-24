/**
 * LOREBASE - Media type table
 *
 * One row per media type: its item `type` value, its settings/integration key (`kind`),
 * its display label and its icon. Code that needs a per-type value reads it from here
 * instead of repeating a six-branch chain, which is how a rename can miss a spot.
 */

import { t, type TranslationKey } from '../localization';
import type { MediaType } from '../types';
import type { MediaKind } from '../services/integrations/types';

export interface MediaTypeInfo {
    /** The value of a note's `type` and an item's `type`. */
    type: MediaType;
    /** The key used by settings (`settings.games`, `enabledMedia.games`) and integrations. */
    kind: MediaKind;
    /** Plural display name ("Games", "TV Series"). */
    label: TranslationKey;
    /** Lucide icon name. */
    icon: string;
}

export const MEDIA_TYPES: readonly MediaTypeInfo[] = [
    { type: 'game', kind: 'games', label: 'settingsGames', icon: 'gamepad-2' },
    { type: 'anime', kind: 'anime', label: 'settingsAnime', icon: 'clapperboard' },
    { type: 'movie', kind: 'movies', label: 'settingsMovies', icon: 'film' },
    { type: 'tv', kind: 'tv', label: 'settingsTv', icon: 'tv' },
    { type: 'book', kind: 'books', label: 'settingsBooks', icon: 'book-open' },
    { type: 'manga', kind: 'manga', label: 'settingsManga', icon: 'book-open-text' },
];

const BY_TYPE = new Map(MEDIA_TYPES.map((info) => [info.type, info]));
const BY_KIND = new Map(MEDIA_TYPES.map((info) => [info.kind, info]));

/** Type guard: true when `value` is one of the six media types. */
export function isMediaType(value: unknown): value is MediaType {
    return typeof value === 'string' && BY_TYPE.has(value as MediaType);
}

export function getMediaTypeInfo(type: MediaType): MediaTypeInfo {
    return BY_TYPE.get(type) ?? MEDIA_TYPES[0];
}

/** The settings/integration key for a media type, or null for anything else. */
export function mediaTypeToKind(type: string): MediaKind | null {
    return isMediaType(type) ? getMediaTypeInfo(type).kind : null;
}

/** The media type for a settings/integration key. */
export function kindToMediaType(kind: MediaKind): MediaType {
    return (BY_KIND.get(kind) ?? MEDIA_TYPES[0]).type;
}

/** The display label for a media type ("Games", "TV Series"). */
export function mediaTypeLabel(type: MediaType): string {
    return t(getMediaTypeInfo(type).label);
}
