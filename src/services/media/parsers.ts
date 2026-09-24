import type { RelatedMediaLink, UserRating } from '../../types';
import { MAX_USER_RATING } from '../../constants';
import { isMediaType } from '../../media/mediaTypes';

export function parseNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

export function parseYear(value: unknown): number | null {
    const parsed = parseNumber(value);
    if (parsed !== null) {
        const rounded = Math.trunc(parsed);
        if (rounded > 0) return rounded;
    }

    const text = typeof value === 'string' ? value : '';
    const match = text.match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
}

export function parseUserRating(value: unknown): UserRating {
    const parsed = parseNumber(value);
    if (parsed === null) return null;
    const rating = Math.trunc(parsed);
    return rating >= 1 && rating <= MAX_USER_RATING ? rating as UserRating : null;
}

/**
 * Related-media links from a note's frontmatter. Games, movies, TV and books write the
 * kebab-case key; anime was left out of the frontmatter migration and still writes
 * `related_media`, so both are read.
 */
export function readRelatedMediaLinks(frontmatter: Record<string, unknown>): RelatedMediaLink[] {
    return parseRelatedMedia(frontmatter['related-media'] ?? frontmatter.related_media);
}

export function parseRelatedMedia(raw: unknown): RelatedMediaLink[] {
    if (!Array.isArray(raw)) return [];

    const related: RelatedMediaLink[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const source = entry as Record<string, unknown>;
        const type = typeof source.type === 'string' ? source.type.trim().toLowerCase() : '';
        // `series` is the pre-rename spelling of `tv`, still found in older link lists.
        const normalizedType = type === 'series' ? 'tv' : type;
        if (!isMediaType(normalizedType)) continue;
        const path = typeof source.path === 'string' ? source.path.trim() : '';
        if (!path || seen.has(path)) continue;
        const title = typeof source.title === 'string' && source.title.trim()
            ? source.title.trim()
            : path.split('/').pop()?.replace(/\.md$/i, '') || path;
        related.push({ type: normalizedType, path, title });
        seen.add(path);
    }
    return related;
}

export function serializeRelatedMedia(related: RelatedMediaLink[] | undefined): Array<Record<string, unknown>> | null {
    if (!related?.length) return null;
    return related.map((item) => ({
        type: item.type,
        path: item.path,
        title: item.title,
    }));
}

export function getRandomItem<T>(items: T[]): T | null {
    if (!items.length) return null;
    return items[Math.floor(Math.random() * items.length)] ?? null;
}

/** Comma-, semicolon- or newline-separated names from an editor text field, trimmed. */
export function splitNameList(value: string): string[] {
    return value.split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
}
