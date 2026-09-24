/**
 * LOREBASE - Registry-driven frontmatter reading and writing
 *
 * Services read and write their simple fields through these helpers, which take each
 * field's key, older spellings and value handling from the field registry. Writing always
 * targets the registry's key and clears any older spelling the note still carries, so a
 * save converges a note instead of leaving two spellings.
 */

import { isTruthy } from '../services/media/serviceUtils';
import { FIELD_REGISTRY, getField, getLegacyKeys, type FieldSpec } from './registry';
import type { MediaKind } from '../services/integrations/types';

type Frontmatter = Record<string, unknown>;

/** Text of a value: list entries joined with ', ', trimmed, null when empty. */
export function readText(frontmatter: Frontmatter, key: string): string | null {
    const value = frontmatter[key];
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) {
        const joined = value.map((item) => String(item).trim()).filter(Boolean).join(', ');
        return joined || null;
    }
    const text = String(value).trim();
    return text || null;
}

/** A finite number, parsing numeric strings; null otherwise. */
export function readNumber(frontmatter: Frontmatter, key: string): number | null {
    const value = frontmatter[key];
    if (value === undefined || value === null || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every bound field of a kind, read from a note, keyed by item property. Services spread
 * this into the item they build and handle the fields with real logic themselves.
 */
export function readBoundFields(kind: MediaKind, frontmatter: Frontmatter): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const field of FIELD_REGISTRY[kind]) {
        if (!field.item) continue;
        const key = field.keys[0];
        switch (field.item.read) {
            case 'text': values[field.item.prop] = readText(frontmatter, key); break;
            case 'textOrEmpty': values[field.item.prop] = readText(frontmatter, key) ?? ''; break;
            case 'number': values[field.item.prop] = readNumber(frontmatter, key); break;
            case 'boolean': values[field.item.prop] = isTruthy(frontmatter[key]); break;
        }
    }
    return values;
}

/**
 * Sets `key` (the field's primary key by default) and clears the older spellings of it
 * that the note still carries.
 */
export function writeField(
    out: Frontmatter,
    frontmatter: Frontmatter | null | undefined,
    field: FieldSpec,
    value: unknown,
    key = field.keys[0]
): void {
    out[key] = value;
    for (const legacy of getLegacyKeys(field, key)) {
        if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, legacy)) out[legacy] = null;
    }
}

/** Writes one field of a kind by name. */
export function writeNamedField(
    kind: MediaKind,
    out: Frontmatter,
    frontmatter: Frontmatter | null | undefined,
    name: string,
    value: unknown,
    key?: string
): void {
    writeField(out, frontmatter, getField(kind, name), value, key);
}

/** Writes every bound field whose item property is present in `updates`. */
export function writeBoundFields(
    kind: MediaKind,
    out: Frontmatter,
    frontmatter: Frontmatter | null | undefined,
    updates: Record<string, unknown>
): void {
    for (const field of FIELD_REGISTRY[kind]) {
        if (!field.item || !(field.item.prop in updates)) continue;
        const value = updates[field.item.prop];
        switch (field.item.write) {
            case 'raw': writeField(out, frontmatter, field, value); break;
            case 'orNull': writeField(out, frontmatter, field, value || null); break;
            case 'orEmpty': writeField(out, frontmatter, field, value || ''); break;
            case 'orFalse': writeField(out, frontmatter, field, value ?? false); break;
            case 'nullish': writeField(out, frontmatter, field, value ?? null); break;
        }
    }
}

/** The YAML key a kind stores a field under. */
export function keyOf(kind: MediaKind, name: string, index = 0): string {
    return getField(kind, name).keys[index];
}
