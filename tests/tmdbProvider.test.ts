import { describe, expect, it } from 'vitest';
import { getTmdbDetails, searchTmdb } from '../src/services/integrations/providers/tmdb';
import type { JsonFetcher } from '../src/services/integrations/providers/common';

describe('TMDB provider', () => {
    it('searches movies with TMDB metadata', async () => {
        const fetchJson: JsonFetcher = async () => ({
            results: [
                {
                    id: 550,
                    title: 'Fight Club',
                    release_date: '1999-10-15',
                    poster_path: '/poster.jpg',
                },
            ],
        });

        const results = await searchTmdb(fetchJson, 'fight club', 'key', { kind: 'movies' });

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            id: '550',
            title: 'Fight Club',
            provider: 'tmdb',
            year: '1999',
            format: 'Movie / TMDB',
            image: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        });
    });

    it('searches series separately from movies', async () => {
        const fetchJson: JsonFetcher = async (url) => {
            expect(url).toContain('/search/tv');
            return {
                results: [
                    {
                        id: 76479,
                        name: 'The Boys',
                        first_air_date: '2019-07-25',
                        poster_path: '/boys.jpg',
                    },
                ],
            };
        };

        const results = await searchTmdb(fetchJson, 'the boys', 'key', { kind: 'series' });

        expect(results[0]).toMatchObject({
            id: '76479',
            title: 'The Boys',
            format: 'TV / TMDB',
        });
    });

    it('builds TV parts from TMDB seasons', async () => {
        const fetchJson: JsonFetcher = async (url) => {
            expect(url).toContain('/tv/76479');
            return {
                id: 76479,
                name: 'The Boys',
                overview: 'Superhero satire.',
                first_air_date: '2019-07-25',
                poster_path: '/poster.jpg',
                backdrop_path: '/backdrop.jpg',
                vote_average: 8.4,
                genres: [{ name: 'Drama' }],
                networks: [{ name: 'Prime Video' }],
                production_companies: [{ name: 'Amazon Studios' }],
                episode_run_time: [60],
                seasons: [
                    { id: 1, season_number: 0, name: 'Specials', episode_count: 2 },
                    { id: 2, season_number: 1, name: 'Season 1', episode_count: 8 },
                    { id: 3, season_number: 2, name: 'Season 2', episode_count: 8 },
                ],
                credits: { cast: [{ name: 'Karl Urban' }, { name: 'Jack Quaid' }] },
            };
        };

        const details = await getTmdbDetails(fetchJson, '76479', 'key', 'series');

        expect(details).toMatchObject({
            name: 'The Boys',
            year: '2019',
            runtime: '60 min',
            seasons: '2',
            episodeTotal: '16',
            networks: ['Prime Video'],
        });
        expect(details?.parts).toHaveLength(2);
        expect(details?.parts?.[0]).toMatchObject({
            kind: 'season',
            seasonNumber: 1,
            episodeTotal: 8,
        });
    });

    it('populates director from credits.crew for movies', async () => {
        const fetchJson: JsonFetcher = async () => ({
            id: 329865,
            title: 'Arrival',
            overview: 'Linguistics and time.',
            release_date: '2016-11-11',
            poster_path: '/arrival.jpg',
            vote_average: 7.9,
            genres: [{ name: 'Drama' }, { name: 'Science Fiction' }],
            credits: {
                cast: [{ name: 'Amy Adams' }, { name: 'Jeremy Renner' }],
                crew: [
                    { name: 'Denis Villeneuve', job: 'Director' },
                    { name: 'Bradford Young', job: 'Director of Photography' },
                    { name: 'Joe Walker', job: 'Editor' },
                ],
            },
        });

        const details = await getTmdbDetails(fetchJson, '329865', 'key', 'movies');

        expect(details?.director).toBe('Denis Villeneuve');
    });

    it('joins multiple directors for movies with co-directors', async () => {
        const fetchJson: JsonFetcher = async () => ({
            id: 603,
            title: 'The Matrix',
            overview: 'Red pill or blue pill.',
            release_date: '1999-03-31',
            poster_path: '/matrix.jpg',
            vote_average: 8.7,
            genres: [],
            credits: {
                cast: [{ name: 'Keanu Reeves' }],
                crew: [
                    { name: 'Lana Wachowski', job: 'Director' },
                    { name: 'Lilly Wachowski', job: 'Director' },
                ],
            },
        });

        const details = await getTmdbDetails(fetchJson, '603', 'key', 'movies');

        expect(details?.director).toBe('Lana Wachowski, Lilly Wachowski');
    });

    it('populates director from created_by for TV series', async () => {
        const fetchJson: JsonFetcher = async () => ({
            id: 95396,
            name: 'Severance',
            overview: 'Work life balance, literally.',
            first_air_date: '2022-02-18',
            poster_path: '/severance.jpg',
            vote_average: 8.4,
            genres: [{ name: 'Drama' }],
            created_by: [{ name: 'Dan Erickson' }],
            seasons: [],
            networks: [],
            credits: {
                cast: [{ name: 'Adam Scott' }],
                crew: [{ name: 'Someone', job: 'Director' }],
            },
        });

        const details = await getTmdbDetails(fetchJson, '95396', 'key', 'series');

        expect(details?.director).toBe('Dan Erickson');
    });

    it('returns empty director when credits.crew has no Director entry', async () => {
        const fetchJson: JsonFetcher = async () => ({
            id: 999,
            title: 'Unknown Film',
            overview: '',
            release_date: '',
            poster_path: '',
            vote_average: 0,
            genres: [],
            credits: {
                cast: [],
                crew: [{ name: 'Someone', job: 'Producer' }],
            },
        });

        const details = await getTmdbDetails(fetchJson, '999', 'key', 'movies');

        expect(details?.director).toBe('');
    });
});
