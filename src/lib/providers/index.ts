/**
 * Provider registry.
 *
 * The UI asks this module for "the metadata providers" and never imports a
 * concrete provider. Adding a source means adding one file and one line here.
 */

import { DiscogsProvider } from "./discogs";
import { MusicBrainzProvider } from "./musicbrainz";
import type { MetadataProvider, ProviderSettings, Release } from "./types";

export * from "./types";
export { MusicBrainzProvider } from "./musicbrainz";
export { DiscogsProvider } from "./discogs";
export * from "./matching";

export class ProviderRegistry {
  private providers = new Map<string, MetadataProvider>();

  constructor(settings: ProviderSettings = {}) {
    this.register(new MusicBrainzProvider(settings));
    this.register(new DiscogsProvider(settings));
  }

  register(provider: MetadataProvider) {
    this.providers.set(provider.id, provider);
  }

  configure(settings: ProviderSettings) {
    for (const provider of this.providers.values()) {
      const configure = (provider as { configure?: (s: ProviderSettings) => void }).configure;
      configure?.call(provider, settings);
    }
  }

  get(id: string): MetadataProvider | undefined {
    return this.providers.get(id);
  }

  all(): MetadataProvider[] {
    return [...this.providers.values()];
  }

  enabled(settings: ProviderSettings): MetadataProvider[] {
    return this.all().filter((p) => !p.requiresCredentials || settings.discogsToken);
  }

  /** Search every enabled provider and merge, keeping each result tagged. */
  async searchAll(query: Parameters<MetadataProvider["search"]>[0], settings: ProviderSettings) {
    const providers = this.enabled(settings);
    const settled = await Promise.allSettled(providers.map((p) => p.search(query)));
    const results: Release[] = [];
    const errors: Array<{ provider: string; message: string }> = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") results.push(...outcome.value);
      else errors.push({ provider: providers[i].label, message: (outcome.reason as Error).message });
    });
    return { results, errors };
  }
}