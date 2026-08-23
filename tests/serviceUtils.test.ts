import { describe, expect, it } from 'vitest';
import { extractFrontmatterBlock, isFileInFolder, mapInFrameBatches } from '../src/services/media/serviceUtils';

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
