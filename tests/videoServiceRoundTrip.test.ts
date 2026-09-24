import { describe, expect, it } from 'vitest';
import { VideoService, type VideoItem } from '../src/services/VideoService';
import { createMetadataService, createMockApp, createMockFile } from './helpers/testHelpers';

/**
 * Pins VideoService's reader and writer for movies and TV while they move onto the field
 * registry. The snapshots record behaviour from before the move; a diff means a note
 * would read or save differently.
 */
function setup(kind: 'movie' | 'tv', frontmatter: Record<string, unknown>) {
    const file = createMockFile('Library/Severance.md', 'Severance');
    const app = createMockApp({ [file.path]: { frontmatter } });
    app.vault.getAbstractFileByPath = () => file;
    app.fileManager.processFrontMatter = async (_file, handler) => handler(frontmatter);
    const service = new VideoService(app, kind, 'Library', createMetadataService(app));
    return { service, file, frontmatter };
}

const commonNote = (type: 'movie' | 'tv'): Record<string, unknown> => ({
    type,
    title: 'Severance',
    poster: 'https://cdn.example/severance.jpg',
    'poster-b': 'https://cdn.example/severance-wide.jpg',
    synopsis: 'Work life balance, literally.',
    genres: ['Drama', 'Mystery'],
    year: 2022,
    released: '2022-02-18',
    runtime: '55 min',
    author: ['Dan Erickson'],
    cast: ['Adam Scott', 'Britt Lower'],
    rating: 8.7,
    'user-rating': 7,
    'community-rating': 87,
    'community-votes': 3100,
    'community-rating-provider': 'TMDB',
    status: 'watching',
    favorite: true,
    owned: 'digital',
    count: 1,
    repeatable: true,
    'integration-provider': 'tmdb',
    'integration-id': '95396',
    url: 'https://www.themoviedb.org/tv/95396',
    started: '2022-03-01',
    finished: '2022-04-08',
    tags: ['rewatch'],
    'related-media': [{ type: 'book', path: 'Library/Dune.md', title: 'Dune' }],
});

const tvNote = (): Record<string, unknown> => ({
    ...commonNote('tv'),
    seasons: 2,
    'episode-current': 4,
    episodes: 10,
    'season-id-current': 'season-2',
    'season-current': 2,
    'season-data': [
        { id: 'season-1', kind: 'season', title: 'Season 1', 'season-number': 1, 'episode-current': 9, episodes: 9, status: 'completed' },
        { id: 'season-2', kind: 'season', title: 'Season 2', 'season-number': 2, 'episode-current': 4, episodes: 10, status: 'watching' },
    ],
    networks: ['Apple TV'],
});

const legacyKeys = {
    name: 'Old Title',
    plot: 'Old description.',
    image_b: 'https://cdn.example/old-wide.jpg',
    genre: ['Old'],
    directors: ['Old Director'],
    actors: ['Old Actor'],
    userRating: 3,
    rating_user: 2,
    communityRating: 50,
    integration_provider: 'omdb',
    related_media: [],
    source_url: 'https://old.example',
    release_date: '2000-01-01',
};

const edits = {
    displayName: 'Severance II',
    description: 'Back to Lumon.',
    horizontalImageUrl: 'https://cdn.example/new-wide.jpg',
    genres: ['Drama', 'Sci-Fi'],
    tags: ['#Rewatch', 'favorite'],
    rating: '8.9',
    status: 'completed' as const,
    userRating: 6 as const,
    favorite: false,
    sourceUrl: 'https://www.themoviedb.org/tv/95396-severance',
    started: '2025-01-17',
    finished: '2025-03-21',
    releaseDate: '2025-01-17',
    runtime: '52 min',
    author: ['Dan Erickson', 'Ben Stiller'],
    actors: 'Adam Scott, Britt Lower, Zach Cherry',
    owned: 'physical',
    count: 2,
    repeatable: false,
    integrationProvider: 'tmdb',
    integrationId: '95396',
    communityRating: 88,
    communityVotes: 3300,
    communityRatingProvider: 'TMDB',
    relatedMedia: [],
};

describe('VideoService round trip', () => {
    it('reads a fully populated movie note', () => {
        const { service, file } = setup('movie', commonNote('movie'));
        expect(service.parseFromCache(file)).toMatchSnapshot();
    });

    it('reads a fully populated TV note', () => {
        const { service, file } = setup('tv', tvNote());
        expect(service.parseFromCache(file)).toMatchSnapshot();
    });

    it('writes every editable movie field, clearing legacy spellings', async () => {
        const { service, file, frontmatter } = setup('movie', { ...commonNote('movie'), ...legacyKeys, movie_parts: [] });
        const item = service.parseFromCache(file) as VideoItem;
        await service.updateItem(item, { ...edits, parts: [], activePartId: null });
        expect(frontmatter).toMatchSnapshot();
    });

    it('writes every editable TV field, clearing legacy spellings', async () => {
        const note = { ...tvNote(), ...legacyKeys, network: ['Old Network'], episode_current: 1, episode_total: 1, season_current: 1, active_part_id: 'x' };
        const { service, file, frontmatter } = setup('tv', note);
        const item = service.parseFromCache(file) as VideoItem;
        await service.updateItem(item, {
            ...edits,
            seasons: 3,
            networks: ['Apple TV', 'Apple TV+'],
            episodeCurrent: 10,
            episodeTotal: 10,
            activePartId: 'season-2',
            parts: item.type === 'tv' ? item.parts : [],
        });
        expect(frontmatter).toMatchSnapshot();
    });

    it('writes the integration source to its kebab keys and clears the legacy ones', async () => {
        // VideoService used to ignore integrationProvider and integrationId, unlike
        // GameService, so a source change sent through a save was dropped.
        const { service, file, frontmatter } = setup('movie', {
            type: 'movie',
            title: 'Dune',
            integration_provider: 'omdb',
            integration_id: 'tt0087182',
        });
        const item = service.parseFromCache(file) as VideoItem;

        await service.updateItem(item, { integrationProvider: 'tmdb', integrationId: '438631' });

        expect(frontmatter['integration-provider']).toBe('tmdb');
        expect(frontmatter['integration-id']).toBe('438631');
        expect(frontmatter).not.toHaveProperty('integration_provider');
        expect(frontmatter).not.toHaveProperty('integration_id');
    });
});
