import { describe, expect, it } from 'vitest';
import { buildSimpleTemplate, getDefaultTemplateFields } from '../src/services/integrations/templateUtils';
import { DEFAULT_SETTINGS } from '../src/constants';
import * as SettingsFields from '../src/settings/sections/constants';
import { FIELD_ALIASES } from '../src/services/integrations/enrichment';
import type { MediaKind } from '../src/services/integrations/types';

/**
 * Golden outputs recorded before the template builder, field lists, settings
 * checkboxes and enrichment aliases moved onto the field registry. A diff here means note output changed.
 */
const KINDS: MediaKind[] = ['games', 'anime', 'movies', 'tv', 'books', 'manga'];

describe('template output snapshots', () => {
    it.each(KINDS)('%s: template for every allowed field', (kind) => {
        expect(buildSimpleTemplate(kind, getDefaultTemplateFields(kind))).toMatchSnapshot();
    });

    it.each(KINDS)('%s: template for the default selection', (kind) => {
        expect(buildSimpleTemplate(kind, DEFAULT_SETTINGS.integrations!.media[kind].templateFields)).toMatchSnapshot();
    });

    it('games: template with HowLongToBeat fields', () => {
        expect(buildSimpleTemplate('games', [...getDefaultTemplateFields('games'), 'main', 'main_plus_sides', 'completionist'])).toMatchSnapshot();
    });

    it.each(KINDS)('%s: allowed field list', (kind) => {
        expect(getDefaultTemplateFields(kind)).toMatchSnapshot();
    });

    it('settings checkbox lists', () => {
        expect({
            games: SettingsFields.GAME_TEMPLATE_FIELDS,
            gamesHltb: SettingsFields.GAME_TEMPLATE_FIELDS_HLTB,
            anime: SettingsFields.ANIME_TEMPLATE_FIELDS,
            movies: SettingsFields.MOVIE_TEMPLATE_FIELDS,
            tv: SettingsFields.TV_TEMPLATE_FIELDS,
            books: SettingsFields.BOOK_TEMPLATE_FIELDS,
            manga: SettingsFields.MANGA_TEMPLATE_FIELDS,
        }).toMatchSnapshot();
    });

    it('combined enrichment alias map', () => {
        expect(FIELD_ALIASES).toMatchSnapshot();
    });
});
