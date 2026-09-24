import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/constants';
import { migrateLegacyJikanMangaSettings, migrateSeriesSettingsToTv } from '../src/settings/settingsNormalization';

describe('settings migrations', () => {
    it('migrates the removed Jikan manga default once and records the version', () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.integrations!.media.manga.provider = 'jikan';
        settings.integrations!.providers.jikan.enabled = true;
        const savedIntegrations = structuredClone(settings.integrations!);
        delete (savedIntegrations.providers as Partial<typeof savedIntegrations.providers>).mangaupdates;

        expect(migrateLegacyJikanMangaSettings(settings, savedIntegrations)).toBe(true);
        expect(settings.integrations?.media.manga.provider).toBe('mangaupdates');
        expect(settings.integrations?.providers.mangaupdates.enabled).toBe(true);
        expect(settings.migrations?.jikanMangaProviderV1).toBe(true);

        settings.integrations!.providers.jikan.enabled = false;
        expect(migrateLegacyJikanMangaSettings(settings, savedIntegrations)).toBe(false);
        expect(settings.integrations?.providers.mangaupdates.enabled).toBe(true);
    });
});

describe('series to tv settings migration', () => {
    it('moves top-level series keys to tv', () => {
        const raw: Record<string, unknown> = {
            series: { folderPath: 'Shows' },
            enabledMedia: { games: true, series: false },
            seriesBadges: { position: 'top-left' },
        };

        expect(migrateSeriesSettingsToTv(raw)).toBe(true);

        expect(raw.tv).toEqual({ folderPath: 'Shows' });
        expect(raw).not.toHaveProperty('series');
        expect(raw.enabledMedia).toEqual({ games: true, tv: false });
        expect(raw.tvBadges).toEqual({ position: 'top-left' });
        expect(raw).not.toHaveProperty('seriesBadges');
    });

    it('moves the series integration template onto tv and renames its parts field', () => {
        // The first tv build migrated top-level keys but not this one, and saved a
        // default `tv` entry beside the user's `series` entry. The series entry is
        // the user's, so it wins.
        const raw: Record<string, unknown> = {
            integrations: {
                media: {
                    tv: { provider: 'tmdb', templateFields: ['type', 'name', 'tvParts'] },
                    series: { provider: 'tmdb', templateFields: ['type', 'name', 'actors', 'seriesParts'] },
                },
            },
        };

        expect(migrateSeriesSettingsToTv(raw)).toBe(true);

        const media = (raw.integrations as { media: Record<string, { templateFields: string[] }> }).media;
        expect(media).not.toHaveProperty('series');
        expect(media.tv.templateFields).toEqual(['type', 'name', 'actors', 'tvParts']);
    });

    it('reports no change for settings already on tv', () => {
        const raw: Record<string, unknown> = {
            tv: { folderPath: 'Library' },
            integrations: { media: { tv: { provider: 'tmdb', templateFields: ['tvParts'] } } },
        };
        expect(migrateSeriesSettingsToTv(raw)).toBe(false);
    });
});
