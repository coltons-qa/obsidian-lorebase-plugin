import { describe, expect, it } from 'vitest';
import { createMockFolder } from './helpers/testHelpers';
import { filterFolders } from '../src/components/folderSuggestUtils';

describe('filterFolders', () => {
    it('sorts folders and filters by case-insensitive substring', () => {
        const folders = [
            createMockFolder('Games'),
            createMockFolder('Entertainment/Anime'),
            createMockFolder('archive/anime-old'),
            createMockFolder('Books'),
            createMockFolder(''),
        ];

        expect(filterFolders(folders, 'anime').map((folder) => folder.path)).toEqual([
            'archive/anime-old',
            'Entertainment/Anime',
        ]);
    });

    it('returns sorted non-root folders for an empty query', () => {
        const folders = [
            createMockFolder('Zeta'),
            createMockFolder('Alpha'),
            createMockFolder(''),
        ];

        expect(filterFolders(folders, '   ').map((folder) => folder.path)).toEqual([
            'Alpha',
            'Zeta',
        ]);
    });
});
