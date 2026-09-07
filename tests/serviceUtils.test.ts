import { describe, expect, it } from 'vitest';
import { extractFrontmatterBlock, isFileInFolder, mapInFrameBatches, resolveMediaType } from '../src/services/media/serviceUtils';
import type { FolderTypeEntry } from '../src/services/media/serviceUtils';

describe('extractFrontmatterBlock', () => {
    it('returns the yaml between the fences', () => {
        expect(extractFrontmatterBlock('---\ntype: game\ntitle: Halo\n---\nbody')).toBe('type: game\ntitle: Halo');
    });

    it('ignores --- that appears later in the body', () => {
        const content = '---\ntype: game\n---\n\nSome text\n\n---\n\nMore text';
        expect(extractFrontmatterBlock(content)).toBe('type: game');
    });

    it('handles CRLF line endings', () => {
        expect(extractFrontmatterBlock('---\r\ntype: game\r\n---\r\nbody')).toBe('type: game');
    });

    it('tolerates a leading BOM', () => {
        expect(extractFrontmatterBlock('﻿---\ntype: game\n---\n')).toBe('type: game');
    });

    it('returns null when there is no frontmatter', () => {
        expect(extractFrontmatterBlock('just a note')).toBeNull();
        expect(extractFrontmatterBlock('')).toBeNull();
    });

    it('returns null when the block is never closed', () => {
        expect(extractFrontmatterBlock('---\ntype: game\nstill going')).toBeNull();
    });

    it('returns an empty string for an empty block', () => {
        expect(extractFrontmatterBlock('---\n\n---\nbody')).toBe('');
    });
});

describe('isFileInFolder', () => {
    it('matches files directly inside the folder', () => {
        expect(isFileInFolder('Library/Baldur\'s Gate III.md', 'Library')).toBe(true);
    });

    it('matches files in nested subfolders', () => {
        expect(isFileInFolder('Library/RPG/Baldur\'s Gate III.md', 'Library')).toBe(true);
    });

    it('does not match a sibling file whose name starts with the folder name', () => {
        // A root note called "Library Notes.md" used to read as living in "Library",
        // which pushed it into the library view as a phantom card.
        expect(isFileInFolder('Library Notes.md', 'Library')).toBe(false);
    });

    it('does not match a sibling folder whose name starts with the folder name', () => {
        expect(isFileInFolder('Library Archive/Old.md', 'Library')).toBe(false);
    });

    it('does not match a file named exactly like the folder', () => {
        expect(isFileInFolder('Library.md', 'Library')).toBe(false);
    });

    it('treats an empty folder path as the whole vault', () => {
        expect(isFileInFolder('Anywhere/Note.md', '')).toBe(true);
        expect(isFileInFolder('Note.md', '   ')).toBe(true);
    });

    it('normalizes surrounding slashes and backslashes', () => {
        expect(isFileInFolder('Library/Halo.md', '/Library/')).toBe(true);
        expect(isFileInFolder('Library\\Halo.md', 'Library')).toBe(true);
    });

    it('matches a nested folder path', () => {
        expect(isFileInFolder('Media/Games/Halo.md', 'Media/Games')).toBe(true);
        expect(isFileInFolder('Media/Games Archive/Halo.md', 'Media/Games')).toBe(false);
    });
});

describe('mapInFrameBatches', () => {
    it('preserves order and filters null results across batches', async () => {
        const result = await mapInFrameBatches(
            [1, 2, 3, 4, 5],
            (value) => value % 2 === 0 ? value * 10 : null,
            2
        );

        expect(result).toEqual([20, 40]);
    });
});

describe('resolveMediaType', () => {
    // Mirrors the real vault: games, movies, series, and books all point at Library.
    const sharedFolders: FolderTypeEntry[] = [
        { type: 'game', folderPath: 'Library' },
        { type: 'anime', folderPath: 'Anime' },
        { type: 'movie', folderPath: 'Library' },
        { type: 'series', folderPath: 'Library' },
        { type: 'book', folderPath: 'Library' },
        { type: 'manga', folderPath: 'Manga' },
    ];

    it('uses frontmatter type when file is in a shared folder', () => {
        expect(resolveMediaType('Library/The Matrix.md', 'movie', sharedFolders)).toBe('movie');
        expect(resolveMediaType('Library/Dune.md', 'book', sharedFolders)).toBe('book');
        expect(resolveMediaType('Library/The Witcher.md', 'series', sharedFolders)).toBe('series');
        expect(resolveMediaType('Library/Halo Infinite.md', 'game', sharedFolders)).toBe('game');
    });

    it('falls back to folder match when frontmatter type is absent', () => {
        // Anime and Manga have unique folders, so folder inference is unambiguous.
        expect(resolveMediaType('Anime/Naruto.md', undefined, sharedFolders)).toBe('anime');
        expect(resolveMediaType('Manga/One Piece.md', undefined, sharedFolders)).toBe('manga');
    });

    it('falls back to folder match when frontmatter type is not a valid MediaType', () => {
        // A note with type: "room" (e.g. Blue Prince notes shouldn't be here, but if
        // something in Library had a weird type value, fall back to folder inference).
        expect(resolveMediaType('Library/Mystery.md', 'room', sharedFolders)).toBe('game');
    });

    it('returns undefined when file is outside all media folders', () => {
        expect(resolveMediaType('Games/Blue Prince/Room.md', 'room', sharedFolders)).toBeUndefined();
        expect(resolveMediaType('Templates/Template.md', undefined, sharedFolders)).toBeUndefined();
    });

    it('handles empty and null frontmatter type values', () => {
        expect(resolveMediaType('Library/Note.md', null, sharedFolders)).toBe('game');
        expect(resolveMediaType('Library/Note.md', '', sharedFolders)).toBe('game');
    });

    it('without the bug: a book in Library is correctly typed as book, not game', () => {
        // This is THE bug: before the fix, folders.find() returned 'game' for everything in Library/.
        expect(resolveMediaType('Library/Dune.md', 'book', sharedFolders)).toBe('book');
        expect(resolveMediaType('Library/Dune.md', 'book', sharedFolders)).not.toBe('game');
    });
});
