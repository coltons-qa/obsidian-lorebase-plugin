import { App, TFile, TFolder } from 'obsidian';
import { BookItem, FilterState, MangaItem, MangaPart, ReadingItem, ReadingStatus, ReadingStats, SortField, SortOrder } from '../types';
import { createRatingDistribution, DEFAULT_COVER } from '../constants';
import { MetadataService } from './MetadataService';
import { filterAndSortMedia } from './media/filtering';
import { extractSimpleFrontmatter } from './media/libraryViewState';
import { getRandomItem, parseNumber, parseRelatedMedia, parseUserRating, parseYear, serializeRelatedMedia } from './media/parsers';
import { collectFieldTags, collectSeriesNames, collectTags, getAllMarkdownFiles, isTruthy, mapInFrameBatches, readFrontmatterValue } from './media/serviceUtils';
import { upsertMarkdownSection } from './markdownSections';
import { keyOf, readBoundFields, trimmedOrNull, writeBoundFields, writeNamedField } from '../fields/frontmatterIO';

export type ReadingMediaType = 'book' | 'manga';

export class ReadingService {
    private app: App;
    private metadataService: MetadataService;
    private cache: ReadingItem[] = [];
    private cacheValid = false;
    private folderPath: string;
    private mediaType: ReadingMediaType;

    constructor(app: App, mediaType: ReadingMediaType, folderPath: string, metadataService: MetadataService) {
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

    async loadItems(): Promise<ReadingItem[]> {
        if (this.cacheValid) return this.cache;

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

    parseFromCache(file: TFile): ReadingItem | null {
        try {
            const cache = this.app.metadataCache.getFileCache(file);
            const rawMetadata: unknown = cache?.frontmatter;
            const metadata = isRecord(rawMetadata) ? rawMetadata : {};
            const rawType = typeof metadata.type === 'string' ? metadata.type.trim().toLowerCase() : '';
            if (rawType && rawType !== this.mediaType) return null;

            // Books and manga share these keys: ReadingService's shared reader has always
            // read the book (kebab-case) spellings for both. Manga-only fields below keep
            // their own keys until manga is reconciled with its template.
            const K = 'books';
            const title = this.readText(metadata, [keyOf(K, 'name')]) || file.basename?.trim() || 'Untitled';
            const description = this.readText(metadata, [keyOf(K, 'plot')]) || '';
            const posterKey = keyOf(K, 'poster');
            const horizontalKey = keyOf(K, 'posterHorizontal');
            const poster = this.readText(metadata, [posterKey]) || null;
            const horizontal = this.readText(metadata, [horizontalKey]) || poster;
            const verticalImageUrl = this.metadataService.getImageUrl(metadata[posterKey], metadata.cm_poster);
            const horizontalImageUrl = this.metadataService.getImageUrl(readFrontmatterValue(metadata, [horizontalKey]), metadata.cm_poster);
            const status = this.getStatus(this.readText(metadata, [keyOf(K, 'status')]) || '') ?? 'planned';
            const genres = collectFieldTags(metadata, [keyOf(K, 'genres')]);
            const base = {
                filePath: file.path,
                displayName: title,
                nameLower: title.toLowerCase(),
                year: parseYear(metadata[keyOf(K, 'year')]),
                description,
                summary: description,
                userRating: parseUserRating(readFrontmatterValue(metadata, [keyOf(K, 'userRating')])),
                favorite: isTruthy(metadata[keyOf(K, 'favorite')]),
                poster,
                imageUrl: verticalImageUrl || poster || DEFAULT_COVER,
                horizontalImageUrl: horizontalImageUrl || horizontal || verticalImageUrl || poster || null,
                hasCustomPoster: Boolean(metadata.cm_poster || poster),
                status,
                genres,
                tags: collectTags(metadata, cache?.tags),
                dateAdded: file.stat?.ctime ?? file.stat?.mtime ?? Date.now(),
                lastModified: file.stat?.mtime ?? file.stat?.ctime ?? Date.now(),
                sourceUrl: this.readText(metadata, [keyOf(K, 'url')]) || null,
                started: this.readDateText(metadata, [keyOf(K, 'started')]),
                finished: this.readDateText(metadata, [keyOf(K, 'finished')]),
                integrationProvider: this.normalizeProvider(this.readText(metadata, [keyOf(K, 'integrationSource', 0)])),
                integrationId: this.readText(metadata, [keyOf(K, 'integrationSource', 1)]) || null,
                relatedMedia: parseRelatedMedia(readFrontmatterValue(metadata, [keyOf(K, 'relatedMedia')])),
                communityRating: parseNumber(readFrontmatterValue(metadata, [keyOf(K, 'communityRating')])),
                communityVotes: parseNumber(readFrontmatterValue(metadata, [keyOf(K, 'communityVotes')])),
                communityRatingProvider: this.readText(metadata, [keyOf(K, 'communityRatingProvider')]) || null,
                owned: this.readText(metadata, [keyOf(K, 'owned')]) || null,
                count: parseNumber(readFrontmatterValue(metadata, [keyOf(K, 'count')])),
                repeatable: isTruthy(metadata[keyOf(K, 'repeatable')]),
                rawFields: extractSimpleFrontmatter(metadata),
            };

            if (this.mediaType === 'book') {
                return {
                    ...base,
                    // Book-only simple fields (series, position, illustrator, audiobook)
                    // come from the field registry.
                    ...readBoundFields(K, metadata),
                    type: 'book',
                    author: this.toStringArray(readFrontmatterValue(metadata, [keyOf(K, 'authors')])),
                    publisher: this.readText(metadata, [keyOf(K, 'publisher')]) || '',
                    releaseDate: this.readDateText(metadata, [keyOf(K, 'released')]),
                    pageCurrent: parseNumber(readFrontmatterValue(metadata, [keyOf(K, 'pageCurrent')])),
                    pageTotal: parseNumber(readFrontmatterValue(metadata, [keyOf(K, 'pageTotal')])),
                    chapterCurrent: parseNumber(readFrontmatterValue(metadata, [keyOf(K, 'chapterCurrent')])),
                    chapterTotal: parseNumber(readFrontmatterValue(metadata, [keyOf(K, 'chapterTotal')])),
                    integrationProvider: base.integrationProvider === 'hardcover' || base.integrationProvider === 'googlebooks'
                        ? base.integrationProvider
                        : null,
                } as BookItem;
            }

            const chapterCurrent = parseNumber(metadata.chapter_current ?? metadata.chapterCurrent);
            const chapterTotal = parseNumber(metadata.chapter_total ?? metadata.chapterTotal ?? metadata.chapters);
            const volumeCurrent = parseNumber(metadata.volume_current ?? metadata.volumeCurrent);
            const volumeTotal = parseNumber(metadata.volume_total ?? metadata.volumeTotal ?? metadata.volumes);
            const parts = this.normalizeMangaParts(metadata, {
                chapterCurrent,
                chapterTotal,
                volumeCurrent,
                volumeTotal,
                status,
            });
            const activePartId = this.normalizeActivePartId(parts, this.readText(metadata, ['active_part_id']));
            const activePart = this.getActivePart(parts, activePartId);

            return {
                ...base,
                type: 'manga',
                author: this.toStringArray(metadata.authors ?? metadata.author),
                artists: this.toStringArray(metadata.artists ?? metadata.artist),
                chapterCurrent: activePart?.chapterCurrent ?? chapterCurrent,
                chapterTotal: activePart?.chapterTotal ?? chapterTotal,
                volumeCurrent: activePart?.volumeNumber ?? volumeCurrent,
                volumeTotal: volumeTotal ?? (parts.length ? parts.length : null),
                parts,
                activePartId,
                integrationProvider: base.integrationProvider === 'anilist'
                    || base.integrationProvider === 'jikan'
                    || base.integrationProvider === 'shikimori'
                    || base.integrationProvider === 'mangaupdates'
                    || base.integrationProvider === 'mangadex'
                    ? base.integrationProvider
                    : null,
            };
        } catch (error) {
            console.error(`Error parsing ${this.mediaType}:`, error);
            return null;
        }
    }

    filterAndSort(
        items: ReadingItem[],
        filter: FilterState,
        sortField: SortField,
        sortOrder: SortOrder
    ): ReadingItem[] {
        return filterAndSortMedia({
            items,
            filter,
            sortField,
            sortOrder,
            getCompletedDate: (item) => this.parseDateString(item.finished),
        });
    }

    getRandomItem(items: ReadingItem[]): ReadingItem | null {
        return getRandomItem(items);
    }

    calculateStats(items: ReadingItem[]): ReadingStats {
        const stats: ReadingStats = {
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

    async updateItem(item: ReadingItem, updates: Partial<ReadingItem> & Record<string, unknown>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (!(file instanceof TFile)) return;

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const frontmatterUpdates: Record<string, unknown> = {};

        frontmatterUpdates.type = item.type;
        // Shared keys are the book spellings for both kinds (see parseFromCache).
        const K = 'books';
        // Simple fields (description, url, favorite, owned, count, repeatable, community
        // rating, and for books series, position, illustrator, audiobook) come from the
        // field registry.
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
        if ('userRating' in updates) write('userRating', updates.userRating ?? null);
        if ('cm_poster' in updates) frontmatterUpdates.cm_poster = updates.cm_poster ?? null;
        if ('started' in updates) write('started', this.normalizeDateString(String(updates.started ?? '')) || null);
        if ('finished' in updates) write('finished', this.normalizeDateString(String(updates.finished ?? '')) || null);
        if ('integrationProvider' in updates) write('integrationSource', updates.integrationProvider, keyOf(K, 'integrationSource', 0));
        if ('integrationId' in updates) write('integrationSource', updates.integrationId, keyOf(K, 'integrationSource', 1));
        if ('relatedMedia' in updates) write('relatedMedia', serializeRelatedMedia(updates.relatedMedia));

        if (item.type === 'book') {
            if ('author' in updates) write('authors', this.displayListOrNull(updates.author));
            if ('publisher' in updates) {
                // One publisher as text, several as a list, always under `publisher`, the
                // key the reader reads (it joins a list back with ', ').
                const publishers = this.toDisplayList(updates.publisher);
                write('publisher', publishers.length > 1 ? publishers : publishers[0] ?? null);
            }
            if ('releaseDate' in updates) write('released', trimmedOrNull(this.normalizeDateString(String(updates.releaseDate ?? ''))));
            const pageTotal = 'pageTotal' in updates ? this.normalizeProgressValue(updates.pageTotal) : item.pageTotal;
            const pageCurrent = 'pageCurrent' in updates ? this.normalizeProgressValue(updates.pageCurrent, pageTotal) : item.pageCurrent;
            const chapterTotal = 'chapterTotal' in updates ? this.normalizeProgressValue(updates.chapterTotal) : item.chapterTotal;
            const chapterCurrent = 'chapterCurrent' in updates ? this.normalizeProgressValue(updates.chapterCurrent, chapterTotal) : item.chapterCurrent;
            if ('pageCurrent' in updates) write('pageCurrent', pageCurrent);
            if ('pageTotal' in updates) write('pageTotal', pageTotal);
            if ('chapterCurrent' in updates) write('chapterCurrent', chapterCurrent);
            if ('chapterTotal' in updates) write('chapterTotal', chapterTotal);
            const pagesDone = (pageTotal ?? 0) > 0 && (pageCurrent ?? 0) >= (pageTotal ?? 0);
            const chaptersDone = (chapterTotal ?? 0) > 0 && (chapterCurrent ?? 0) >= (chapterTotal ?? 0);
            if (pagesDone || chaptersDone) {
                frontmatterUpdates.status = 'completed';
            }
        } else {
            if ('author' in updates) this.updateDisplayListField(
                frontmatterUpdates,
                frontmatter,
                'author',
                'authors',
                updates.author
            );
            if ('artists' in updates) this.updateDisplayListField(
                frontmatterUpdates,
                frontmatter,
                'artist',
                'artists',
                updates.artists
            );
            let parts = this.cloneParts(Array.isArray(updates.parts) ? updates.parts as MangaPart[] : item.parts ?? []);
            let activePartId = updates.activePartId !== undefined ? String(updates.activePartId || '') || null : item.activePartId ?? null;
            const chapterTotal = 'chapterTotal' in updates ? this.normalizeProgressValue(updates.chapterTotal) : item.chapterTotal;
            const chapterCurrent = 'chapterCurrent' in updates ? this.normalizeProgressValue(updates.chapterCurrent, chapterTotal) : item.chapterCurrent;

            if (parts.length) {
                if ('volumeCurrent' in updates) {
                    const targetVolume = parseNumber(updates.volumeCurrent);
                    const volumePart = parts.find((part) => part.volumeNumber === targetVolume);
                    if (volumePart) activePartId = volumePart.id;
                }
                const activeIndex = parts.findIndex((part) => part.id === activePartId);
                const normalizedIndex = activeIndex >= 0 ? activeIndex : 0;
                const active = parts[normalizedIndex];
                activePartId = active?.id ?? null;
                if (active && 'chapterCurrent' in updates) active.chapterCurrent = chapterCurrent;
                if (active && 'chapterTotal' in updates) active.chapterTotal = chapterTotal;
                if (active && (active.chapterTotal ?? 0) > 0 && (active.chapterCurrent ?? 0) >= (active.chapterTotal ?? 0)) {
                    active.status = 'completed';
                }
            }

            if (parts.length && this.areAllMangaPartsCompleted(parts)) {
                frontmatterUpdates.status = 'completed';
            }
            if ('parts' in updates || 'chapterCurrent' in updates || 'chapterTotal' in updates || 'volumeCurrent' in updates) {
                frontmatterUpdates.manga_parts = this.serializeMangaParts(parts);
                frontmatterUpdates.active_part_id = activePartId ?? null;
            }
            if ('chapterCurrent' in updates) frontmatterUpdates.chapter_current = chapterCurrent;
            if ('chapterTotal' in updates) frontmatterUpdates.chapter_total = chapterTotal;
            if ('volumeCurrent' in updates) frontmatterUpdates.volume_current = this.normalizeProgressValue(updates.volumeCurrent);
            if ('volumeTotal' in updates) frontmatterUpdates.volume_total = this.normalizeProgressValue(updates.volumeTotal);
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

    async deleteItem(item: ReadingItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file);
            this.invalidateCache();
        }
    }

    private normalizeMangaParts(
        metadata: Record<string, unknown>,
        fallback: Pick<MangaItem, 'chapterCurrent' | 'chapterTotal' | 'volumeCurrent' | 'volumeTotal' | 'status'>
    ): MangaPart[] {
        const rawParts = Array.isArray(metadata.manga_parts) ? metadata.manga_parts : [];
        const parts = rawParts
            .map((entry, index) => this.parseMangaPart(entry, index))
            .filter((part): part is MangaPart => Boolean(part));
        if (parts.length) return parts;

        if (fallback.volumeCurrent !== null || fallback.volumeTotal !== null || fallback.chapterCurrent !== null || fallback.chapterTotal !== null) {
            return [{
                id: 'main',
                kind: 'volume',
                title: fallback.volumeCurrent ? `Volume ${fallback.volumeCurrent}` : 'Main',
                volumeNumber: fallback.volumeCurrent,
                chapterCurrent: fallback.chapterCurrent,
                chapterTotal: fallback.chapterTotal,
                status: fallback.status,
            }];
        }

        return [];
    }

    private parseMangaPart(raw: unknown, index: number): MangaPart | null {
        if (!raw || typeof raw !== 'object') return null;
        const source = raw as Record<string, unknown>;
        const volumeNumber = parseNumber(source.volumeNumber ?? source.volume ?? source.volume_number);
        const title = this.readText(source, ['title', 'name', 'label']) || (volumeNumber ? `Volume ${volumeNumber}` : `Volume ${index + 1}`);
        return {
            id: this.readText(source, ['id']) || `volume-${volumeNumber ?? index + 1}`,
            kind: 'volume',
            title,
            volumeNumber,
            chapterCurrent: parseNumber(source.chapterCurrent ?? source.chapter_current ?? source.current),
            chapterTotal: parseNumber(source.chapterTotal ?? source.chapter_total ?? source.total),
            status: this.getStatus(this.readText(source, ['status']) || '') ?? 'planned',
        };
    }

    private serializeMangaParts(parts: MangaPart[]): Array<Record<string, unknown>> {
        return parts.map((part) => ({
            id: part.id,
            kind: part.kind,
            title: part.title,
            volume: part.volumeNumber,
            chapter_current: part.chapterCurrent,
            chapter_total: part.chapterTotal,
            status: part.status,
        }));
    }

    private cloneParts(parts: MangaPart[]): MangaPart[] {
        return parts.map((part) => ({ ...part }));
    }

    private areAllMangaPartsCompleted(parts: MangaPart[]): boolean {
        return parts.length > 0 && parts.every((part) => part.status === 'completed');
    }

    private getActivePart(parts: MangaPart[], activePartId: string | null): MangaPart | null {
        if (!parts.length) return null;
        return parts.find((part) => part.id === activePartId) ?? parts[0] ?? null;
    }

    private normalizeActivePartId(parts: MangaPart[], raw: string): string | null {
        if (!parts.length) return null;
        const normalized = raw.trim();
        return parts.some((part) => part.id === normalized) ? normalized : parts[0]?.id ?? null;
    }

    private normalizeProgressValue(value: unknown, total?: number | null): number | null {
        const parsed = parseNumber(value);
        if (parsed === null) return null;
        const rounded = Math.max(0, Math.trunc(parsed));
        return total && total > 0 ? Math.min(rounded, total) : rounded;
    }

    private getStatus(value: string): ReadingStatus | null {
        const normalized = value.trim().toLowerCase();
        return ['planned', 'watching', 'completed', 'dropped', 'paused'].includes(normalized)
            ? normalized as ReadingStatus
            : null;
    }

    private normalizeProvider(value: string): string | null {
        const normalized = value.trim().toLowerCase();
        return ['hardcover', 'googlebooks', 'anilist', 'jikan', 'shikimori', 'mangaupdates', 'mangadex'].includes(normalized)
            ? normalized
            : null;
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
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
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

    private updateDisplayListField(
        updates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        singularKey: string,
        pluralKey: string,
        value: unknown
    ): void {
        const values = this.toDisplayList(value);
        const prefersPlural = this.hasKey(frontmatter, pluralKey) && !this.hasKey(frontmatter, singularKey);

        if (values.length === 0) {
            updates[singularKey] = null;
            updates[pluralKey] = null;
            return;
        }

        if (values.length > 1 || prefersPlural) {
            updates[pluralKey] = values;
            updates[singularKey] = null;
            return;
        }

        updates[singularKey] = values[0];
        if (this.hasKey(frontmatter, pluralKey)) updates[pluralKey] = null;
    }

    /** Series names across loaded books, for the editor's series suggestions. */
    getSeriesList(): string[] {
        return collectSeriesNames(this.cache.filter((item) => item.type === 'book'));
    }

    private toStringArray(value: unknown): string[] {
        if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
        if (typeof value === 'string') return value.split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
        return [];
    }

    /** Lower-cased, de-duplicated list (genres, tags), or null when empty. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
