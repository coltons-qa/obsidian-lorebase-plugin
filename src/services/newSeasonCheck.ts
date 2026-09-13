import { App, TFile, parseYaml } from 'obsidian';
import type { IntegrationService } from './IntegrationService';
import type { MetadataService } from './MetadataService';
import type { VideoService, VideoItem } from './VideoService';
import type { TvItem, VideoPart } from '../types';
import type { MediaSourceSelection } from './integrations/types';
import { extractFrontmatterBlock } from './media/serviceUtils';

export interface NewSeasonCheckResult {
    checked: number;
    updated: string[];
    skipped: number;
    failed: number;
}

const ENDED_STATUSES = new Set(['ended', 'canceled']);
const REQUEST_COOLDOWN_MS = 150;

export class NewSeasonCheckService {
    constructor(
        private app: App,
        private tvService: VideoService,
        private integrationService: IntegrationService,
        private metadataService: MetadataService,
    ) {}

    async checkForNewSeasons(): Promise<NewSeasonCheckResult> {
        const result: NewSeasonCheckResult = { checked: 0, updated: [], skipped: 0, failed: 0 };
        const allItems = await this.tvService.loadItems();
        const candidates = allItems.filter(
            (item): item is TvItem & { integrationId: string } =>
                item.type === 'tv'
                && item.status === 'completed'
                && item.integrationProvider === 'tmdb'
                && typeof item.integrationId === 'string'
                && item.integrationId.trim().length > 0
        );

        for (const item of candidates) {
            try {
                const file = this.app.vault.getAbstractFileByPath(item.filePath);
                if (!(file instanceof TFile)) {
                    result.skipped++;
                    continue;
                }

                const frontmatter = await this.readFrontmatter(file);
                const showStatus = this.readShowStatus(frontmatter);
                if (showStatus && ENDED_STATUSES.has(showStatus.toLowerCase())) {
                    result.skipped++;
                    continue;
                }

                result.checked++;

                // Brief cooldown between API requests
                if (result.checked > 1) {
                    await sleep(REQUEST_COOLDOWN_MS);
                }

                const source: MediaSourceSelection = {
                    provider: 'tmdb',
                    id: item.integrationId,
                    title: item.displayName,
                };
                const enrichment = await this.integrationService.getMediaEnrichment('tv', source);
                if (!enrichment) {
                    result.failed++;
                    continue;
                }

                const incomingParts = this.extractIncomingParts(enrichment.values);
                const localParts = item.parts ?? [];
                const incomingShowStatus = typeof enrichment.values.showStatus === 'string'
                    ? enrichment.values.showStatus
                    : '';
                const comparison = this.compareParts(localParts, incomingParts);

                if (comparison.hasNewContent) {
                    const patch = this.buildNewContentPatch(
                        frontmatter,
                        localParts,
                        comparison,
                        incomingShowStatus
                    );
                    await this.metadataService.updateMetadata(file, patch);
                    result.updated.push(item.displayName);
                } else if (incomingShowStatus && !showStatus) {
                    // Backfill show-status even when no new content
                    await this.metadataService.updateMetadata(file, { 'show-status': incomingShowStatus });
                }
            } catch (error) {
                console.error(`[LOREBASE] New season check failed for "${item.displayName}":`, error);
                result.failed++;
            }
        }

        return result;
    }

    private compareParts(
        local: VideoPart[],
        incoming: IncomingPart[]
    ): PartComparison {
        const localSeasons = new Map(
            local
                .filter((part) => part.seasonNumber !== null)
                .map((part) => [part.seasonNumber!, part])
        );

        const newSeasons: IncomingPart[] = [];
        const updatedSeasons: { local: VideoPart; incoming: IncomingPart }[] = [];

        for (const part of incoming) {
            if (part.seasonNumber === null) continue;
            const existing = localSeasons.get(part.seasonNumber);
            if (!existing) {
                newSeasons.push(part);
            } else if (
                part.episodeTotal !== null
                && existing.episodeTotal !== null
                && part.episodeTotal > existing.episodeTotal
                && existing.status === 'completed'
                && existing.episodeCurrent === existing.episodeTotal
            ) {
                updatedSeasons.push({ local: existing, incoming: part });
            }
        }

        return {
            hasNewContent: newSeasons.length > 0 || updatedSeasons.length > 0,
            newSeasons,
            updatedSeasons,
        };
    }

    private buildNewContentPatch(
        frontmatter: Record<string, unknown>,
        localParts: VideoPart[],
        comparison: PartComparison,
        incomingShowStatus: string
    ): Record<string, unknown> {
        const patch: Record<string, unknown> = { status: 'watching' };

        // Add #new tag (stored without # prefix in frontmatter)
        const existingTags = this.readTags(frontmatter);
        if (!existingTags.includes('new')) {
            patch.tags = [...existingTags, 'new'];
        }

        // Update show-status from TMDB
        if (incomingShowStatus) {
            patch['show-status'] = incomingShowStatus;
        }

        // Build updated season-data: keep existing parts intact, append new ones,
        // update episode totals for seasons with increased counts
        const updatedParts = localParts.map((part) => {
            const update = comparison.updatedSeasons.find(
                (entry) => entry.local.seasonNumber === part.seasonNumber
            );
            if (update) {
                return { ...part, episodeTotal: update.incoming.episodeTotal };
            }
            return part;
        });

        for (const newSeason of comparison.newSeasons) {
            updatedParts.push({
                id: newSeason.id,
                kind: 'season',
                title: newSeason.title,
                seasonNumber: newSeason.seasonNumber,
                episodeCurrent: 0,
                episodeTotal: newSeason.episodeTotal,
                status: 'planned',
            });
        }

        patch['season-data'] = this.serializeParts(updatedParts);
        return patch;
    }

    private extractIncomingParts(values: Record<string, unknown>): IncomingPart[] {
        // getMediaEnrichment puts TV parts under `tv_parts` as the serialized
        // frontmatter format (via toVideoPartsFrontmatter)
        const raw = values.tv_parts;
        if (!Array.isArray(raw)) return [];
        return raw.map((entry) => {
            const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
            return {
                id: String(record.id ?? ''),
                title: String(record.title ?? ''),
                seasonNumber: typeof record['season-number'] === 'number' ? record['season-number'] : null,
                episodeTotal: typeof record.episodes === 'number' ? record.episodes : null,
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

    private readTags(frontmatter: Record<string, unknown>): string[] {
        const value = frontmatter.tags;
        if (Array.isArray(value)) {
            return value.map((entry) => String(entry).trim()).filter(Boolean);
        }
        return [];
    }

    private readShowStatus(frontmatter: Record<string, unknown>): string | null {
        const value = frontmatter['show-status'];
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    private async readFrontmatter(file: TFile): Promise<Record<string, unknown>> {
        try {
            const block = extractFrontmatterBlock(await this.app.vault.read(file));
            if (block !== null) {
                const parsed: unknown = block.trim() ? parseYaml(block) : {};
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return { ...parsed as Record<string, unknown> };
                }
            }
        } catch (error) {
            console.warn('[LOREBASE] Could not read frontmatter from disk, using cache:', error);
        }
        const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return cached && typeof cached === 'object' ? { ...cached } as Record<string, unknown> : {};
    }
}

interface IncomingPart {
    id: string;
    title: string;
    seasonNumber: number | null;
    episodeTotal: number | null;
}

interface PartComparison {
    hasNewContent: boolean;
    newSeasons: IncomingPart[];
    updatedSeasons: { local: VideoPart; incoming: IncomingPart }[];
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
