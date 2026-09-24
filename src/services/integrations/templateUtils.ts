import type { MediaKind } from './types';
import { buildTemplateFromRegistry, getAllowedTemplateFields } from '../../fields/registry';

const GAME_HLTB_TEMPLATE_FIELDS = ['main', 'main_plus_sides', 'perfectionist', 'completionist'];
const NUMERIC_HLTB_TEMPLATE_FIELDS = new Set(['main', 'main_plus_sides', 'perfectionist', 'completionist']);

/** Every field the simple template accepts for a kind (HowLongToBeat fields aside). */
export function getDefaultTemplateFields(kind: MediaKind): string[] {
    return getAllowedTemplateFields(kind);
}

export function getEffectiveSimpleTemplateFields(
    kind: MediaKind,
    fields: string[],
    options: { howLongToBeatEnabled?: boolean } = {}
): string[] {
    const allowed = new Set(getDefaultTemplateFields(kind));
    if (kind === 'games' && options.howLongToBeatEnabled) {
        GAME_HLTB_TEMPLATE_FIELDS.forEach((field) => allowed.add(field));
    }

    const normalized: string[] = [];
    for (const key of fields) {
        if (!allowed.has(key)) continue;
        const normalizedKey = key === 'completionist' ? 'perfectionist' : key;
        if (normalized.includes(normalizedKey)) continue;
        normalized.push(normalizedKey);
    }

    return normalized;
}

/**
 * The simple template for a field selection, generated from the field registry. Lines
 * follow the order of `fields`; unknown, retired and manual fields emit nothing.
 */
export function buildSimpleTemplate(kind: MediaKind, fields: string[]): string {
    return buildTemplateFromRegistry(kind, fields);
}

export function renderTemplate(template: string, values: Record<string, unknown>): string {
    const lines = template.split(/\r?\n/);
    const output: string[] = [];
    const placeholderRegex = /\{\{VALUE:([A-Za-z0-9_]+)\}\}/g;

    for (const line of lines) {
        const match = line.match(/\{\{VALUE:([A-Za-z0-9_]+)\}\}/);
        if (!match) {
            output.push(line);
            continue;
        }

        const key = match[1];
        const value = values[key];
        if (typeof value === 'string' && value.includes('\n') && line.trim() === `{{VALUE:${key}}}`) {
            output.push(value);
            continue;
        }

        if (NUMERIC_HLTB_TEMPLATE_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
            const numericKeyMatch = line.match(
                /^(\s*[^:]+:\s*)"?\{\{VALUE:[A-Za-z0-9_]+\}\}"?\s*$/
            );
            if (numericKeyMatch) {
                output.push(`${numericKeyMatch[1]}${value}`);
                continue;
            }
        }

        if (key === 'released' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const dateKeyMatch = line.match(
                /^(\s*[^:]+:\s*)"?\{\{VALUE:released\}\}"?\s*$/
            );
            if (dateKeyMatch) {
                output.push(`${dateKeyMatch[1]}${value}`);
                continue;
            }
        }

        if (Array.isArray(value)) {
            const listItemMatch = line.match(/^(\s*)-\s*"?\{\{VALUE:[A-Za-z0-9_]+\}\}"?\s*$/);
            if (listItemMatch) {
                const indent = listItemMatch[1];
                if (!value.length) {
                    output.push(`${indent}[]`);
                    continue;
                }
                for (const item of value) {
                    output.push(`${indent}- "${escapeYaml(item)}"`);
                }
                continue;
            }

            const keyMatch = line.match(/^(\s*)([^:]+):\s*"?\{\{VALUE:[A-Za-z0-9_]+\}\}"?\s*$/);
            if (keyMatch) {
                const indent = keyMatch[1];
                const keyName = keyMatch[2].trim();
                if (!value.length) {
                    output.push(`${indent}${keyName}: []`);
                    continue;
                }
                output.push(`${indent}${keyName}:`);
                const childIndent = `${indent}  `;
                for (const item of value) {
                    output.push(`${childIndent}- "${escapeYaml(item)}"`);
                }
                continue;
            }
        }

        const replaced = line.replace(placeholderRegex, (_: string, k: string) => {
            const raw = values[k];
            if (Array.isArray(raw)) {
                return raw.map((v) => escapeYaml(v)).join(', ');
            }
            return escapeYaml(toStringSafe(raw));
        });
        output.push(replaced);
    }

    return output.join('\n');
}

/**
 * Provider identity is operational metadata rather than an optional display
 * field. Keep it in frontmatter even when a device still has an older custom
 * template that predates the integration source fields.
 */
/**
 * Games, movies, TV and books were migrated to lower-kebab-case note keys. Anime and
 * manga were excluded from that migration and their services still read only the
 * legacy spellings.
 */
export function usesKebabKeys(kind: MediaKind): boolean {
    return kind === 'games' || kind === 'movies' || kind === 'tv' || kind === 'books';
}

/**
 * Guarantees the provider identity is in the frontmatter, in the spelling the kind's
 * service reads, and removes the other spelling so a note never carries both. Without a
 * kind it keeps the legacy spelling, which is what anime and manga read.
 */
export function ensureIntegrationSourceFrontmatter(
    content: string,
    provider: string,
    id: string,
    kind?: MediaKind
): string {
    const safeProvider = escapeYaml(provider.trim());
    const safeId = escapeYaml(id.trim());
    if (!safeProvider || !safeId) return content;

    const kebab = kind !== undefined && usesKebabKeys(kind);
    const providerKey = kebab ? 'integration-provider' : 'integration_provider';
    const idKey = kebab ? 'integration-id' : 'integration_id';
    const otherProviderKey = kebab ? 'integration_provider' : 'integration-provider';
    const otherIdKey = kebab ? 'integration_id' : 'integration-id';
    const sourceLines = [
        `${providerKey}: "${safeProvider}"`,
        `${idKey}: "${safeId}"`,
    ];
    const frontmatterMatch = content.match(/^(\uFEFF?[ \t]*---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
    if (!frontmatterMatch) {
        return `---\n${sourceLines.join('\n')}\n---\n${content}`;
    }

    const keyPattern = (key: string): RegExp => new RegExp(`^\\s*${key}\\s*:`);
    const bodyLines = frontmatterMatch[2].split(/\r?\n/)
        .filter((line) => !keyPattern(otherProviderKey).test(line) && !keyPattern(otherIdKey).test(line));
    const replaceOrAppend = (key: string, line: string): void => {
        const index = bodyLines.findIndex((candidate) => keyPattern(key).test(candidate));
        if (index >= 0) bodyLines[index] = line;
        else bodyLines.push(line);
    };
    replaceOrAppend(providerKey, sourceLines[0]);
    replaceOrAppend(idKey, sourceLines[1]);

    return `${frontmatterMatch[1]}${bodyLines.join('\n')}${frontmatterMatch[3]}${content.slice(frontmatterMatch[0].length)}`;
}

/**
 * Sets one quoted string field in rendered note content, replacing the line if the key
 * is already there and appending it to the frontmatter otherwise. For values a template
 * has no placeholder for.
 */
export function setFrontmatterField(content: string, key: string, value: string): string {
    const line = `${key}: "${escapeYaml(value.trim())}"`;
    const frontmatterMatch = content.match(/^(\uFEFF?[ \t]*---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
    if (!frontmatterMatch) return `---\n${line}\n---\n${content}`;

    const bodyLines = frontmatterMatch[2].split(/\r?\n/);
    const index = bodyLines.findIndex((candidate) => new RegExp(`^\\s*${key}\\s*:`).test(candidate));
    if (index >= 0) bodyLines[index] = line;
    else bodyLines.push(line);
    return `${frontmatterMatch[1]}${bodyLines.join('\n')}${frontmatterMatch[3]}${content.slice(frontmatterMatch[0].length)}`;
}

export function sanitizeFileName(name: string): string {
    return name.replace(/[*\\/<>:|?"]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeYaml(value: unknown): string {
    const text = toStringSafe(value);
    return text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

function toStringSafe(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
}
