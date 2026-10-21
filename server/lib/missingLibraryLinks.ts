import type { JellyfinLibraryItemExtended } from '@server/api/jellyfin';

export interface MissingLibraryMedia {
  tmdbId: number;
  mediaType: string;
}

export const RECOVERY_PAGE_SIZE = 250;

// Recent-only scans must also recover older imports whose availability was
// reported by ARR before Jellyfin's item ID was attached. Read one DB-backed
// summary page per enabled library, only while an available link is missing.
// Keep a cursor so a large library does not repeatedly inspect its first page.
export class MissingLibraryLinkRecovery {
  private cursors = new Map<string, number>();

  public async find(
    libraryId: string,
    candidates: MissingLibraryMedia[],
    loadPage: (start: number, limit: number) => Promise<{
      Items: JellyfinLibraryItemExtended[];
      TotalRecordCount: number;
    }>
  ): Promise<JellyfinLibraryItemExtended[]> {
    if (!candidates.length) {
      this.cursors.delete(libraryId);
      return [];
    }
    const wanted = new Set(candidates.map((media) =>
      `${media.mediaType}:${media.tmdbId}`));
    const start = this.cursors.get(libraryId) ?? 0;
    const page = await loadPage(start, RECOVERY_PAGE_SIZE);
    // Advance only after success. An outage retries the same page next run.
    this.cursors.set(libraryId,
      page.Items.length && start + page.Items.length < page.TotalRecordCount
        ? start + page.Items.length : 0);
    const seen = new Set<string>();
    return page.Items.filter((item) => {
      if (!item.Id || seen.has(item.Id) || item.LocationType === 'Virtual') return false;
      const type = item.Type === 'Movie' ? 'movie' : item.Type === 'Series' ? 'tv' : '';
      // Some Jellyfin versions ignore provider-ID query filters. Always match
      // the actual returned provider AND media type before processing anything.
      const id = item.ProviderIds?.Tmdb || item.ProviderIds?.TheMovieDb;
      if (!type || !id || !/^\d+$/.test(String(id)) || !wanted.has(`${type}:${Number(id)}`)) return false;
      seen.add(item.Id);
      return true;
    });
  }
}
