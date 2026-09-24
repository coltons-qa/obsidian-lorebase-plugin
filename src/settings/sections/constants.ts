import type { TemplateFieldDef } from './types';
import { getSettingsTemplateFields } from '../../fields/registry';

export const ICON_GENERAL = String.fromCodePoint(0x2699);
export const ICON_CARD_CUSTOMIZATION = String.fromCodePoint(0x1F6E0);
export const ICON_MEDIA = String.fromCodePoint(0x1F5C2);
export const ICON_INTEGRATIONS = String.fromCodePoint(0x1F50C);
export const LABEL_RU = '\u0420\u0443\u0441\u0441\u043a\u0438\u0439';
export const LABEL_UK = '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430';

export const GAME_TEMPLATE_FIELDS: TemplateFieldDef[] = getSettingsTemplateFields('games');

export const GAME_TEMPLATE_FIELDS_HLTB: TemplateFieldDef[] = getSettingsTemplateFields('games', { hltb: true });

export const ANIME_TEMPLATE_FIELDS: TemplateFieldDef[] = getSettingsTemplateFields('anime');

export const MOVIE_TEMPLATE_FIELDS: TemplateFieldDef[] = getSettingsTemplateFields('movies');

export const TV_TEMPLATE_FIELDS: TemplateFieldDef[] = getSettingsTemplateFields('tv');

export const BOOK_TEMPLATE_FIELDS: TemplateFieldDef[] = getSettingsTemplateFields('books');

export const MANGA_TEMPLATE_FIELDS: TemplateFieldDef[] = getSettingsTemplateFields('manga');
