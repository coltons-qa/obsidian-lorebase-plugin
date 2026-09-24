import { describe, expect, it } from 'vitest';
import { readRelatedMediaLinks } from '../src/services/media/parsers';

describe('readRelatedMediaLinks', () => {
    const link = { type: 'book', path: 'Library/Dune.md', title: 'Dune' };

    it('reads the kebab-case key written by games, movies, TV and books', () => {
        expect(readRelatedMediaLinks({ 'related-media': [link] })).toEqual([link]);
    });

    it('reads the legacy key still written by anime', () => {
        expect(readRelatedMediaLinks({ related_media: [link] })).toEqual([link]);
    });

    it('returns nothing when neither key is present', () => {
        expect(readRelatedMediaLinks({ title: 'Dune' })).toEqual([]);
    });
});
