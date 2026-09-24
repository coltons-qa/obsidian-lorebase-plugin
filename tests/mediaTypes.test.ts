import { describe, expect, it } from 'vitest';
import { getMediaTypeInfo, isMediaType, kindToMediaType, MEDIA_TYPES, mediaTypeToKind } from '../src/media/mediaTypes';

describe('media type table', () => {
    it('lists the six types in their established order', () => {
        expect(MEDIA_TYPES.map((info) => info.type)).toEqual(['game', 'anime', 'movie', 'tv', 'book', 'manga']);
    });

    it('maps types to settings keys and back', () => {
        expect(MEDIA_TYPES.map((info) => mediaTypeToKind(info.type))).toEqual(['games', 'anime', 'movies', 'tv', 'books', 'manga']);
        expect(MEDIA_TYPES.map((info) => kindToMediaType(info.kind))).toEqual(['game', 'anime', 'movie', 'tv', 'book', 'manga']);
    });

    it('rejects anything that is not a current media type', () => {
        expect(isMediaType('series')).toBe(false);
        expect(isMediaType('room')).toBe(false);
        expect(mediaTypeToKind('series')).toBeNull();
    });

    it('labels each type with its plural settings name', () => {
        expect(getMediaTypeInfo('tv').label).toBe('settingsTv');
        expect(getMediaTypeInfo('book').label).toBe('settingsBooks');
    });
});
