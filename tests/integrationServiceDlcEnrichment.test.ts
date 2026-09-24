import { describe, expect, it } from 'vitest';
import { IntegrationService } from '../src/services/IntegrationService';
import type { JsonFetcher } from '../src/services/integrations/providers/common';
import type { MediaSourceSelection } from '../src/services/integrations/types';
import { synchronizeProviderMetadata } from '../src/services/integrations/enrichment';
import type { GameDlc } from '../src/types';
import { createMockApp } from './helpers/testHelpers';
import { DEFAULT_SETTINGS } from '../src/constants';

/**
 * A refresh put the provider's GameDlc objects on the patch as-is, so a game with no
 * DLC yet had `imageUrl` and `userRating` written into its note, keys the DLC reader
 * does not read. The patch must carry DLC in the note's own shape.
 */
describe('IntegrationService DLC enrichment', () => {
    const providerDlc: GameDlc[] = [{
        id: '128650',
        provider: 'igdb',
        title: 'Metro: Last Light - Chronicles Pack',
        imageUrl: 'https://images.igdb.com/co7z8z.jpg',
        url: 'https://www.igdb.com/games/128650',
        userRating: null,
    }];

    const buildService = () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.integrations.enabled = true;
        settings.integrations.providers.igdb.enabled = true;
        settings.integrations.providers.igdb.apiKey = 'client-id';
        settings.integrations.providers.igdb.clientSecret = 'client-secret';
        const service = new IntegrationService(createMockApp({}), () => settings);
        const fetchJson: JsonFetcher = async (url) => {
            if (url.includes('oauth2/token')) return { access_token: 'token' };
            if (url.includes('/games')) return [{ id: 5, name: 'Metro Last Light', summary: 'Tunnels.' }];
            return [];
        };
        const internals = service as unknown as {
            jsonFetcher: JsonFetcher;
            fetchDlcForSource: () => Promise<GameDlc[]>;
        };
        internals.jsonFetcher = fetchJson;
        internals.fetchDlcForSource = async () => providerDlc;
        return service;
    };

    const source = { id: '5', provider: 'igdb', title: 'Metro Last Light' } as MediaSourceSelection;

    it('sends DLC in the note shape, without personal fields', async () => {
        const patch = await buildService().getMediaEnrichment('games', source);

        expect(patch?.values.dlc).toEqual([{
            id: '128650',
            provider: 'igdb',
            title: 'Metro: Last Light - Chronicles Pack',
            image: 'https://images.igdb.com/co7z8z.jpg',
            url: 'https://www.igdb.com/games/128650',
        }]);
    });

    it('refreshes existing DLC without adding camelCase keys or touching the rating', async () => {
        const patch = await buildService().getMediaEnrichment('games', source);
        const current = {
            title: 'Metro Last Light',
            dlc: [{ id: '128650', provider: 'igdb', title: 'Chronicles Pack', image: 'https://old.example/a.jpg', 'user-rating': 6, owned: true }],
        };

        const merged = synchronizeProviderMetadata(current, patch!.values, source);
        const entry = (merged.values.dlc as Array<Record<string, unknown>>)[0];

        expect(entry).not.toHaveProperty('imageUrl');
        expect(entry).not.toHaveProperty('userRating');
        expect(entry['user-rating']).toBe(6);
        expect(entry.owned).toBe(true);
    });
});
