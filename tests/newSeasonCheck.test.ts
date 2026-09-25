import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { NewSeasonCheckService } from '../src/services/newSeasonCheck';
import type { VideoItem } from '../src/services/VideoService';
import type { TvItem, VideoPart } from '../src/types';
import type { MediaEnrichmentPatch, MediaSourceSelection, MediaKind } from '../src/services/integrations/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFile(path: string, basename: string): TFile {
    const file = new TFile();
    file.path = path;
    file.basename = basename;
    file.name = `${basename}.md`;
    file.extension = 'md';
    file.stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
    return file;
}

function makePart(season: number, episodes: number, current: number, status: VideoPart['status'] = 'completed'): VideoPart {
    return {
        id: `season-${season}`,
        kind: 'season',
        title: `Season ${season}`,
        seasonNumber: season,
        episodeTotal: episodes,
        episodeCurrent: current,
        status,
    };
}

function makeTmdbPart(season: number, episodes: number): Record<string, unknown> {
    return {
        id: `season-${season}`,
        kind: 'season',
        title: `Season ${season}`,
        'season-number': season,
        episodes,
        'episode-current': 0,
        status: 'planned',
    };
}

function makeTvItem(overrides: Partial<TvItem> & { filePath: string; displayName: string }): TvItem {
    return {
        type: 'tv',
        status: 'completed',
        summary: '',
        releaseDate: null,
        runtime: '',
        author: [],
        actors: '',
        seasons: null,
        episodeCurrent: null,
        episodeTotal: null,
        networks: [],
        rating: '',
        genres: [],
        tags: [],
        sourceUrl: null,
        integrationProvider: 'tmdb',
        integrationId: '12345',
        parts: [],
        activePartId: null,
        relatedMedia: [],
        year: 2020,
        description: '',
        userRating: null,
        favorite: false,
        poster: null,
        imageUrl: '',
        horizontalImageUrl: '',
        hasCustomPoster: false,
        nameLower: overrides.displayName.toLowerCase(),
        rawFields: {},
        owned: null,
        count: null,
        repeatable: false,
        communityRating: null,
        communityVotes: null,
        communityRatingProvider: null,
        started: null,
        finished: null,
        ...overrides,
    };
}

interface MockDeps {
    items: VideoItem[];
    files: Map<string, TFile>;
    frontmatter: Map<string, Record<string, unknown>>;
    enrichmentResults: Map<string, MediaEnrichmentPatch | null>;
    metadataUpdates: Array<{ path: string; patch: Record<string, unknown> }>;
}

function createService(deps: MockDeps): NewSeasonCheckService {
    const mockApp = {
        vault: {
            getAbstractFileByPath(path: string): TFile | null {
                return deps.files.get(path) ?? null;
            },
            async read(): Promise<string> {
                // Force fallback to metadata cache
                throw new Error('vault.read not available in test');
            },
        },
        metadataCache: {
            getFileCache(file: { path: string }): { frontmatter: Record<string, unknown> } | null {
                const fm = deps.frontmatter.get(file.path);
                return fm ? { frontmatter: fm } : null;
            },
        },
    } as never;

    const mockTvService = {
        async loadItems(): Promise<VideoItem[]> {
            return deps.items;
        },
    } as never;

    const mockIntegrationService = {
        async getMediaEnrichment(
            _kind: MediaKind,
            source: MediaSourceSelection
        ): Promise<MediaEnrichmentPatch | null> {
            return deps.enrichmentResults.get(source.id) ?? null;
        },
    } as never;

    const mockMetadataService = {
        async updateMetadata(file: TFile, patch: Record<string, unknown>): Promise<void> {
            deps.metadataUpdates.push({ path: file.path, patch });
        },
    } as never;

    return new NewSeasonCheckService(
        mockApp,
        mockTvService,
        mockIntegrationService,
        mockMetadataService,
    );
}

function makeEnrichment(
    tvParts: Record<string, unknown>[],
    showStatus = 'Returning Series'
): MediaEnrichmentPatch {
    return {
        kind: 'tv',
        source: { provider: 'tmdb', id: '12345', title: 'Test Show' },
        values: {
            tv_parts: tvParts,
            showStatus,
        },
        filledFields: [],
        skippedFields: [],
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewSeasonCheckService', () => {
    it('returns empty result when no completed TV items exist', async () => {
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: 'TV/Show A.md', displayName: 'Show A', status: 'watching' }),
                makeTvItem({ filePath: 'TV/Show B.md', displayName: 'Show B', status: 'planned' }),
            ],
            files: new Map(),
            frontmatter: new Map(),
            enrichmentResults: new Map(),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result).toEqual({ checked: 0, updated: [], skipped: 0, failed: 0 });
    });

    it('skips ended shows without making an API call', async () => {
        const file = createMockFile('TV/Breaking Bad.md', 'Breaking Bad');
        const deps: MockDeps = {
            items: [
                makeTvItem({
                    filePath: file.path,
                    displayName: 'Breaking Bad',
                    parts: [makePart(1, 7, 7), makePart(2, 13, 13)],
                }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { 'show-status': 'Ended' }]]),
            enrichmentResults: new Map(), // no enrichment result = would fail if called
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.checked).toBe(0);
        expect(result.skipped).toBe(1);
        expect(result.updated).toEqual([]);
    });

    it('skips canceled shows (case-insensitive)', async () => {
        const file = createMockFile('TV/Firefly.md', 'Firefly');
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'Firefly' }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { 'show-status': 'canceled' }]]),
            enrichmentResults: new Map(),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.skipped).toBe(1);
        expect(result.checked).toBe(0);
    });

    it('reports no changes when TMDB returns same season data', async () => {
        const file = createMockFile('TV/Ted Lasso.md', 'Ted Lasso');
        const localParts = [makePart(1, 10, 10), makePart(2, 12, 12), makePart(3, 12, 12)];
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'Ted Lasso', parts: localParts }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { 'show-status': 'Ended', tags: [] }]]),
            enrichmentResults: new Map([
                ['12345', makeEnrichment([
                    makeTmdbPart(1, 10),
                    makeTmdbPart(2, 12),
                    makeTmdbPart(3, 12),
                ], 'Ended')],
            ]),
            metadataUpdates: [],
        };
        // show-status is Ended so it gets skipped before the API call
        const result = await createService(deps).checkForNewSeasons();
        expect(result.checked).toBe(0);
        expect(result.skipped).toBe(1);
        expect(result.updated).toEqual([]);
    });

    it('detects a new season and updates status, tags, and season-data', async () => {
        const file = createMockFile('TV/Invincible.md', 'Invincible');
        const localParts = [makePart(1, 8, 8), makePart(2, 8, 8)];
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'Invincible', parts: localParts }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { 'show-status': 'Returning Series', tags: ['animation'] }]]),
            enrichmentResults: new Map([
                ['12345', makeEnrichment([
                    makeTmdbPart(1, 8),
                    makeTmdbPart(2, 8),
                    makeTmdbPart(3, 8), // NEW season
                ])],
            ]),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.checked).toBe(1);
        expect(result.updated).toEqual(['Invincible']);
        expect(result.failed).toBe(0);

        // Verify the metadata patch
        expect(deps.metadataUpdates).toHaveLength(1);
        const patch = deps.metadataUpdates[0].patch;
        expect(patch.status).toBe('watching');
        expect(patch.tags).toEqual(['animation', 'new']);
        expect(patch['show-status']).toBe('Returning Series');

        // Verify season-data includes the new season
        const seasonData = patch['season-data'] as Array<Record<string, unknown>>;
        expect(seasonData).toHaveLength(3);
        expect(seasonData[2]).toMatchObject({
            id: 'season-3',
            kind: 'season',
            title: 'Season 3',
            'season-number': 3,
            'episode-current': 0,
            episodes: 8,
            status: 'planned',
        });
        // Existing seasons preserve their episode progress
        expect(seasonData[0]['episode-current']).toBe(8);
        expect(seasonData[0].status).toBe('completed');
    });

    it('detects increased episode count in a completed season', async () => {
        const file = createMockFile('TV/Split Cour.md', 'Split Cour');
        const localParts = [makePart(1, 10, 10)]; // user completed 10/10
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'Split Cour', parts: localParts }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { tags: [] }]]),
            enrichmentResults: new Map([
                ['12345', makeEnrichment([
                    makeTmdbPart(1, 16), // now 16 episodes (was 10)
                ])],
            ]),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.updated).toEqual(['Split Cour']);

        const patch = deps.metadataUpdates[0].patch;
        expect(patch.status).toBe('watching');
        const seasonData = patch['season-data'] as Array<Record<string, unknown>>;
        expect(seasonData[0].episodes).toBe(16);
        expect(seasonData[0]['episode-current']).toBe(10); // preserved
        expect(seasonData[0].status).toBe('completed'); // preserved
    });

    it('does not trigger on episode increase if season is not completed', async () => {
        const file = createMockFile('TV/In Progress.md', 'In Progress');
        // User is mid-season: 5/10 episodes, status watching (but overall show status = completed)
        const localParts = [makePart(1, 10, 5, 'watching')];
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'In Progress', parts: localParts }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { tags: [], 'show-status': 'Returning Series' }]]),
            enrichmentResults: new Map([
                ['12345', makeEnrichment([
                    makeTmdbPart(1, 16), // more episodes but season isn't completed
                ])],
            ]),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.updated).toEqual([]);
        expect(deps.metadataUpdates).toHaveLength(0);
    });

    it('does not duplicate the #new tag', async () => {
        const file = createMockFile('TV/Already Tagged.md', 'Already Tagged');
        const localParts = [makePart(1, 8, 8)];
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'Already Tagged', parts: localParts }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { tags: ['new', 'drama'] }]]),
            enrichmentResults: new Map([
                ['12345', makeEnrichment([
                    makeTmdbPart(1, 8),
                    makeTmdbPart(2, 10),
                ])],
            ]),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.updated).toEqual(['Already Tagged']);
        const patch = deps.metadataUpdates[0].patch;
        // tags should not contain 'new' twice
        expect(patch.tags).toBeUndefined(); // not included in patch since already present
    });

    it('skips non-TMDB shows', async () => {
        const deps: MockDeps = {
            items: [
                makeTvItem({
                    filePath: 'TV/OMDB Show.md',
                    displayName: 'OMDB Show',
                    integrationProvider: 'omdb',
                }),
            ],
            files: new Map(),
            frontmatter: new Map(),
            enrichmentResults: new Map(),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result).toEqual({ checked: 0, updated: [], skipped: 0, failed: 0 });
    });

    it('skips shows without an integration ID', async () => {
        const deps: MockDeps = {
            items: [
                makeTvItem({
                    filePath: 'TV/No ID.md',
                    displayName: 'No ID',
                    integrationId: null,
                }),
            ],
            files: new Map(),
            frontmatter: new Map(),
            enrichmentResults: new Map(),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result).toEqual({ checked: 0, updated: [], skipped: 0, failed: 0 });
    });

    it('backfills show-status when no new content is found', async () => {
        const file = createMockFile('TV/Backfill.md', 'Backfill');
        const localParts = [makePart(1, 10, 10)];
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'Backfill', parts: localParts }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, { tags: [] }]]), // no show-status
            enrichmentResults: new Map([
                ['12345', makeEnrichment([makeTmdbPart(1, 10)], 'Returning Series')],
            ]),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.updated).toEqual([]);
        expect(result.checked).toBe(1);

        // show-status should be backfilled
        expect(deps.metadataUpdates).toHaveLength(1);
        expect(deps.metadataUpdates[0].patch).toEqual({ 'show-status': 'Returning Series' });
    });

    it('increments failed count when enrichment returns null', async () => {
        const file = createMockFile('TV/Broken.md', 'Broken');
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: file.path, displayName: 'Broken' }),
            ],
            files: new Map([[file.path, file]]),
            frontmatter: new Map([[file.path, {}]]),
            enrichmentResults: new Map([['12345', null]]),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.checked).toBe(1);
        expect(result.failed).toBe(1);
        expect(result.updated).toEqual([]);
    });

    it('skips items whose file cannot be resolved', async () => {
        const deps: MockDeps = {
            items: [
                makeTvItem({ filePath: 'TV/Missing File.md', displayName: 'Missing File' }),
            ],
            files: new Map(), // file not in vault
            frontmatter: new Map(),
            enrichmentResults: new Map(),
            metadataUpdates: [],
        };
        const result = await createService(deps).checkForNewSeasons();
        expect(result.skipped).toBe(1);
        expect(result.checked).toBe(0);
    });
});
