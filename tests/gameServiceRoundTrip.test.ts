import { describe, expect, it } from 'vitest';
import { GameService } from '../src/services/GameService';
import type { GameItem } from '../src/types';
import { createMetadataService, createMockApp, createMockFile } from './helpers/testHelpers';

/**
 * Pins GameService's reader and writer while they move onto the field registry. The
 * snapshots record behaviour from before the move; a diff means a note would read or
 * save differently.
 */
function setup(frontmatter: Record<string, unknown>) {
    const file = createMockFile('Library/Hades.md', 'Hades');
    const app = createMockApp({ [file.path]: { frontmatter } });
    app.vault.getAbstractFileByPath = () => file;
    app.fileManager.processFrontMatter = async (_file, handler) => handler(frontmatter);
    const service = new GameService(app, createMetadataService(app));
    return { service, file, frontmatter };
}

const fullNote = (): Record<string, unknown> => ({
    type: 'game',
    title: 'Hades',
    poster: 'https://cdn.example/hades.jpg',
    'poster-b': 'https://cdn.example/hades-wide.jpg',
    synopsis: 'Escape the underworld.',
    series: 'Hades',
    genres: ['Roguelike', 'Action'],
    platforms: ['PC', 'Switch'],
    year: 2020,
    released: '2020-09-17',
    author: ['Supergiant Games'],
    publishers: ['Supergiant Games'],
    'user-rating': 7,
    'community-rating': 93.4,
    'community-votes': 1200,
    'community-rating-provider': 'IGDB',
    status: 'completed',
    favorite: true,
    owned: 'digital',
    count: 2,
    repeatable: true,
    'my-platform': 'steam',
    'integration-provider': 'igdb',
    'integration-id': '113112',
    url: 'https://www.igdb.com/games/hades',
    'steam-app-id': '1145360',
    started: '2020-10-01',
    finished: '2020-11-15',
    tags: ['favorite-genre'],
    'related-media': [{ type: 'book', path: 'Library/Dune.md', title: 'Dune' }],
    dlc: [{ id: '1', provider: 'steam', title: 'Soundtrack', image: 'https://cdn.example/ost.jpg', url: null, 'user-rating': 6, owned: true }],
});

describe('GameService round trip', () => {
    it('reads a fully populated note', () => {
        const { service, file } = setup(fullNote());
        const game = service.parseGameFromCache(file);
        expect(game).toMatchSnapshot();
    });

    it('writes every editable field, clearing legacy spellings', async () => {
        const note = {
            ...fullNote(),
            // Legacy spellings a note might still carry beside the canonical keys.
            name: 'Old Hades',
            plot: 'Old description.',
            gameSeries: 'Old series',
            developers: ['Old Dev'],
            userRating: 3,
            communityRating: 50,
            integration_provider: 'steam',
            steamAppId: '1',
            related_media: [],
        };
        const { service, file, frontmatter } = setup(note);
        const game = service.parseGameFromCache(file) as GameItem;

        await service.updateGame(game, {
            displayName: 'Hades II',
            description: 'Beyond the underworld.',
            series: 'Hades',
            genres: ['Roguelike', 'Action', 'Mythology'],
            platforms: ['PC', 'Switch', 'PS5'],
            tags: ['#Replay'],
            year: 2025,
            releaseDate: '2025-09-25',
            started: '2025-09-26',
            finished: '2025-10-30',
            developer: 'Supergiant Games, Supergiant',
            publisher: 'Supergiant Games, Supergiant',
            userRating: 6,
            favorite: false,
            status: 'playing',
            owned: 'physical',
            count: 3,
            repeatable: false,
            myPlatform: 'switch',
            sourceUrl: 'https://www.igdb.com/games/hades-ii',
            integrationProvider: 'igdb',
            integrationId: '264466',
            steamAppId: '1145350',
            communityRating: 91,
            communityVotes: 400,
            communityRatingProvider: 'IGDB',
            relatedMedia: [],
        });

        expect(frontmatter).toMatchSnapshot();
    });

    it('writes single values to the canonical key on a note that lacks it', async () => {
        // The singular/plural helpers wrote `publisher` for one value and `releaseDate`
        // for a note without `released`; the reader reads neither, so the edit vanished.
        const { service, file, frontmatter } = setup({ type: 'game', title: 'Hades' });
        const game = service.parseGameFromCache(file) as GameItem;

        await service.updateGame(game, { publisher: 'Supergiant Games', releaseDate: '2020-09-17' });

        expect(frontmatter.publishers).toEqual(['Supergiant Games']);
        expect(frontmatter.released).toBe('2020-09-17');
        expect(frontmatter).not.toHaveProperty('publisher');
        expect(frontmatter).not.toHaveProperty('releaseDate');
        const reread = service.parseGameFromCache(file) as GameItem;
        expect(reread.publisher).toBe('Supergiant Games');
        expect(reread.releaseDate).toBe('2020-09-17');
    });
});
