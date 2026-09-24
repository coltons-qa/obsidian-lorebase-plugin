import { App, TFile, TFolder } from 'obsidian';
import { FilterState, MovieItem, TvItem, SortField, SortOrder, VideoPart, VideoStats, VideoStatus } from '../types';
import { createRatingDistribution, DEFAULT_COVER } from '../constants';
import { MetadataService } from './MetadataService';
import { filterAndSortMedia } from './media/filtering';
import { extractSimpleFrontmatter } from './media/libraryViewState';
import { getRandomItem, parseNumber, parseRelatedMedia, parseUserRating, parseYear, serializeRelatedMedia } from './media/parsers';
import { collectFieldTags, collectTags, getAllMarkdownFiles, mapInFrameBatches, readFrontmatterValue } from './media/serviceUtils';
import { upsertMarkdownSection } from './markdownSections';
import { keyOf, readBoundFields, trimmedOrNull, writeBoundFields, writeNamedField } from '../fields/frontmatterIO';

export type VideoMediaType = 'movie' | 'tv';
export type VideoItem = MovieItem | TvItem;

export class VideoService {
    private app: App;
    private metadataService: MetadataService;
    private cache: VideoItem[] = [];
    private cacheValid = false;
    private folderPath: string;
    private mediaType: VideoMediaType;

    constructor(app: App, mediaType: VideoMediaType, folderPath: string, metadataService: MetadataService) {
        this.app = app;
        this.mediaType = mediaType;
        this.folderPath = folderPath;
        this.metadataService = metadataService;
    }

    setFolderPath(path: string): void {
        if (this.folderPath !== path) {
            this.folderPath = path;
            this.invalidateCache();
        }
    }

    invalidateCache(): void {
        this.cacheValid = false;
    }

    async loadItems(): Promise<VideoItem[]> {
        if (this.cacheValid && this.cache.length > 0) return this.cache;

        const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
        if (!folder || !(folder instanceof TFolder)) {
            console.warn(`${this.mediaType} folder not found: ${this.folderPath}`);
            return [];
        }

        this.cache = await mapInFrameBatches(
            getAllMarkdownFiles(folder),
            (file) => this.parseFromCache(file)
        );
        this.cacheValid = true;
        return this.cache;
    }

    parseFromCache(file: TFile): VideoItem | null {
        try {
            const cache = this.app.metadataCache.getFileCache(file);
            const metadata = cache?.frontmatter || {};
            const rawType = typeof metadata.type === 'string' ? metadata.type.trim().toLowerCase() : '';
            const normalizedType = rawType === 'series' ? 'tv' : rawType;
            if (normalizedType && normalizedType !== this.mediaType) return null;

            const K = this.registryKind;
            const bound = readBoundFields(K, metadata);
            const title = this.readText(metadata, [keyOf(K, 'name')]) || file.basename?.trim() || 'Untitled';
            const posterKey = keyOf(K, 'poster');
            const horizontalKey = keyOf(K, 'posterHorizontal');
            const poster = this.readText(metadata, [posterKey]) || null;
            const horizontal = this.readText(metadata, [horizontalKey]) || poster;
            const verticalImageUrl = this.metadataService.getImageUrl(metadata[posterKey], metadata.cm_poster);
            const horizontalImageUrl = this.metadataService.getImageUrl(
                readFrontmatterValue(metadata, [horizontalKey]),
                metadata.cm_poster
            );
            const status = this.getStatus(this.readText(metadata, [keyOf(K, 'status')]) || '') ?? 'planned';
            const parts = this.parseParts(readFrontmatterValue(
                metadata,
                [this.mediaType === 'tv' ? keyOf('tv', 'tvParts', 0) : keyOf('movies', 'movieParts')]
            ));
            const activePartId = this.readText(metadata, [keyOf('tv', 'tvParts', 1)]) || parts[0]?.id || null;
            const activePart = parts.find((part) => part.id === activePartId) ?? parts[0] ?? null;

            const base = {
                // Simple fields (description, rating, runtime, url, favorite, owned, count,
                // repeatable, community rating) come from the field registry.
                ...bound,
                filePath: file.path,
                displayName: title,
                nameLower: title.toLowerCase(),
                year: parseYear(metadata[keyOf(K, 'year')]),
                summary: bound.description,
                userRating: parseUserRating(readFrontmatterValue(metadata, [keyOf(K, 'userRating')])),
                poster,
                imageUrl: verticalImageUrl || poster || DEFAULT_COVER,
                horizontalImageUrl: horizontalImageUrl || verticalImageUrl || horizontal,
                hasCustomPoster: Boolean(poster),
                status,
                genres: collectFieldTags(metadata, [keyOf(K, 'genres')]),
                tags: collectTags(metadata, cache?.tags),
                started: this.readDateText(metadata, [keyOf(K, 'started')]),
                finished: this.readDateText(metadata, [keyOf(K, 'finished')]),
                integrationProvider: this.normalizeProvider(this.readText(metadata, [keyOf(K, 'integrationSource', 0)])),
                integrationId: this.readText(metadata, [keyOf(K, 'integrationSource', 1)]),
                parts,
                activePartId,
                relatedMedia: parseRelatedMedia(readFrontmatterValue(metadata, [keyOf(K, 'relatedMedia')])),
                releaseDate: this.readDateText(metadata, [keyOf(K, 'released')]) || null,
                director: this.readText(metadata, [keyOf(K, 'director')]) || '',
                actors: this.readText(metadata, [keyOf(K, 'actors')]) || '',
                rawFields: extractSimpleFrontmatter(metadata),
            };

            if (this.mediaType === 'tv') {
                return {
                    ...base,
                    type: 'tv',
                    seasons: (parseNumber(metadata[keyOf('tv', 'seasons')]) ?? parts.length) || null,
                    episodeCurrent: activePart?.episodeCurrent ?? parseNumber(readFrontmatterValue(metadata, [keyOf('tv', 'episodeCurrent')])),
                    episodeTotal: activePart?.episodeTotal ?? parseNumber(readFrontmatterValue(metadata, [keyOf('tv', 'episodeTotal')])),
                    networks: this.toStringArray(metadata[keyOf('tv', 'networks')]),
                } as TvItem;
            }

            return { ...base, type: 'movie' } as MovieItem;
        } catch (error) {
            console.error(`Error parsing ${this.mediaType}:`, error);
            return null;
        }
    }

    filterAndSort(items: VideoItem[], filter: FilterState, sortField: SortField, sortOrder: SortOrder): VideoItem[] {
        return filterAndSortMedia({
            items,
            filter,
            sortField,
            sortOrder,
            isVisible: () => true,
            getCompletedDate: (item) => this.parseDateString(item.finished),
        });
    }

    getRandomItem(items: VideoItem[]): VideoItem | null {
        return getRandomItem(items);
    }

    calculateStats(items: VideoItem[]): VideoStats {
        const stats: VideoStats = {
            total: items.length,
            planned: 0,
            watching: 0,
            completed: 0,
            dropped: 0,
            paused: 0,
            favorite: 0,
            withRating: 0,
            avgRating: 0,
            ratingDistribution: createRatingDistribution(),
            statusPercentages: {},
        };

        let ratingSum = 0;
        for (const item of items) {
            stats[item.status]++;
            if (item.favorite) stats.favorite++;
            if (item.userRating) {
                stats.withRating++;
                ratingSum += item.userRating;
                stats.ratingDistribution[item.userRating] = (stats.ratingDistribution[item.userRating] || 0) + 1;
            }
        }
        stats.avgRating = stats.withRating > 0 ? Math.round((ratingSum / stats.withRating) * 10) / 10 : 0;
        for (const status of ['planned', 'watching', 'completed', 'dropped', 'paused'] as const) {
            stats.statusPercentages[status] = stats.total > 0 ? Math.round((stats[status] / stats.total) * 1000) / 10 : 0;
        }
        return stats;
    }

    async updateItem(item: VideoItem, updates: Partial<VideoItem> & Record<string, unknown>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (!(file instanceof TFile)) return;

        const frontmatterUpdates: Record<string, unknown> = {};
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

        const K = this.registryKind;
        const isTv = this.mediaType === 'tv';
        // Simple fields (description, rating, runtime, url, favorite, owned, count,
        // repeatable, community rating) come from the field registry.
        writeBoundFields(K, frontmatterUpdates, frontmatter, updates as Record<string, unknown>);
        const write = (name: string, value: unknown, key?: string): void =>
            writeNamedField(K, frontmatterUpdates, frontmatter, name, value, key);

        if ('displayName' in updates) write('name', trimmedOrNull(updates.displayName));
        if ('title' in updates) write('name', trimmedOrNull(String(updates.title ?? '')));
        if ('year' in updates) write('year', updates.year);
        if ('summary' in updates) write('plot', trimmedOrNull(updates.summary));
        if ('poster' in updates) write('poster', trimmedOrNull(updates.poster));
        if ('imageUrl' in updates) write('poster', trimmedOrNull(updates.imageUrl === DEFAULT_COVER ? '' : updates.imageUrl));
        if ('horizontalImageUrl' in updates) write('posterHorizontal', trimmedOrNull(updates.horizontalImageUrl));
        if ('genres' in updates) write('genres', this.normalizedListOrNull(updates.genres));
        if ('tags' in updates) write('tags', this.normalizedListOrNull(updates.tags, true));
        if ('status' in updates) write('status', updates.status);
        if ('userRating' in updates) write('userRating', updates.userRating);
        if ('started' in updates) write('started', this.normalizeDateString(String(updates.started ?? '')) || null);
        if ('finished' in updates) write('finished', this.normalizeDateString(String(updates.finished ?? '')) || null);
        if ('releaseDate' in updates) write('released', trimmedOrNull(this.normalizeDateString(String(updates.releaseDate ?? ''))));
        // Director and cast are stored as YAML lists; the director lives under the
        // consolidated `author` key.
        if ('director' in updates) write('director', this.displayListOrNull(updates.director));
        if ('actors' in updates) write('actors', this.displayListOrNull(updates.actors));
        if ('relatedMedia' in updates) write('relatedMedia', serializeRelatedMedia(updates.relatedMedia));
        if (isTv) {
            if ('seasons' in updates) write('seasons', updates.seasons);
            if ('networks' in updates) write('networks', this.normalizedListOrNull(updates.networks));
            if ('parts' in updates) write('tvParts', this.serializeParts(updates.parts ?? []), keyOf('tv', 'tvParts', 0));
            if ('activePartId' in updates) write('tvParts', updates.activePartId, keyOf('tv', 'tvParts', 1));
            if ('episodeCurrent' in updates) write('episodeCurrent', updates.episodeCurrent);
            if ('episodeTotal' in updates) write('episodeTotal', updates.episodeTotal);
            const activeId = typeof updates.activePartId === 'string' ? updates.activePartId : item.activePartId;
            const parts = Array.isArray(updates.parts) ? updates.parts : item.parts;
            const activePart = parts?.find((part) => part.id === activeId);
            if (activePart?.seasonNumber !== undefined) write('seasonCurrent', activePart.seasonNumber);
        } else {
            // Movie parts are not a tracked concept; clear rather than rewrite.
            if ('parts' in updates) write('movieParts', null);
            if ('activePartId' in updates && this.hasKey(frontmatter, 'active_part_id')) frontmatterUpdates.active_part_id = null;
        }

        await this.metadataService.updateMetadata(file, frontmatterUpdates);
        if ('myNotes' in updates) {
            await this.updateMyNotesSection(file, String(updates.myNotes ?? ''));
        }
        this.invalidateCache();
    }

    private async updateMyNotesSection(file: TFile, value: string): Promise<void> {
        const content = await this.app.vault.read(file);
        const next = upsertMarkdownSection(content, 'My Notes', value);
        if (next !== content) {
            await this.app.vault.modify(file, next);
        }
    }

    async deleteItem(item: VideoItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file);
            this.invalidateCache();
        }
    }

    private parseParts(raw: unknown): VideoPart[] {
        if (!Array.isArray(raw)) return [];
        return raw.map((entry, index) => {
            const source = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
            const kind = this.mediaType === 'tv' ? 'season' : 'movie';
            const seasonNumber = parseNumber(readFrontmatterValue(source, ['season-number']));
            return {
                id: this.readText(source, ['id']) || `${kind}-${index + 1}`,
                kind,
                title: this.readText(source, ['title']) || (kind === 'season' ? `Season ${seasonNumber ?? index + 1}` : `Part ${index + 1}`),
                seasonNumber,
                episodeCurrent: parseNumber(readFrontmatterValue(source, ['episode-current'])),
                episodeTotal: parseNumber(readFrontmatterValue(source, ['episodes'])),
                status: this.getStatus(this.readText(source, ['status']) || '') ?? 'planned',
            };
        });
    }

    private serializeParts(parts: VideoPart[]): Array<Record<string, unknown>> {
        return parts.map((part) => ({
            id: part.id,
            kind: part.kind,
            title: part.title,
            'season-number': part.seasonNumber,
            'episode-current': part.episodeCurrent,
            episodes: part.episodeTotal,
            status: part.status,
        }));
    }

    private readText(source: Record<string, unknown>, keys: string[]): string {
        for (const key of keys) {
            const value = source[key];
            if (value === null || value === undefined) continue;
            if (Array.isArray(value)) {
                const text = value.map((entry) => String(entry).trim()).filter(Boolean).join(', ');
                if (text) return text;
                continue;
            }
            const text = String(value).trim();
            if (text) return text;
        }
        return '';
    }

    private readDateText(source: Record<string, unknown>, keys: string[]): string | null {
        const text = this.readText(source, keys);
        if (!text) return null;
        return this.normalizeDateString(text) || null;
    }

    private normalizeDateString(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) return '';
        if (/^\d{4}$/.test(trimmed)) return '';
        const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
        if (isoMatch) {
            const year = Number(isoMatch[1]);
            const month = Number(isoMatch[2]);
            const day = Number(isoMatch[3]);
            const date = new Date(Date.UTC(year, month - 1, day));
            return date.getUTCFullYear() === year
                && date.getUTCMonth() === month - 1
                && date.getUTCDate() === day
                ? trimmed
                : '';
        }
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) return '';
        const date = new Date(parsed);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private parseDateString(value: string | null | undefined): number | null {
        if (!value) return null;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }

    private hasKey(frontmatter: Record<string, unknown> | null | undefined, key: string): boolean {
        return Boolean(frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, key));
    }

    private getStatus(value: string): VideoStatus | null {
        const normalized = value.trim().toLowerCase();
        return ['planned', 'watching', 'completed', 'dropped', 'paused'].includes(normalized)
            ? normalized as VideoStatus
            : null;
    }

    private normalizeProvider(value: string): 'tmdb' | 'tvmaze' | 'omdb' | null {
        const normalized = value.trim().toLowerCase();
        return normalized === 'tmdb' || normalized === 'tvmaze' || normalized === 'omdb' ? normalized : null;
    }

    /** Media kind as the field registry names it. */
    private get registryKind(): 'movies' | 'tv' {
        return this.mediaType === 'tv' ? 'tv' : 'movies';
    }

    /** Lower-cased, de-duplicated list (genres, tags, networks), or null when empty. */
    private normalizedListOrNull(values: unknown, removeHashPrefix = false): string[] | null {
        const normalized = this.toStringArray(values)
            .map((value) => (removeHashPrefix ? value.replace(/^#+/, '') : value).trim().toLowerCase())
            .filter((value, index, source) => Boolean(value) && source.indexOf(value) === index);
        return normalized.length ? normalized : null;
    }

    private displayListOrNull(value: unknown): string[] | null {
        const values = this.toDisplayList(value);
        return values.length > 0 ? values : null;
    }

    private toStringArray(value: unknown): string[] {
        if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
        if (typeof value === 'string') return value.split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
        return [];
    }

    private toDisplayList(value: unknown): string[] {
        const result: string[] = [];
        const seen = new Set<string>();
        for (const entry of this.toStringArray(value)) {
            const normalized = entry.trim();
            const key = normalized.toLocaleLowerCase();
            if (!normalized || seen.has(key)) continue;
            seen.add(key);
            result.push(normalized);
        }
        return result;
    }
}
