import { describe, expect, it } from 'vitest';
import {
    buildTemplateFromRegistry,
    FIELD_REGISTRY,
    getAllowedTemplateFields,
    getDefaultOnTemplateFields,
    getProviderAliases,
    getSettingsTemplateFields,
} from '../src/fields/registry';
import { buildSimpleTemplate, getDefaultTemplateFields } from '../src/services/integrations/templateUtils';
import { FIELD_ALIASES } from '../src/services/integrations/enrichment';
import { DEFAULT_SETTINGS } from '../src/constants';
import * as SettingsFields from '../src/settings/sections/constants';
import type { MediaKind } from '../src/services/integrations/types';

/**
 * Characterization: the registry must reproduce what the hand-maintained lists and the
 * template builder do today, exactly, before anything is switched over to it.
 */
const KINDS: MediaKind[] = ['games', 'anime', 'movies', 'tv', 'books', 'manga'];
const MIGRATED: MediaKind[] = ['games', 'movies', 'tv', 'books'];
const SETTINGS_LISTS: Record<MediaKind, Array<{ key: string; label: string }>> = {
    games: SettingsFields.GAME_TEMPLATE_FIELDS,
    anime: SettingsFields.ANIME_TEMPLATE_FIELDS,
    movies: SettingsFields.MOVIE_TEMPLATE_FIELDS,
    tv: SettingsFields.TV_TEMPLATE_FIELDS,
    books: SettingsFields.BOOK_TEMPLATE_FIELDS,
    manga: SettingsFields.MANGA_TEMPLATE_FIELDS,
};

describe('field registry matches the hand-maintained lists', () => {
    it.each(KINDS)('%s settings checkboxes', (kind) => {
        expect(getSettingsTemplateFields(kind)).toEqual(SETTINGS_LISTS[kind]);
    });

    it('games HowLongToBeat checkboxes', () => {
        expect(getSettingsTemplateFields('games', { hltb: true })).toEqual(SettingsFields.GAME_TEMPLATE_FIELDS_HLTB);
    });

    it.each(KINDS)('%s allowed template fields', (kind) => {
        expect(getAllowedTemplateFields(kind)).toEqual(getDefaultTemplateFields(kind));
    });

    // Compared as members: the games constant lists `owned` before `favorite` (inserted
    // there by fdb7971) while the registry keeps settings order. `owned` emits no line,
    // so the position changes no template; the builder comparison below covers that.
    it.each(KINDS)('%s fresh-install default fields', (kind) => {
        const current = DEFAULT_SETTINGS.integrations!.media[kind].templateFields;
        expect([...getDefaultOnTemplateFields(kind)].sort()).toEqual([...current].sort());
    });
});

describe('field registry matches the template builder', () => {
    const selections = (kind: MediaKind): Record<string, string[]> => {
        const allowed = getDefaultTemplateFields(kind);
        const selected: Record<string, string[]> = {
            allowed,
            defaults: DEFAULT_SETTINGS.integrations!.media[kind].templateFields,
            reversed: [...allowed].reverse(),
            everyOther: allowed.filter((_, index) => index % 2 === 0),
            unknownField: ['type', 'adult', 'name'],
        };
        if (kind === 'games') {
            selected.withHltb = [...allowed, 'main', 'main_plus_sides', 'perfectionist'];
            selected.completionistAlias = ['name', 'completionist', 'main'];
        }
        return selected;
    };

    for (const kind of KINDS) {
        for (const [label, fields] of Object.entries(selections(kind))) {
            it(`${kind}: ${label}`, () => {
                expect(buildTemplateFromRegistry(kind, fields)).toBe(buildSimpleTemplate(kind, fields));
            });
        }
    }
});

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
