import { describe, expect, it } from 'vitest';
import { ReadingService } from '../src/services/ReadingService';
import type { ReadingItem } from '../src/types';
import { createMetadataService, createMockApp, createMockFile } from './helpers/testHelpers';

/**
 * Pins ReadingService's reader and writer for books (and manga, which shares the code)
 * while they move onto the field registry. The snapshots record behaviour from before the
 * move; a diff means a note would read or save differently.
 */
function setup(kind: 'book' | 'manga', frontmatter: Record<string, unknown>) {
    const file = createMockFile('Library/Dune.md', 'Dune');
    // Fixed timestamps: the reader copies them into the item, and snapshots must not drift.
    file.stat = { ctime: 1700000000000, mtime: 1700000000000, size: 0 };
    const app = createMockApp({ [file.path]: { frontmatter } });
    app.vault.getAbstractFileByPath = () => file;
    app.fileManager.processFrontMatter = async (_file, handler) => handler(frontmatter);
    const service = new ReadingService(app, kind, 'Library', createMetadataService(app));
    return { service, file, frontmatter };
}

const bookNote = (): Record<string, unknown> => ({
    type: 'book',
    title: 'Dune',
    poster: 'https://cdn.example/dune.jpg',
    'poster-b': 'https://cdn.example/dune-wide.jpg',
    synopsis: 'Spice and sandworms.',
    series: 'Dune',
    'series-position': 1,
    author: ['Frank Herbert'],
    illustrator: 'John Schoenherr',
    publisher: 'Chilton Books',
    genres: ['Science Fiction'],
    tags: ['classic'],
    year: 1965,
    released: '1965-08-01',
    'page-current': 120,
    'page-total': 412,
    'chapter-current': 10,
    'chapter-total': 48,
    'user-rating': 7,
    'community-rating': 91.3,
    'community-votes': 4100,
    'community-rating-provider': 'Hardcover',
    status: 'watching',
    favorite: true,
    audiobook: true,
    owned: 'physical',
    count: 2,
    repeatable: true,
    'integration-provider': 'hardcover',
    'integration-id': '4242',
    url: 'https://hardcover.app/books/dune',
    started: '2024-01-02',
    finished: '2024-02-03',
    cm_poster: 'https://apple.example/dune.jpg',
    'related-media': [{ type: 'movie', path: 'Library/Dune Movie.md', title: 'Dune' }],
});

const mangaNote = (): Record<string, unknown> => ({
    type: 'manga',
    title: 'Berserk',
    poster: 'https://cdn.example/berserk.jpg',
    synopsis: 'Guts.',
    authors: ['Kentaro Miura'],
    artists: ['Kentaro Miura'],
    genres: ['Dark Fantasy'],
    status: 'watching',
    'user-rating': 7,
    chapter_current: 10,
    chapter_total: 374,
    volume_current: 1,
    volume_total: 41,
    'integration-provider': 'mangaupdates',
    'integration-id': '1',
});

describe('ReadingService round trip', () => {
    it('reads a fully populated book note', () => {
        const { service, file } = setup('book', bookNote());
        expect(service.parseFromCache(file)).toMatchSnapshot();
    });

    it('reads a manga note', () => {
        const { service, file } = setup('manga', mangaNote());
        expect(service.parseFromCache(file)).toMatchSnapshot();
    });

    it('writes every editable book field, clearing legacy spellings', async () => {
        const note = {
            ...bookNote(),
            name: 'Old Dune',
            plot: 'Old description.',
            poster_b: 'https://cdn.example/old-wide.jpg',
            authors: ['Old Author'],
            genre: ['Old'],
            userRating: 2,
            communityRating: 50,
            integration_provider: 'googlebooks',
            related_media: [],
            source_url: 'https://old.example',
            page_total: 1,
            chapter_current: 1,
        };
        const { service, file, frontmatter } = setup('book', note);
        const item = service.parseFromCache(file) as ReadingItem;

        await service.updateItem(item, {
            displayName: 'Dune Messiah',
            description: 'The fall of Paul.',
            horizontalImageUrl: 'https://cdn.example/messiah-wide.jpg',
            genres: ['Science Fiction', 'Politics'],
            tags: ['#Classic', 'reread'],
            status: 'paused',
            userRating: 6,
            favorite: false,
            owned: 'digital',
            count: 3,
            repeatable: false,
            sourceUrl: 'https://hardcover.app/books/dune-messiah',
            started: '2024-03-01',
            finished: '2024-03-20',
            integrationProvider: 'hardcover',
            integrationId: '4343',
            communityRating: 88,
            communityVotes: 2000,
            communityRatingProvider: 'Hardcover',
            relatedMedia: [],
            authors: ['Frank Herbert'],
            series: 'Dune',
            seriesPosition: 2,
            audiobook: false,
            illustrator: 'Bruce Pennington',
            publisher: 'Putnam',
            releaseDate: '1969-10-15',
            pageCurrent: 100,
            pageTotal: 256,
            chapterCurrent: 5,
            chapterTotal: 20,
        } as Partial<ReadingItem> & Record<string, unknown>);

        expect(frontmatter).toMatchSnapshot();
    });

    it('writes manga fields as before', async () => {
        const { service, file, frontmatter } = setup('manga', mangaNote());
        const item = service.parseFromCache(file) as ReadingItem;

        await service.updateItem(item, {
            displayName: 'Berserk Deluxe',
            description: 'Guts, bigger.',
            authors: 'Kentaro Miura, Kouji Mori',
            artists: 'Kentaro Miura',
            chapterCurrent: 20,
            volumeTotal: 42,
            userRating: 6,
            favorite: true,
        } as Partial<ReadingItem> & Record<string, unknown>);

        expect(frontmatter).toMatchSnapshot();
    });

    it('keeps several publishers under the key the book reader reads', async () => {
        // Two publishers were written as `publishers`, which the book reader ignores; a
        // comma in one publisher's name ("Little, Brown") was enough to trigger it.
        const { service, file, frontmatter } = setup('book', { type: 'book', title: 'Midnight Sun', publisher: 'Little' });
        const item = service.parseFromCache(file) as ReadingItem;

        await service.updateItem(item, { publisher: 'Little, Brown Books for Young Readers' } as Partial<ReadingItem>);

        expect(frontmatter.publisher).toEqual(['Little', 'Brown Books for Young Readers']);
        expect(frontmatter).not.toHaveProperty('publishers');
        const reread = service.parseFromCache(file);
        expect(reread?.type === 'book' ? reread.publisher : null).toBe('Little, Brown Books for Young Readers');
    });
});
