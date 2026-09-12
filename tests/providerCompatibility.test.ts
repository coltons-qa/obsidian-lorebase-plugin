import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/constants';
import { IntegrationService } from '../src/services/IntegrationService';
import type { MediaKind, ProviderId } from '../src/services/integrations/types';
import { createMockApp } from './helpers/testHelpers';

describe('provider compatibility matrix', () => {
    it.each<[MediaKind, ProviderId[]]>([
        ['games', ['rawg', 'steam', 'igdb']],
        ['anime', ['anilist', 'jikan', 'shikimori']],
        ['movies', ['tmdb', 'omdb']],
        ['tv', ['tmdb', 'tvmaze', 'omdb']],
        ['books', ['hardcover', 'googlebooks']],
        ['manga', ['anilist', 'shikimori', 'mangaupdates', 'mangadex']],
    ])('offers only compatible providers for %s', (kind, expected) => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        for (const provider of Object.values(settings.integrations!.providers)) {
            provider.enabled = true;
            provider.apiKey = 'key';
            provider.clientSecret = 'secret';
        }
        const service = new IntegrationService(createMockApp({}), () => settings);
        const getProviderOptions = (service as unknown as {
            getProviderOptions(value: MediaKind): Array<{ id: ProviderId }>;
        }).getProviderOptions.bind(service);

        expect(getProviderOptions(kind).map((provider) => provider.id)).toEqual(expected);
    });

    it('keeps legacy Jikan manga support out of new manga searches', () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        const service = new IntegrationService(createMockApp({}), () => settings);
        const options = (service as unknown as {
            getProviderOptions(value: MediaKind): Array<{ id: ProviderId }>;
        }).getProviderOptions('manga');

        expect(options.map((provider) => provider.id)).not.toContain('jikan');
    });
});
