import { TFile, TFolder } from 'obsidian';
import { normalizeObsidianTag } from '../../settings/settingsNormalization';

export function getAllMarkdownFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    collectMarkdownFiles(folder, files);
    return files;
}

/**
 * Returns the raw value of the first key present in the frontmatter, so a reader can
 * accept a canonical key plus its legacy spellings without flattening the value to text.
 * Use this for lists, booleans, and structured values; the per-service `read*Text`
 * helpers already handle the text cases.
 *
 * Key order is priority order: canonical (kebab-case) first, legacy spellings after.
 * Stage 5 of the frontmatter migration retires the legacy entries.
 */
export function readFrontmatterValue(
    frontmatter: Record<string, unknown>,
    keys: string[]
): unknown {
    for (const key of keys) {
        const value = frontmatter[key];
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
}

/**
 * True when the file sits inside the folder. An empty folder path means the whole vault.
 * Compares against a `/`-terminated prefix so a sibling like `Library Notes.md` is not
 * treated as living in `Library`.
 */
export function isFileInFolder(filePath: string, folderPath: string): boolean {
    const normalizedFolder = folderPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const normalizedFile = filePath.replace(/\\/g, '/');
    if (!normalizedFolder) return true;
    return normalizedFile.startsWith(`${normalizedFolder}/`);
}

export async function mapInFrameBatches<TInput, TOutput>(
    items: readonly TInput[],
    mapper: (item: TInput) => TOutput | null,
    batchSize = 12
): Promise<TOutput[]> {
    const output: TOutput[] = [];
    const safeBatchSize = Math.max(1, Math.trunc(batchSize));

    for (let index = 0; index < items.length; index += safeBatchSize) {
        const end = Math.min(index + safeBatchSize, items.length);
        for (let itemIndex = index; itemIndex < end; itemIndex++) {
            const mapped = mapper(items[itemIndex]);
            if (mapped !== null) output.push(mapped);
        }

        if (end < items.length) {
            await yieldToNextFrame();
        }
    }

    return output;
}

function yieldToNextFrame(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => resolve());
            return;
        }
        window.setTimeout(resolve, 0);
    });
}

function collectMarkdownFiles(folder: TFolder, files: TFile[]): void {
    for (const child of folder.children) {
        if (child instanceof TFile && child.extension === 'md') {
            files.push(child);
        } else if (child instanceof TFolder) {
            collectMarkdownFiles(child, files);
        }
    }
}

export function isTruthy(value: unknown): boolean {
    if (value === true) return true;
    if (typeof value === 'string') {
        const v = value.toLowerCase();
        return v === 'true' || v === '1' || v === 'yes' || v === 'on';
    }
    if (typeof value === 'number') return value === 1;
    return false;
}

function normalizeTag(tag: string): string {
    return normalizeObsidianTag(tag);
}

function addTagsFromValue(tagSet: Set<string>, value: unknown): void {
    if (!value) return;

    const addTag = (raw: string): void => {
        const normalized = normalizeTag(raw);
        if (normalized) tagSet.add(normalized);
    };

    if (Array.isArray(value)) {
        for (const entry of value) {
            if (typeof entry === 'string') addTag(entry);
        }
        return;
    }

    if (typeof value === 'string') {
        for (const group of value.split(/[,;\n]+/)) {
            for (const part of group.split(/\s+/)) {
                const trimmed = part.trim();
                if (trimmed) addTag(trimmed);
            }
        }
    }
}

export function normalizeCacheTags(value: unknown): Array<{ tag: string }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const tags: Array<{ tag: string }> = [];
    for (const entry of value) {
        if (isCacheTagEntry(entry) && typeof entry.tag === 'string') {
            tags.push({ tag: entry.tag });
        }
    }
    return tags.length ? tags : undefined;
}

function isCacheTagEntry(value: unknown): value is { tag?: unknown } {
    return typeof value === 'object' && value !== null && 'tag' in value;
}

export function collectTags(metadata: Record<string, unknown>, cacheTags?: Array<{ tag: string }>): string[] {
    const tagSet = new Set<string>();
    addTagsFromValue(tagSet, metadata.tags);

    if (cacheTags) {
        for (const tag of cacheTags) {
            if (tag?.tag) addTagsFromValue(tagSet, tag.tag);
        }
    }

    return Array.from(tagSet.values());
}

export function collectFieldTags(metadata: Record<string, unknown>, keys: string[]): string[] {
    const tagSet = new Set<string>();
    for (const key of keys) {
        addTagsFromValue(tagSet, metadata[key]);
    }
    return Array.from(tagSet.values());
}

function getNameSortGroup(name: string): number {
    const trimmed = name.trim();
    if (!trimmed) return 3;
    const firstChar = trimmed[0];
    if (firstChar >= '0' && firstChar <= '9') return 0;
    if (/[a-z]/i.test(firstChar)) return 1;
    if (/[\u0430-\u044f\u0451]/i.test(firstChar)) return 2;
    return 3;
}

export function compareNames(aName: string, bName: string): number {
    const a = String(aName || '').toLowerCase();
    const b = String(bName || '').toLowerCase();
    const aGroup = getNameSortGroup(a);
    const bGroup = getNameSortGroup(b);
    if (aGroup !== bGroup) return aGroup - bGroup;

    const locale = aGroup === 2 ? 'ru' : 'en';
    return a.localeCompare(b, locale, { numeric: true, sensitivity: 'base' });
}

export function hasAllValues(values: string[] | undefined, required: readonly string[]): boolean {
    if (!values || values.length < required.length) return false;
    if (required.length === 0) return true;

    const valueSet = new Set(values);
    for (const value of required) {
        if (!valueSet.has(value)) return false;
    }
    return true;
}
