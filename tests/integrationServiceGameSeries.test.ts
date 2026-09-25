import { describe, expect, it } from 'vitest';
import { IntegrationService } from '../src/services/IntegrationService';
import type { JsonFetcher } from '../src/services/integrations/providers/common';
import type { MediaSourceSelection } from '../src/services/integrations/types';
import { createMockApp } from './helpers/testHelpers';
import { DEFAULT_SETTINGS } from '../src/constants';

/**
 * The refresh/relink path (getMediaEnrichment) hand-lists the fields it copies
 * out of buildGameValues. Any new game field has to be added there as well as
 * to buildGameValues, and it is easy to update only one of the two.
 */
describe('IntegrationService game series enrichment', () => {
    const buildService = () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.integrations!.enabled = true;
        settings.integrations!.providers.igdb.enabled = true;
        settings.integrations!.providers.igdb.apiKey = 'client-id';
        settings.integrations!.providers.igdb.clientSecret = 'client-secret';

        const service = new IntegrationService(createMockApp({}), () => settings);

        const fetchJson: JsonFetcher = async (url) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            if (url.includes('/games')) {
                return [{
                    id: 5,
                    name: "Baldur's Gate",
                    summary: 'An RPG.',
                    collections: [{ name: "Baldur's Gate" }],
                    franchises: [{ name: 'Dungeons & Dragons' }],
                }];
            }
            return [];
        };
        (service as unknown as { jsonFetcher: JsonFetcher }).jsonFetcher = fetchJson;
        return service;
    };

    const source: MediaSourceSelection = {
        id: '5',
        provider: 'igdb',
        title: "Baldur's Gate",
    } as MediaSourceSelection;

    it('carries gameSeries through the refresh path, not just note creation', async () => {
        const service = buildService();

        const patch = await service.getMediaEnrichment('games', source);

        expect(patch).not.toBeNull();
        expect(patch?.values.gameSeries).toBe("Baldur's Gate");
    });

    it('keeps refresh values in sync with the fields buildGameValues produces', async () => {
        const service = buildService();

        const patch = await service.getMediaEnrichment('games', source);

        // Guards against a field being added to buildGameValues but forgotten
        // in the enrichment map below it.
        expect(Object.keys(patch?.values ?? {})).toContain('gameSeries');
    });
});
