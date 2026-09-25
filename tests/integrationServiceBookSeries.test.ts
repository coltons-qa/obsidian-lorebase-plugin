import { describe, expect, it } from 'vitest';
import { IntegrationService } from '../src/services/IntegrationService';
import type { JsonFetcher } from '../src/services/integrations/providers/common';
import type { MediaSourceSelection } from '../src/services/integrations/types';
import { createMockApp } from './helpers/testHelpers';
import { DEFAULT_SETTINGS } from '../src/constants';

/**
 * Mirrors the gameSeries enrichment tests for books.
 * The refresh/relink path (getMediaEnrichment) hand-lists the fields it copies
 * out of buildBookValues. bookSeries must appear in both.
 */
describe('IntegrationService book series enrichment', () => {
    const buildService = () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.integrations!.enabled = true;
        settings.integrations!.providers.hardcover.enabled = true;
        settings.integrations!.providers.hardcover.apiKey = 'test-key';

        const service = new IntegrationService(createMockApp({}), () => settings);

        const fetchJson: JsonFetcher = async () => {
            return {
                data: {
                    books_by_pk: {
                        id: 42,
                        title: 'The Way of Kings',
                        description: 'Epic fantasy.',
                        pages: 1007,
                        release_date: '2010-08-31',
                        slug: 'the-way-of-kings',
                        cached_contributors: [{ name: 'Brandon Sanderson' }],
                        cached_tags: { Genre: [{ tag: 'Fantasy' }] },
                        image: { url: 'https://img.example/wok.jpg' },
                        default_physical_edition: {
                            pages: 1007,
                            release_date: '2010-08-31',
                            publisher: { name: 'Tor Books' },
                            image: { url: 'https://img.example/wok-edition.jpg' },
                        },
                        contributions: [],
                        cached_featured_series: {
                            series: { name: 'The Stormlight Archive' },
                            position: 1.0,
                        },
                    },
                },
            };
        };
        (service as unknown as { jsonFetcher: JsonFetcher }).jsonFetcher = fetchJson;
        return service;
    };

    const source: MediaSourceSelection = {
        id: '42',
        provider: 'hardcover',
        title: 'The Way of Kings',
    } as MediaSourceSelection;

    it('carries bookSeries through the refresh path, not just note creation', async () => {
        const service = buildService();

        const patch = await service.getMediaEnrichment('books', source);

        expect(patch).not.toBeNull();
        expect(patch?.values.bookSeries).toBe('The Stormlight Archive');
    });

    it('carries seriesPosition through the refresh path', async () => {
        const service = buildService();

        const patch = await service.getMediaEnrichment('books', source);

        expect(patch).not.toBeNull();
        expect(patch?.values.seriesPosition).toBe(1);
    });

    it('keeps refresh values in sync with the fields buildBookValues produces', async () => {
        const service = buildService();

        const patch = await service.getMediaEnrichment('books', source);

        expect(Object.keys(patch?.values ?? {})).toContain('bookSeries');
        expect(Object.keys(patch?.values ?? {})).toContain('seriesPosition');
    });
});
