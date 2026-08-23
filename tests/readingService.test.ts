import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { TFolder } from 'obsidian';
import { ReadingService } from '../src/services/ReadingService';
import type { MangaItem } from '../src/types';
import { createBaseFilter, createMetadataService, createMockApp, createMockFile } from './helpers/testHelpers';

describe('ReadingService', () => {
    it('parses book notes without type and rejects explicit mismatched types', () => {
        const bookFile = createMockFile('Books/Dune.md', 'Dune');
        const wrongFile = createMockFile('Books/Wrong.md', 'Wrong');
        const app = createMockApp({
            [bookFile.path]: {
                frontmatter: {
                    title: 'Dune',
                    authors: 'Frank Herbert',
                    publisher: 'Chilton Books',
                    released: '1965-08-01',
                    page_current: 120,
                    page_total: 412,
                    chapter_current: 8,
                    chapter_total: 20,
                    status: 'watching',
                    integration_provider: 'hardcover',
                    integration_id: '123',
                    related_media: [
                        { type: 'manga', path: 'Manga/Dune.md', title: 'Dune Manga' },
                    ],
                },
                tags: [{ tag: '#SciFi' }],
            },
            [wrongFile.path]: {
                frontmatter: {
                    type: 'manga',
                    title: 'Wrong Shelf',
                },
            },
        });

        const service = new ReadingService(app, 'book', 'Books', createMetadataService(app));
        const parsed = service.parseFromCache(bookFile);

        expect(parsed).toMatchObject({
            type: 'book',
            displayName: 'Dune',
            status: 'watching',
            pageCurrent: 120,
            pageTotal: 412,
            chapterCurrent: 8,
            chapterTotal: 20,
            publisher: 'Chilton Books',
            integrationProvider: 'hardcover',
            integrationId: '123',
        });
        expect(parsed?.authors).toEqual(['Frank Herbert']);
        expect(parsed?.tags).toContain('scifi');
        expect(parsed?.relatedMedia).toEqual([
            { type: 'manga', path: 'Manga/Dune.md', title: 'Dune Manga' },
        ]);
        expect(service.parseFromCache(wrongFile)).toBeNull();
    });

    it('parses manga parts, uses the active part, filters, sorts, and calculates stats', () => {
        const activeFile = createMockFile('Manga/Akame.md', 'Akame');
        const plannedFile = createMockFile('Manga/Berserk.md', 'Berserk');
        const app = createMockApp({
            [activeFile.path]: {
                frontmatter: {
                    type: 'manga',
                    title: 'Akame ga Kill!',
                    authors: ['Takahiro'],
                    artists: ['Tetsuya Tashiro'],
                    status: 'watching',
                    rating: 4,
                    favorite: true,
                    active_part_id: 'vol-2',
                    manga_parts: [
                        { id: 'vol-1', title: 'Volume 1', volume: 1, chapter_current: 10, chapter_total: 10, status: 'completed' },
                        { id: 'vol-2', title: 'Volume 2', volume: 2, chapter_current: 9, chapter_total: 10, status: 'watching' },
                    ],
                    volume_total: 15,
                    genres: 'Action',
                    integration_provider: 'mangadex',
                    integration_id: 'abc',
                },
            },
            [plannedFile.path]: {
                frontmatter: {
                    type: 'manga',
                    title: 'Berserk',
                    status: 'planned',
                    chapter_current: 0,
                    chapter_total: 364,
                    volume_current: 1,
                    volume_total: 41,
                    genres: ['Adult', 'Fantasy'],
                },
            },
        });

        const service = new ReadingService(app, 'manga', 'Manga', createMetadataService(app));
        const parsed = service.parseFromCache(activeFile) as MangaItem | null;
        const items = [parsed, service.parseFromCache(plannedFile)].filter((item): item is MangaItem => Boolean(item));
        const filtered = service.filterAndSort(items, { ...createBaseFilter(), statuses: ['watching'] }, 'rating', 'desc');
        const stats = service.calculateStats(items);

        expect(parsed).toMatchObject({
            type: 'manga',
            displayName: 'Akame ga Kill!',
            chapterCurrent: 9,
            chapterTotal: 10,
            volumeCurrent: 2,
            volumeTotal: 15,
            activePartId: 'vol-2',
            integrationProvider: 'mangadex',
        });
        expect(parsed?.parts).toHaveLength(2);
        expect(parsed?.artists).toEqual(['Tetsuya Tashiro']);
        expect(filtered.map((item) => item.displayName)).toEqual(['Akame ga Kill!']);
        expect(stats.total).toBe(2);
        expect(stats.watching).toBe(1);
        expect(stats.planned).toBe(1);
        expect(stats.favorite).toBe(1);
        expect(stats.avgRating).toBe(4);
    });

    it('preserves the Jikan provider and MAL id on legacy manga notes', () => {
        const file = createMockFile('Manga/Legacy.md', 'Legacy');
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    type: 'manga',
                    title: 'Legacy Manga',
                    integration_provider: 'JIKAN',
                    integration_id: 12345,
                },
            },
        });
        const service = new ReadingService(app, 'manga', 'Manga', createMetadataService(app));

        expect(service.parseFromCache(file)).toMatchObject({
            type: 'manga',
            integrationProvider: 'jikan',
            integrationId: '12345',
        });
    });

    it('normalizes progress updates, auto-completes, and serializes manga parts', async () => {
        const bookFile = createMockFile('Books/Complete.md', 'Complete');
        const mangaFile = createMockFile('Manga/Complete.md', 'Complete');
        const frontmatterByPath: Record<string, Record<string, unknown>> = {
            [bookFile.path]: {
                type: 'book',
                title: 'Complete',
                status: 'watching',
                page_total: 100,
                chapter_total: 10,
                publisher: 'Old Publisher',
                authors: ['Old Author'],
            },
            [mangaFile.path]: {
                type: 'manga',
                title: 'Complete Manga',
                status: 'watching',
                active_part_id: 'vol-1',
                authors: ['Old Author'],
                artists: ['Old Artist'],
                manga_parts: [{ id: 'vol-1', kind: 'volume', title: 'Volume 1', volume: 1, chapter_current: 0, chapter_total: 10, status: 'watching' }],
            },
        };
        const files = new Map<string, TFile>([
            [bookFile.path, bookFile],
            [mangaFile.path, mangaFile],
        ]);
        const app = {
            metadataCache: {
                getFileCache(file: TFile) {
                    return { frontmatter: frontmatterByPath[file.path] };
                },
            },
            vault: {
                getAbstractFileByPath(path: string) {
                    return files.get(path) ?? null;
                },
                getFiles() {
                    return [];
                },
                getResourcePath() {
                    return '';
                },
            },
            fileManager: {
                async processFrontMatter(file: TFile, handler: (frontmatter: Record<string, unknown>) => void) {
                    handler(frontmatterByPath[file.path]);
                },
                async trashFile() {
                    return;
                },
            },
        } as unknown as App;

        const bookService = new ReadingService(app, 'book', 'Books', createMetadataService(app));
        const mangaService = new ReadingService(app, 'manga', 'Manga', createMetadataService(app));
        const book = bookService.parseFromCache(bookFile);
        const manga = mangaService.parseFromCache(mangaFile);

        expect(book).not.toBeNull();
        expect(manga).not.toBeNull();
        await bookService.updateItem(book!, {
            // illustrator had a reader and an editor input but no writer, so the value
            // silently vanished on save. Round-tripped here to keep that shut.
            illustrator: 'Jane Illustrator',
            owned: 'physical',
            count: 2,
            repeatable: true,
            pageCurrent: 150,
            pageTotal: 100,
            chapterCurrent: 10,
            chapterTotal: 10,
            publisher: 'Tor Books, Orbit, tor books',
            authors: ['Christie Golden', 'Blizzard Writer', 'christie golden'],
            releaseDate: '25 Dec 2013',
        });
        await mangaService.updateItem(manga!, {
            chapterCurrent: 10,
            chapterTotal: 10,
            authors: ['Takahiro', 'Second Author', 'takahiro'],
            artists: ['Tetsuya Tashiro', 'Second Artist', 'tetsuya tashiro'],
            relatedMedia: [
                {
                    type: 'game',
                    path: 'Games/Complete.md',
                    title: 'Complete',
                },
            ],
        });

        expect(frontmatterByPath[bookFile.path]).toMatchObject({
            'page-current': 100,
            'page-total': 100,
            'chapter-current': 10,
            'chapter-total': 10,
            status: 'completed',
            publishers: ['Tor Books', 'Orbit'],
            author: ['Christie Golden', 'Blizzard Writer'],
            released: '2013-12-25',
        });
        expect(frontmatterByPath[bookFile.path].illustrator).toBe('Jane Illustrator');
        expect(frontmatterByPath[bookFile.path].owned).toBe('physical');
        expect(frontmatterByPath[bookFile.path].count).toBe(2);
        expect(frontmatterByPath[bookFile.path].repeatable).toBe(true);
        expect(frontmatterByPath[bookFile.path]).not.toHaveProperty('publisher');
        expect(frontmatterByPath[bookFile.path]).not.toHaveProperty('authors');
        expect(frontmatterByPath[mangaFile.path].status).toBe('completed');
        expect(frontmatterByPath[mangaFile.path].authors).toEqual(['Takahiro', 'Second Author']);
        expect(frontmatterByPath[mangaFile.path].artists).toEqual(['Tetsuya Tashiro', 'Second Artist']);
        expect(frontmatterByPath[mangaFile.path].active_part_id).toBe('vol-1');
        expect(frontmatterByPath[mangaFile.path]['related-media']).toEqual([
            {
                type: 'game',
                path: 'Games/Complete.md',
                title: 'Complete',
            },
        ]);
        expect(frontmatterByPath[mangaFile.path].manga_parts).toEqual([
            {
                id: 'vol-1',
                kind: 'volume',
                title: 'Volume 1',
                volume: 1,
                chapter_current: 10,
                chapter_total: 10,
                status: 'completed',
            },
        ]);
    });

    it('loads only notes from the configured reading folder', async () => {
        const file = createMockFile('Books/Folder Note.md', 'Folder Note');
        const folder = new TFolder('Books') as TFolder & { children: TFile[] };
        folder.children = [file];
        const app = createMockApp({
            [file.path]: {
                frontmatter: {
                    title: 'Folder Note',
                    page_total: 50,
                },
            },
        }) as App & {
            vault: App['vault'] & {
                getAbstractFileByPath(path: string): TFolder | null;
            };
        };
        app.vault.getAbstractFileByPath = (path: string) => path === 'Books' ? folder : null;

        const service = new ReadingService(app, 'book', 'Books', createMetadataService(app));
        const items = await service.loadItems();

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ type: 'book', displayName: 'Folder Note' });
    });

    describe('kebab-case frontmatter (migration stage 1)', () => {
        // Stage 1 of the frontmatter migration: readers must accept the new kebab-case
        // keys so the bulk data rewrite in stage 2 cannot break the library. Manga is
        // intentionally out of scope for the migration, so only book keys are covered.
        function parseBook(frontmatter: Record<string, unknown>) {
            const file = createMockFile('Library/Dune.md', 'Dune');
            const app = createMockApp({ [file.path]: { frontmatter } });
            const service = new ReadingService(app, 'book', 'Library', createMetadataService(app));
            return service.parseFromCache(file);
        }

        it('reads renamed book keys in their new spelling', () => {
            const book = parseBook({
                type: 'book',
                title: 'Dune',
                'poster-b': 'https://cdn.example/dune-wide.jpg',
                synopsis: 'Spice and sandworms.',
                author: 'Frank Herbert',
                publisher: 'Chilton Books',
                'user-rating': 7,
                'community-rating': 91.3,
                'community-votes': 4100,
                'community-rating-provider': 'Hardcover',
                'integration-provider': 'hardcover',
                'integration-id': '4242',
                'page-current': 120,
                'page-total': 412,
                'chapter-current': 8,
                'chapter-total': 48,
                'related-media': [{ type: 'movie', path: 'Library/Dune Movie.md', title: 'Dune' }],
            });

            expect(book?.displayName).toBe('Dune');
            expect(book?.description).toBe('Spice and sandworms.');
            expect(book?.type === 'book' && book.authors).toEqual(['Frank Herbert']);
            expect(book?.type === 'book' && book.publisher).toBe('Chilton Books');
            expect(book?.userRating).toBe(7);
            expect(book?.communityRating).toBe(91.3);
            expect(book?.communityVotes).toBe(4100);
            expect(book?.communityRatingProvider).toBe('Hardcover');
            expect(book?.integrationProvider).toBe('hardcover');
            expect(book?.integrationId).toBe('4242');
            expect(book?.type === 'book' && book.pageCurrent).toBe(120);
            expect(book?.type === 'book' && book.pageTotal).toBe(412);
            expect(book?.type === 'book' && book.chapterCurrent).toBe(8);
            expect(book?.type === 'book' && book.chapterTotal).toBe(48);
            expect(book?.horizontalImageUrl).toBe('https://cdn.example/dune-wide.jpg');
            expect(book?.relatedMedia?.[0]?.path).toBe('Library/Dune Movie.md');
        });

        it('still reads legacy keys, so unmigrated notes keep working', () => {
            const book = parseBook({
                type: 'book',
                name: 'Dune',
                poster_b: 'https://cdn.example/dune-wide.jpg',
                plot: 'Spice and sandworms.',
                authors: ['Frank Herbert'],
                publisher: 'Chilton Books',
                userRating: 7,
                communityRating: 91.3,
                integration_provider: 'hardcover',
                page_current: 120,
                page_total: 412,
                chapter_current: 8,
                chapter_total: 48,
            });

            expect(book?.displayName).toBe('Dune');
            expect(book?.description).toBe('Spice and sandworms.');
            expect(book?.type === 'book' && book.authors).toEqual(['Frank Herbert']);
            expect(book?.userRating).toBe(7);
            expect(book?.communityRating).toBe(91.3);
            expect(book?.type === 'book' && book.pageCurrent).toBe(120);
            expect(book?.type === 'book' && book.chapterTotal).toBe(48);
        });
    });
});
