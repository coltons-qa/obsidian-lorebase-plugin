import { describe, expect, it } from 'vitest';
import {
    FIELD_REGISTRY,
    getProviderAliases,
} from '../src/fields/registry';
import { FIELD_ALIASES } from '../src/services/integrations/enrichment';
import type { MediaKind } from '../src/services/integrations/types';

/**
 * The template builder, field lists and settings checkboxes are generated from the
 * registry, and `templateOutputSnapshots.test.ts` holds their pre-registry output. What is
 * still hand-maintained, the enrichment aliases, is checked against the registry here.
 */
const KINDS: MediaKind[] = ['games', 'anime', 'movies', 'tv', 'books', 'manga'];
const MIGRATED: MediaKind[] = ['games', 'movies', 'tv', 'books'];

describe('field registry matches the enrichment aliases', () => {
    it.each(MIGRATED)('%s provider aliases agree with FIELD_ALIASES', (kind) => {
        for (const [providerField, key] of Object.entries(getProviderAliases(kind))) {
            expect([providerField, FIELD_ALIASES[providerField]?.[0]]).toEqual([providerField, key]);
        }
    });

    it('covers every FIELD_ALIASES entry in some kind', () => {
        const covered = new Set(KINDS.flatMap((kind) => Object.keys(getProviderAliases(kind))));
        expect(Object.keys(FIELD_ALIASES).filter((providerField) => !covered.has(providerField))).toEqual([]);
    });

    it('gives each field name at most once per kind', () => {
        for (const kind of KINDS) {
            const names = FIELD_REGISTRY[kind].map((field) => field.name);
            expect(names.length).toBe(new Set(names).size);
        }
    });
});
