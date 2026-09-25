import type { AnimeStatus } from '../types';

export function normalizeProgress(value: number | null, total: number | null): number | null {
    if (value === null) return null;
    const normalized = Math.max(0, Math.trunc(value));
    return total && total > 0 ? Math.min(normalized, total) : normalized;
}

export function stepProgress(current: number | null, delta: number, total: number | null): number | null {
    return normalizeProgress((current ?? 0) + delta, total);
}

/** The episode-tracking part of an anime part or a TV season. */
export interface EpisodePart {
    episodeCurrent: number | null;
    episodeTotal: number | null;
    status: AnimeStatus;
}

/** One episode back. Stepping down from the total reopens a completed part. */
export function decrementEpisode(part: EpisodePart): void {
    part.episodeCurrent = Math.max(0, (part.episodeCurrent ?? 0) - 1);
    if (part.status === 'completed' && part.episodeTotal && part.episodeCurrent < part.episodeTotal) {
        part.status = 'watching';
    }
}

/** One episode forward, capped at the total: starts a planned part, completes it at the total. */
export function incrementEpisode(part: EpisodePart): void {
    part.episodeCurrent = (part.episodeCurrent ?? 0) + 1;
    if (part.episodeTotal && part.episodeCurrent > part.episodeTotal) {
        part.episodeCurrent = part.episodeTotal;
    }
    if (part.status === 'planned') part.status = 'watching';
    if (part.episodeTotal && part.episodeCurrent >= part.episodeTotal) part.status = 'completed';
}

/** Sets a part's status; marking it completed fills in the remaining episodes. */
export function setPartStatus(part: EpisodePart, status: AnimeStatus): void {
    part.status = status;
    if (status === 'completed' && part.episodeTotal && (part.episodeCurrent ?? 0) < part.episodeTotal) {
        part.episodeCurrent = part.episodeTotal;
    }
}
