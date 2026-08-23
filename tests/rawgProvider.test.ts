import { describe, expect, it } from 'vitest';
import { getRawgDetails, searchRawg } from '../src/services/integrations/providers/rawg';
import type { JsonFetcher } from '../src/services/integrations/providers/common';

describe('RAWG provider', () => {
    it('maps search results, credentials, paging, and has-next metadata', async () => {
        let requestedUrl = '';
        const fetchJson: JsonFetcher = async (url) => {
            requestedUrl = url;
            return {
                next: 'https://api.rawg.io/api/games?page=3',
                results: [{
                    id: 3498,
                    name: 'Grand Theft Auto V',
                    released: '2013-09-17',
                    background_image: 'https://cdn.example/gta-v.jpg',
                }],
            };
        };

        const results = await searchRawg(fetchJson, 'gta', 'secret key', { page: 2, pageSize: 5 });
        const url = new URL(requestedUrl);

        expect(url.origin + url.pathname).toBe('https://api.rawg.io/api/games');
        expect(url.searchParams.get('search')).toBe('gta');
        expect(url.searchParams.get('key')).toBe('secret key');
        expect(url.searchParams.get('page')).toBe('2');
        expect(url.searchParams.get('page_size')).toBe('5');
        expect(results[0]).toMatchObject({
            id: '3498',
            title: 'Grand Theft Auto V',
            provider: 'rawg',
            year: '2013',
            image: 'https://cdn.example/gta-v.jpg',
        });
        expect((results as typeof results & { hasNext?: boolean }).hasNext).toBe(true);
    });

    it('maps complete game metadata and strips HTML descriptions', async () => {
        const fetchJson: JsonFetcher = async () => ({
            id: 3498,
            slug: 'grand-theft-auto-v',
            name: 'Grand Theft Auto V',
            description: '<p>Open-world <b>action</b>.</p>',
            background_image: 'https://cdn.example/gta-v.jpg',
            rating: 4.47,
            ratings_count: 7200,
            metacritic: 92,
            released: '2013-09-17',
            genres: [{ name: 'Action' }],
            platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'PlayStation 5' } }],
            developers: [{ name: 'Rockstar North' }],
            publishers: [{ name: 'Rockstar Games' }],
        });

        const details = await getRawgDetails(fetchJson, '3498', 'key');

        expect(details).toMatchObject({
            kind: 'game',
            name: 'Grand Theft Auto V',
            description: 'Open-world action.',
            genres: ['Action'],
            platforms: ['PC', 'PlayStation 5'],
            developers: ['Rockstar North'],
            publishers: ['Rockstar Games'],
            communityRating: '4.47',
            communityVotes: '7200',
            year: '2013',
            url: 'https://rawg.io/games/grand-theft-auto-v',
        });
    });
});
