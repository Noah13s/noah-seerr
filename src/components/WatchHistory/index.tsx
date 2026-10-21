import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useUser } from '@app/hooks/useUser';
import { WATCH_HISTORY_SUMMARY_KEY } from '@app/hooks/useWatchHistoryStatus';
import {
  BookmarkIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FilmIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PencilSquareIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  TvIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { WatchlistResponse } from '@server/interfaces/api/discoverInterfaces';
import type {
  WatchHistoryItem,
  WatchHistoryPublicRatingsResponse,
  WatchHistoryResponse,
} from '@server/interfaces/api/watchHistoryInterfaces';
import { isRewatching, latestActiveViewing } from '@server/lib/viewingProgress';
import type { MovieResult, TvResult } from '@server/models/Search';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useIntl } from 'react-intl';
import useSWR, { mutate as mutateGlobal } from 'swr';

type Status = 'planned' | 'watching' | 'completed' | 'dropped';
type SearchResult = MovieResult | TvResult;
type SearchResponse = { results: SearchResult[] };
type SortKey =
  | 'title'
  | 'status'
  | 'progress'
  | 'rating'
  | 'publicRating'
  | 'date';
type SortDirection = 'asc' | 'desc';
type MediaFilter = 'all' | 'movie' | 'tv' | 'anime';

type FormState = {
  mediaType: 'movie' | 'tv';
  tmdbId: number | null;
  title: string;
  releaseYear: string;
  status: Status;
  watchCount: string;
  watchedAt: string;
  seasonProgress: Record<string, number>;
  categories: string;
  rating: string;
  priority: string;
  series: string;
  notes: string;
};

const createEmptyForm = (): FormState => ({
  mediaType: 'movie',
  tmdbId: null,
  title: '',
  releaseYear: '',
  status: 'watching',
  watchCount: '0',
  watchedAt: '',
  seasonProgress: {},
  categories: '',
  rating: '',
  priority: '',
  series: '',
  notes: '',
});

const statusLabels: Record<Status, string> = {
  planned: 'À voir',
  watching: 'En cours',
  completed: 'Terminé',
  dropped: 'Abandonné',
};

const statusClasses: Record<Status, string> = {
  planned: 'bg-gray-700 text-gray-100',
  watching: 'bg-sky-900/80 text-sky-100',
  completed: 'bg-emerald-900/80 text-emerald-100',
  dropped: 'bg-red-900/70 text-red-100',
};

const englishLabels: Record<string, string> = {
  'À voir': 'Planned',
  'En cours': 'Watching',
  Terminé: 'Completed',
  Terminés: 'Completed',
  Abandonné: 'Dropped',
  'Mon suivi': 'My Watch History',
  'Films vus, séries en cours, scores et notes personnelles.':
    'Watched movies, series in progress, ratings, and personal notes.',
  Ajouter: 'Add',
  Total: 'Total',
  Notés: 'Rated',
  'Tous les statuts': 'All statuses',
  'Rechercher un titre, une catégorie ou une note…':
    'Search by title, category, or note…',
  'Tous les médias': 'All media',
  Films: 'Movies',
  Séries: 'Series',
  Anime: 'Anime',
  'Aucun élément ne correspond à ces filtres.': 'No items match these filters.',
  Titre: 'Title',
  Statut: 'Status',
  Progression: 'Progress',
  Note: 'Rating',
  'Votre note': 'Your rating',
  'Note TMDB': 'TMDB rating',
  'Votes TMDB': 'TMDB votes',
  Trier: 'Sort',
  Résultats: 'Results',
  'Notes externes indisponibles': 'External ratings unavailable',
  'Effacer les filtres': 'Clear filters',
  Date: 'Date',
  Actions: 'Actions',
  Film: 'Movie',
  Série: 'Series',
  'Année inconnue': 'Unknown year',
  'Non noté': 'Not rated',
  Revu: 'Rewatched',
  Vu: 'Watched',
  Ouvrir: 'Open',
  'Ajouter au suivi': 'Add to watch history',
  Fermer: 'Close',
  'Titre *': 'Title *',
  'Associer la fiche récupère automatiquement les saisons et les épisodes.':
    'Linking the title automatically retrieves its seasons and episodes.',
  'Résultats pour': 'Results for',
  Associer: 'Link',
  Type: 'Type',
  Année: 'Year',
  'Progression par saison': 'Progress by season',
  'Indiquez le dernier épisode vu dans chaque saison.':
    'Set the last episode watched in each season.',
  'Associez d’abord la série à sa fiche TMDB.':
    'Link the series to its TMDB entry first.',
  'Nombre de visionnages': 'Watch count',
  'Date du dernier visionnage': 'Last watched date',
  'Votre score': 'Your rating',
  Catégories: 'Categories',
  Priorité: 'Priority',
  'Saga / collection': 'Saga / collection',
  'Notes personnelles': 'Personal notes',
  Supprimer: 'Delete',
  Annuler: 'Cancel',
  Enregistrer: 'Save',
  'Enregistrement…': 'Saving…',
  'Pas encore vu': 'Not watched yet',
  'Toutes les saisons': 'All seasons',
  'Progression à préciser': 'Progress not specified',
  'Pas commencé': 'Not started',
  'Aucune saison standard trouvée.': 'No standard season found.',
  'Non commencée': 'Not started',
  Terminée: 'Completed',
  Finir: 'Finish',
  'Ép.': 'Ep.',
  'Ajouter un visionnage': 'Add a watch',
  'Marquer comme vu': 'Mark as watched',
  'Nouveau visionnage ajouté.': 'New watch added.',
  'Film marqué comme vu.': 'Movie marked as watched.',
  'Mise à jour impossible.': 'Unable to update.',
  'Entrée supprimée.': 'Entry deleted.',
  'Suppression impossible.': 'Unable to delete.',
};

const fromItem = (item: WatchHistoryItem): FormState => ({
  mediaType: item.mediaType,
  tmdbId: item.tmdbId ?? null,
  title: item.title,
  releaseYear: item.releaseYear?.toString() ?? '',
  status: item.status as Status,
  watchCount: item.watchCount.toString(),
  watchedAt: item.watchedAt
    ? new Date(item.watchedAt).toISOString().slice(0, 10)
    : '',
  seasonProgress: item.seasonProgress ?? {},
  categories: item.categories ?? '',
  rating: item.rating?.toString() ?? '',
  priority: item.priority?.toString() ?? '',
  series: item.series ?? '',
  notes: item.notes ?? '',
});

const numberOrNull = (value: string) => (value === '' ? null : Number(value));

const progressLabel = (item: WatchHistoryItem, locale = 'fr') => {
  const active = latestActiveViewing(item.viewingProgress);
  if (active?.run.rewatching) {
    const episode =
      item.mediaType === 'tv'
        ? ` S${active.key.split(':')[0]} · E${active.key.split(':')[1]}`
        : '';
    return `${locale.startsWith('fr') ? 'Revisionnage' : 'Rewatching'}${episode} · ${Math.round((active.run.position / active.run.duration) * 100)}%`;
  }
  if (item.mediaType === 'movie') {
    if (!item.watchCount) return 'Pas encore vu';
    return `${item.watchCount} visionnage${item.watchCount > 1 ? 's' : ''}`;
  }
  if (item.status === 'completed') return 'Toutes les saisons';

  const progress = Object.entries(item.seasonProgress ?? {})
    .map(([season, episode]) => ({ season: Number(season), episode }))
    .filter(({ episode }) => episode > 0)
    .sort((a, b) => b.season - a.season)[0];
  if (progress) {
    return `S${String(progress.season).padStart(2, '0')} · E${String(
      progress.episode
    ).padStart(2, '0')}`;
  }
  return item.status === 'watching' ? 'Progression à préciser' : 'Pas commencé';
};

const progressSortValue = (item: WatchHistoryItem) =>
  item.mediaType === 'movie'
    ? item.watchCount
    : Object.keys(item.seasonProgress ?? {}).length
      ? Object.values(item.seasonProgress).reduce(
          (total, episodes) => total + episodes,
          0
        )
      : (item.watchedEpisodes ?? 0);

const statusOrder: Record<Status, number> = {
  watching: 0,
  planned: 1,
  completed: 2,
  dropped: 3,
};

const isAnimeItem = (
  item: WatchHistoryItem,
  plannedMetadata?: WatchHistoryPublicRatingsResponse,
  publicRatings?: WatchHistoryPublicRatingsResponse
) =>
  Boolean(
    item.tmdbId &&
    (item.status === 'planned' ? plannedMetadata : publicRatings)?.[
      `${item.mediaType}:${item.tmdbId}`
    ]?.isAnime
  );

const WatchHistory = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user } = useUser();
  const contentRef = useRef<HTMLDivElement>(null);
  const { data, mutate } = useSWR<WatchHistoryResponse>(
    user ? `/api/v1/watch-history?take=1000&profile=${user.id}` : null
  );
  const { data: watchlistData, mutate: mutateWatchlistCount } =
    useSWR<WatchlistResponse>(
      user ? '/api/v1/discover/watchlist?page=1' : null
    );
  const { data: publicRatings, error: publicRatingsError } =
    useSWR<WatchHistoryPublicRatingsResponse>(
      data?.results.some((item) => item.tmdbId) && user
        ? `/api/v1/watch-history/public-ratings?profile=${user.id}`
        : null
    );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | Status>('all');
  const {
    data: plannedData,
    error: plannedError,
    mutate: mutatePlannedData,
  } = useSWR<WatchlistResponse>(
    user && status === 'planned'
      ? '/api/v1/discover/watchlist?page=1&take=1000'
      : null
  );
  const { data: plannedMetadata, error: plannedMetadataError } =
    useSWR<WatchHistoryPublicRatingsResponse>(
      user && status === 'planned'
        ? '/api/v1/watch-history/planned-metadata'
        : null
    );
  const [mediaType, setMediaType] = useState<MediaFilter>('all');
  useEffect(() => {
    if (user?.settings?.showAnime === false && mediaType === 'anime') {
      setMediaType('all');
    }
  }, [mediaType, user?.settings?.showAnime]);
  const [ratedOnly, setRatedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [visibleCount, setVisibleCount] = useState(50);
  const [editing, setEditing] = useState<WatchHistoryItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(createEmptyForm);
  const [saving, setSaving] = useState(false);
  const [lookupQuery, setLookupQuery] = useState('');
  const [legacyEpisodes, setLegacyEpisodes] = useState(0);

  useEffect(() => {
    if (intl.locale.toLowerCase().startsWith('fr')) return;
    const root = contentRef.current;
    if (!root) return;

    const translate = (value: string) => englishLabels[value.trim()] ?? value;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    nodes.forEach((node) => {
      const translated = translate(node.nodeValue ?? '');
      if (translated !== node.nodeValue) node.nodeValue = translated;
    });
    root
      .querySelectorAll<HTMLElement>('[title], [aria-label], [placeholder]')
      .forEach((element) => {
        ['title', 'aria-label', 'placeholder'].forEach((attribute) => {
          const value = element.getAttribute(attribute);
          if (value) element.setAttribute(attribute, translate(value));
        });
      });
  });

  const { data: lookupData, isLoading: lookupLoading } = useSWR<SearchResponse>(
    lookupQuery
      ? `/api/v1/search?query=${encodeURIComponent(lookupQuery)}&language=en`
      : null
  );
  const { data: tvData, isLoading: tvLoading } = useSWR<TvDetails>(
    showForm && form.mediaType === 'tv' && form.tmdbId
      ? `/api/v1/tv/${form.tmdbId}?language=en`
      : null
  );

  const seasons = useMemo(
    () =>
      (tvData?.seasons ?? [])
        .filter((season) => season.seasonNumber > 0 && season.episodeCount > 0)
        .sort((a, b) => a.seasonNumber - b.seasonNumber),
    [tvData]
  );

  useEffect(() => {
    if (!seasons.length || Object.keys(form.seasonProgress).length) return;
    if (!legacyEpisodes && form.status !== 'completed') return;
    let remaining = legacyEpisodes;
    const converted: Record<string, number> = {};
    seasons.forEach((season) => {
      converted[String(season.seasonNumber)] = legacyEpisodes
        ? Math.min(remaining, season.episodeCount)
        : season.episodeCount;
      remaining = Math.max(0, remaining - season.episodeCount);
    });
    setForm((current) => ({ ...current, seasonProgress: converted }));
    setLegacyEpisodes(0);
  }, [form.seasonProgress, form.status, legacyEpisodes, seasons]);

  const entries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(intl.locale);
    const collator = new Intl.Collator(intl.locale, {
      numeric: true,
      sensitivity: 'base',
    });
    const source: WatchHistoryItem[] =
      status === 'planned'
        ? (plannedData?.results ?? []).map((item) => ({
            id: -item.id,
            mediaType: item.mediaType,
            tmdbId: item.tmdbId,
            title: item.title,
            releaseYear:
              Number(
                plannedMetadata?.[
                  `${item.mediaType}:${item.tmdbId}`
                ]?.releaseDate?.slice(0, 4)
              ) || null,
            status: 'planned' as WatchHistoryItem['status'],
            watchCount: 0,
            seasonProgress: {},
            episodeOverrides: {},
            createdAt: item.createdAt ? new Date(item.createdAt) : new Date(0),
            updatedAt: item.createdAt ? new Date(item.createdAt) : new Date(0),
          }))
        : (data?.results ?? []);
    const filtered = source.filter(
      (item) =>
        (status === 'all' ||
          item.status === status ||
          (status === 'watching' && isRewatching(item.viewingProgress))) &&
        (mediaType === 'all' ||
          (mediaType === 'anime'
            ? isAnimeItem(item, plannedMetadata, publicRatings)
            : item.mediaType === mediaType &&
              !isAnimeItem(item, plannedMetadata, publicRatings))) &&
        (!ratedOnly || item.rating != null) &&
        (!query ||
          item.title.toLocaleLowerCase(intl.locale).includes(query) ||
          item.categories?.toLocaleLowerCase(intl.locale).includes(query) ||
          item.notes?.toLocaleLowerCase(intl.locale).includes(query))
    );
    const numericValue = (item: WatchHistoryItem): number | null => {
      switch (sortKey) {
        case 'status':
          return statusOrder[item.status as Status];
        case 'progress':
          return progressSortValue(item);
        case 'rating':
          return item.rating ?? null;
        case 'publicRating':
          return item.tmdbId
            ? ((item.status === 'planned' ? plannedMetadata : publicRatings)?.[
                `${item.mediaType}:${item.tmdbId}`
              ]?.average ?? null)
            : null;
        case 'date':
          return item.status === 'planned'
            ? item.createdAt.getTime() || null
            : item.watchedAt
              ? new Date(item.watchedAt).getTime()
              : null;
        default:
          return null;
      }
    };
    return filtered.sort((a, b) => {
      if (sortKey === 'title') {
        const comparison = collator.compare(a.title, b.title);
        return (
          (sortDirection === 'asc' ? comparison : -comparison) || a.id - b.id
        );
      }
      const aValue = numericValue(a);
      const bValue = numericValue(b);
      if (aValue == null && bValue != null) return 1;
      if (bValue == null && aValue != null) return -1;
      const comparison = (aValue ?? 0) - (bValue ?? 0);
      return (
        (sortDirection === 'asc' ? comparison : -comparison) ||
        collator.compare(a.title, b.title) ||
        a.id - b.id
      );
    });
  }, [
    data,
    plannedData,
    plannedMetadata,
    intl.locale,
    mediaType,
    publicRatings,
    ratedOnly,
    search,
    sortDirection,
    sortKey,
    status,
  ]);

  const categoryLoading =
    mediaType !== 'all' &&
    (status === 'planned'
      ? Boolean(
          plannedData?.results.some((item) => item.tmdbId) &&
          !plannedMetadata &&
          !plannedMetadataError
        )
      : Boolean(
          data?.results.some((item) => item.tmdbId) &&
          !publicRatings &&
          !publicRatingsError
        ));

  const changeSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'title' || key === 'status' ? 'asc' : 'desc');
    }
  };

  useEffect(() => {
    setVisibleCount(50);
  }, [search, status, mediaType, ratedOnly, sortKey, sortDirection]);

  const stats = useMemo(() => {
    const all = data?.results ?? [];
    return {
      total: all.length,
      completed: all.filter((item) => item.status === 'completed').length,
      watching: all.filter(
        (item) =>
          item.status === 'watching' || isRewatching(item.viewingProgress)
      ).length,
      rated: all.filter((item) => item.rating).length,
    };
  }, [data]);

  const openNew = () => {
    setEditing(null);
    setForm(createEmptyForm());
    setLookupQuery('');
    setLegacyEpisodes(0);
    setShowForm(true);
  };

  const openEdit = (item: WatchHistoryItem) => {
    setEditing(item);
    setForm(fromItem(item));
    setLookupQuery('');
    setLegacyEpisodes(
      Object.keys(item.seasonProgress ?? {}).length
        ? 0
        : (item.watchedEpisodes ?? 0)
    );
    setShowForm(true);
  };

  const selectSearchResult = (result: SearchResult) => {
    const isMovie = result.mediaType === 'movie';
    const title = isMovie ? result.title : result.name;
    const date = isMovie ? result.releaseDate : result.firstAirDate;
    setForm((current) => ({
      ...current,
      mediaType: result.mediaType,
      tmdbId: result.id,
      title,
      releaseYear: date?.slice(0, 4) ?? '',
      seasonProgress:
        result.mediaType === current.mediaType ? current.seasonProgress : {},
    }));
    setLookupQuery('');
    toast.success('Fiche TMDB associée.');
  };

  const updateSeason = (
    seasonNumber: number,
    episodeCount: number,
    value: number
  ) => {
    const seasonProgress = {
      ...form.seasonProgress,
      [String(seasonNumber)]: Math.max(0, Math.min(value, episodeCount)),
    };
    const availableEpisodes = seasons.reduce(
      (total, season) => total + season.episodeCount,
      0
    );
    const watchedEpisodes = seasons.reduce(
      (total, season) =>
        total + (seasonProgress[String(season.seasonNumber)] ?? 0),
      0
    );
    const nextStatus: Status =
      form.status === 'dropped'
        ? 'dropped'
        : watchedEpisodes === 0
          ? 'watching'
          : watchedEpisodes >= availableEpisodes
            ? 'completed'
            : 'watching';
    setForm({
      ...form,
      seasonProgress,
      status: nextStatus,
      watchedAt:
        watchedEpisodes > 0
          ? form.watchedAt || new Date().toISOString().slice(0, 10)
          : form.watchedAt,
    });
  };

  const payloadFromForm = () => ({
    ...form,
    releaseYear: numberOrNull(form.releaseYear),
    watchCount: Number(form.watchCount || 0),
    watchedAt: form.watchedAt
      ? new Date(`${form.watchedAt}T12:00:00`).toISOString()
      : null,
    watchedEpisodes: null,
    totalEpisodes: null,
    rating: numberOrNull(form.rating),
    priority: numberOrNull(form.priority),
  });

  const save = async () => {
    if (!form.title.trim()) {
      toast.error('Le titre est obligatoire.');
      return;
    }
    if (form.mediaType === 'tv' && !form.tmdbId) {
      toast.error('Associez la série à une fiche pour charger ses saisons.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await axios.put(
          `/api/v1/watch-history/${editing.id}`,
          payloadFromForm()
        );
      } else {
        await axios.post('/api/v1/watch-history', payloadFromForm());
      }
      await mutate();
      await mutateGlobal(WATCH_HISTORY_SUMMARY_KEY);
      setShowForm(false);
      toast.success(editing ? 'Entrée mise à jour.' : 'Entrée ajoutée.');
    } catch {
      toast.error("Impossible d'enregistrer cette entrée.");
    } finally {
      setSaving(false);
    }
  };

  const stopRewatch = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await axios.delete(`/api/v1/watch-history/${editing.id}/rewatch`);
      await mutate();
      await mutateGlobal(WATCH_HISTORY_SUMMARY_KEY);
      await mutateGlobal('/api/v1/watch-history?active=1&take=24');
      setShowForm(false);
    } catch {
      toast.error(
        intl.locale.startsWith('fr')
          ? 'Mise à jour impossible.'
          : 'Unable to update.'
      );
    } finally {
      setSaving(false);
    }
  };

  const quickWatchMovie = async (item: WatchHistoryItem) => {
    try {
      await axios.put(`/api/v1/watch-history/${item.id}`, {
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
        title: item.title,
        releaseYear: item.releaseYear,
        status: 'completed',
        watchCount: item.watchCount + 1,
        watchedAt: new Date().toISOString(),
        watchedEpisodes: null,
        totalEpisodes: null,
        seasonProgress: item.seasonProgress ?? {},
        categories: item.categories,
        rating: item.rating,
        priority: item.priority,
        series: item.series,
        notes: item.notes,
      });
      await mutate();
      await mutateGlobal(WATCH_HISTORY_SUMMARY_KEY);
      toast.success(
        item.watchCount ? 'Nouveau visionnage ajouté.' : 'Film marqué comme vu.'
      );
    } catch {
      toast.error('Mise à jour impossible.');
    }
  };

  const remove = async (item: WatchHistoryItem) => {
    if (
      !window.confirm(
        item.status === 'planned'
          ? `Supprimer « ${item.title} » de votre liste à voir ?`
          : `Supprimer « ${item.title} » de votre suivi ?`
      )
    )
      return false;
    try {
      if (item.status === 'planned' && item.tmdbId) {
        await axios.delete(
          `/api/v1/watchlist/${item.tmdbId}?mediaType=${item.mediaType}`
        );
        await Promise.all([mutatePlannedData(), mutateWatchlistCount()]);
        toast.success('Entrée supprimée.');
        return true;
      }
      await axios.delete(`/api/v1/watch-history/${item.id}`);
      await mutate();
      await mutateGlobal(WATCH_HISTORY_SUMMARY_KEY);
      toast.success('Entrée supprimée.');
      return true;
    } catch {
      toast.error('Suppression impossible.');
      return false;
    }
  };

  const mediaLink = (item: WatchHistoryItem) =>
    item.tmdbId ? `/${item.mediaType}/${item.tmdbId}` : undefined;

  const canRemove = (item: WatchHistoryItem) =>
    item.status !== 'planned' ||
    !plannedData?.results.some(
      (watchlistItem) =>
        watchlistItem.tmdbId === item.tmdbId &&
        watchlistItem.mediaType === item.mediaType &&
        !!watchlistItem.ratingKey
    );

  const publicRatingFor = (item: WatchHistoryItem) =>
    item.tmdbId
      ? (item.status === 'planned' ? plannedMetadata : publicRatings)?.[
          `${item.mediaType}:${item.tmdbId}`
        ]
      : null;
  const formatPublicRating = (item: WatchHistoryItem) => {
    const rating = publicRatingFor(item);
    if (rating?.average != null) return `${rating.average.toFixed(1)}/10`;
    const loading =
      item.status === 'planned'
        ? !plannedMetadata && !plannedMetadataError
        : !publicRatings && !publicRatingsError;
    if (item.tmdbId && loading) return '…';
    return '—';
  };
  const upcomingFor = (item: WatchHistoryItem) => {
    if (item.status !== 'planned' || !item.tmdbId) return null;
    const metadata = plannedMetadata?.[`${item.mediaType}:${item.tmdbId}`];
    return metadata?.upcoming ? metadata.releaseDate || 'TBA' : null;
  };
  const sortHeading = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => changeSort(key)}
      className="inline-flex min-h-8 items-center gap-1 text-left hover:text-white focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
    >
      {label}
      {sortKey === key &&
        (sortDirection === 'asc' ? (
          <ChevronUpIcon className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
        ))}
    </button>
  );

  const statCards = [
    { label: 'Total', value: stats.total, icon: FilmIcon },
    {
      label: 'À voir',
      value: watchlistData?.totalResults ?? '…',
      icon: BookmarkIcon,
    },
    { label: 'Terminés', value: stats.completed, icon: CheckCircleIcon },
    { label: 'En cours', value: stats.watching, icon: TvIcon },
    { label: 'Notés', value: stats.rated, icon: StarIcon },
  ];

  return (
    <div ref={contentRef}>
      <PageTitle title="Mon suivi" />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Header>Mon suivi</Header>
          <p className="mt-1 text-sm text-gray-400">
            Films vus, séries en cours, scores et notes personnelles.
          </p>
        </div>
        <Button buttonType="primary" onClick={openNew}>
          <PlusIcon className="mr-2 h-5 w-5" /> Ajouter
        </Button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {statCards.map(({ label, value, icon: Icon }) => (
          <button
            key={label}
            onClick={() => {
              setStatus(
                label === 'À voir'
                  ? 'planned'
                  : label === 'Terminés'
                    ? 'completed'
                    : label === 'En cours'
                      ? 'watching'
                      : 'all'
              );
              setRatedOnly(label === 'Notés');
            }}
            aria-pressed={
              (label === 'Notés' && ratedOnly) ||
              (label === 'À voir' && status === 'planned') ||
              (label === 'Terminés' && status === 'completed') ||
              (label === 'En cours' && status === 'watching') ||
              (label === 'Total' && status === 'all' && !ratedOnly)
            }
            className="rounded-lg border border-transparent bg-gray-800 p-4 text-left transition hover:bg-gray-700 aria-pressed:border-indigo-400"
          >
            <div className="flex items-center justify-between text-gray-400">
              <span className="text-sm">{label}</span>
              <Icon className="h-5 w-5" />
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {value}
            </div>
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
        <span>
          {entries.length}{' '}
          {intl.locale.startsWith('fr') ? 'résultats' : 'results'}
          {status === 'planned' &&
          plannedData &&
          plannedData.totalResults > plannedData.results.length
            ? ` / ${plannedData.totalResults}`
            : status !== 'planned' &&
                data &&
                data.pageInfo.results > data.results.length
              ? ` / ${data.pageInfo.results}`
              : ''}
        </span>
        {(search || status !== 'all' || mediaType !== 'all' || ratedOnly) && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatus('all');
              setMediaType('all');
              setRatedOnly(false);
            }}
            className="text-indigo-300 hover:text-indigo-200"
          >
            Effacer les filtres
          </button>
        )}
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <label className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un titre, une catégorie ou une note…"
            className="w-full rounded-md border border-gray-600 bg-gray-800 py-2 pl-10 pr-3 text-white placeholder:text-gray-500"
          />
        </label>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as 'all' | Status);
            if (event.target.value === 'planned') setRatedOnly(false);
          }}
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white"
        >
          <option value="all">Tous les statuts</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={mediaType}
          onChange={(event) =>
            setMediaType(event.target.value as typeof mediaType)
          }
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white"
        >
          <option value="all">Tous les médias</option>
          <option value="movie">Films</option>
          <option value="tv">Séries</option>
          {user?.settings?.showAnime !== false && (
            <option value="anime">Anime</option>
          )}
        </select>
      </div>

      <label className="mb-4 flex items-center gap-2 text-sm text-gray-300 md:hidden">
        <span>Trier</span>
        <select
          value={`${sortKey}:${sortDirection}`}
          onChange={(event) => {
            const [key, direction] = event.target.value.split(':');
            setSortKey(key as SortKey);
            setSortDirection(direction as SortDirection);
          }}
          className="min-w-0 flex-1 rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white"
        >
          <option value="date:desc">Date ↓</option>
          <option value="date:asc">Date ↑</option>
          <option value="title:asc">Titre A–Z</option>
          <option value="title:desc">Titre Z–A</option>
          <option value="status:asc">Statut ↑</option>
          <option value="status:desc">Statut ↓</option>
          <option value="progress:desc">Progression ↓</option>
          <option value="progress:asc">Progression ↑</option>
          <option value="rating:desc">Votre note ↓</option>
          <option value="rating:asc">Votre note ↑</option>
          <option value="publicRating:desc">Note TMDB ↓</option>
          <option value="publicRating:asc">Note TMDB ↑</option>
        </select>
      </label>
      {status !== 'planned' && publicRatingsError && (
        <p className="mb-3 text-xs text-amber-300">
          Notes externes indisponibles
        </p>
      )}

      {status === 'planned' && plannedError ? (
        <div
          role="alert"
          className="rounded-lg bg-gray-800 px-6 py-12 text-center text-red-300"
        >
          {intl.locale.startsWith('fr')
            ? 'Impossible de charger la liste à voir.'
            : 'Could not load the planned list.'}
        </div>
      ) : (status === 'planned' ? !plannedData : !data) || categoryLoading ? (
        <LoadingSpinner />
      ) : mediaType === 'anime' &&
        (status === 'planned' ? plannedMetadataError : publicRatingsError) ? (
        <div
          role="alert"
          className="rounded-lg bg-gray-800 px-6 py-12 text-center text-amber-300"
        >
          {intl.locale.startsWith('fr')
            ? 'Classement des anime indisponible pour le moment.'
            : 'Anime classification is temporarily unavailable.'}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg bg-gray-800 px-6 py-12 text-center text-gray-400">
          Aucun élément ne correspond à ces filtres.
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg bg-gray-800 md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-gray-700/70 text-xs uppercase text-gray-300">
                <tr>
                  <th
                    scope="col"
                    aria-sort={
                      sortKey === 'title'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className="w-[25%] px-4 py-2"
                  >
                    {sortHeading('title', 'Titre')}
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortKey === 'status'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className="w-[12%] px-2 py-2"
                  >
                    {sortHeading('status', 'Statut')}
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortKey === 'progress'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className="w-[15%] px-2 py-2"
                  >
                    {sortHeading('progress', 'Progression')}
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortKey === 'rating'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className="w-[12%] px-2 py-2"
                  >
                    {sortHeading('rating', 'Votre note')}
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortKey === 'publicRating'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className="w-[12%] px-2 py-2"
                  >
                    {sortHeading('publicRating', 'Note TMDB')}
                  </th>
                  <th
                    scope="col"
                    aria-sort={
                      sortKey === 'date'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    className="w-[13%] px-2 py-2"
                  >
                    {sortHeading('date', 'Date')}
                  </th>
                  <th scope="col" className="w-[11%] px-2 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {entries.slice(0, visibleCount).map((item) => (
                  <tr
                    key={`${item.mediaType}:${item.id}`}
                    className="cursor-pointer hover:bg-gray-700/40"
                    onClick={() =>
                      item.status === 'planned'
                        ? void router.push(mediaLink(item)!)
                        : openEdit(item)
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {item.mediaType === 'movie' ? (
                          <FilmIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        ) : (
                          <TvIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        )}
                        <div className="min-w-0">
                          {mediaLink(item) ? (
                            <Link
                              href={mediaLink(item)!}
                              onClick={(event) => event.stopPropagation()}
                              className="block truncate font-medium text-white hover:text-indigo-300"
                            >
                              {item.title}
                            </Link>
                          ) : (
                            <div className="truncate font-medium text-white">
                              {item.title}
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span className="truncate">
                              {[
                                isAnimeItem(
                                  item,
                                  plannedMetadata,
                                  publicRatings
                                )
                                  ? 'Anime'
                                  : null,
                                item.releaseYear,
                                item.categories,
                              ]
                                .filter(Boolean)
                                .join(' · ') ||
                                (item.status === 'planned' &&
                                !plannedMetadata &&
                                !plannedMetadataError
                                  ? '…'
                                  : '—')}
                            </span>
                            {upcomingFor(item) && (
                              <span
                                title={upcomingFor(item)!}
                                className="shrink-0 rounded bg-amber-900/70 px-1.5 py-0.5 text-amber-200"
                              >
                                {intl.locale.startsWith('fr')
                                  ? 'À venir'
                                  : 'Upcoming'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${statusClasses[item.status as Status]}`}
                      >
                        {isRewatching(item.viewingProgress)
                          ? intl.locale.startsWith('fr')
                            ? 'Revisionnage'
                            : 'Rewatching'
                          : statusLabels[item.status as Status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-gray-200">
                      {progressLabel(item, intl.locale)}
                    </td>
                    <td className="px-3 py-3 text-amber-300">
                      {item.rating
                        ? `${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}`
                        : '—'}
                    </td>
                    <td
                      className="px-2 py-3 font-medium text-sky-200"
                      title={
                        publicRatingFor(item)
                          ? `TMDB · ${publicRatingFor(item)!.votes.toLocaleString(intl.locale)} Votes TMDB`
                          : undefined
                      }
                    >
                      {formatPublicRating(item)}
                    </td>
                    <td className="px-3 py-3 text-gray-300">
                      {item.status === 'planned'
                        ? item.createdAt.getTime()
                          ? new Intl.DateTimeFormat(intl.locale).format(
                              item.createdAt
                            )
                          : '—'
                        : item.watchedAt
                          ? new Intl.DateTimeFormat(intl.locale).format(
                              new Date(item.watchedAt)
                            )
                          : '—'}
                    </td>
                    <td
                      className="px-3 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex justify-end gap-1">
                        {item.status !== 'planned' &&
                          item.mediaType === 'movie' && (
                            <button
                              onClick={() => quickWatchMovie(item)}
                              title={
                                item.watchCount
                                  ? intl.locale.startsWith('fr')
                                    ? 'Ajouter un visionnage'
                                    : 'Add a watch'
                                  : intl.locale.startsWith('fr')
                                    ? 'Marquer comme vu'
                                    : 'Mark as watched'
                              }
                              className="rounded p-2 text-emerald-300 hover:bg-emerald-900"
                            >
                              <CheckIcon className="h-5 w-5" />
                            </button>
                          )}
                        {item.status === 'planned' ? (
                          <Link
                            href={mediaLink(item)!}
                            aria-label={`${intl.locale.startsWith('fr') ? 'Ouvrir' : 'Open'} ${item.title}`}
                            className="inline-flex rounded p-2 text-gray-300 hover:bg-gray-600 hover:text-white"
                          >
                            <PencilSquareIcon className="h-5 w-5" />
                          </Link>
                        ) : (
                          <button
                            onClick={() => openEdit(item)}
                            aria-label={`${intl.locale.startsWith('fr') ? 'Modifier' : 'Edit'} ${item.title}`}
                            className="rounded p-2 text-gray-300 hover:bg-gray-600 hover:text-white"
                          >
                            <PencilSquareIcon className="h-5 w-5" />
                          </button>
                        )}
                        {canRemove(item) && (
                          <button
                            onClick={() => remove(item)}
                            aria-label={`${intl.locale.startsWith('fr') ? 'Supprimer' : 'Delete'} ${item.title}`}
                            className="rounded p-2 text-gray-300 hover:bg-red-900 hover:text-white"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {entries.slice(0, visibleCount).map((item) => (
              <article
                key={`${item.mediaType}:${item.id}`}
                onClick={() =>
                  item.status === 'planned'
                    ? void router.push(mediaLink(item)!)
                    : openEdit(item)
                }
                className="rounded-lg bg-gray-800 p-4 active:bg-gray-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-white">{item.title}</h2>
                    <p className="mt-1 text-xs text-gray-400">
                      {item.releaseYear ??
                        (item.status === 'planned' &&
                        !plannedMetadata &&
                        !plannedMetadataError
                          ? '…'
                          : 'Année inconnue')}{' '}
                      ·{' '}
                      {isAnimeItem(item, plannedMetadata, publicRatings)
                        ? 'Anime'
                        : item.mediaType === 'movie'
                          ? 'Film'
                          : 'Série'}
                    </p>
                    {upcomingFor(item) && (
                      <span
                        title={upcomingFor(item)!}
                        className="mt-2 inline-block rounded bg-amber-900/70 px-1.5 py-0.5 text-xs text-amber-200"
                      >
                        {intl.locale.startsWith('fr') ? 'À venir' : 'Upcoming'}
                      </span>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-xs ${statusClasses[item.status as Status]}`}
                  >
                    {isRewatching(item.viewingProgress)
                      ? intl.locale.startsWith('fr')
                        ? 'Revisionnage'
                        : 'Rewatching'
                      : statusLabels[item.status as Status]}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-300">
                  <span className="font-medium">
                    {progressLabel(item, intl.locale)}
                  </span>
                  <span className="text-right text-amber-300">
                    {item.rating ? `${item.rating}/5 ★` : 'Non noté'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-sky-200">
                  TMDB · {formatPublicRating(item)}
                </div>
                {item.notes && (
                  <p className="mt-3 line-clamp-2 text-sm text-gray-400">
                    {item.notes}
                  </p>
                )}
                <div
                  className="mt-3 flex justify-end gap-2 border-t border-gray-700 pt-3"
                  onClick={(event) => event.stopPropagation()}
                >
                  {item.status !== 'planned' && item.mediaType === 'movie' && (
                    <Button
                      buttonSize="sm"
                      buttonType="success"
                      onClick={() => quickWatchMovie(item)}
                    >
                      <CheckIcon className="mr-1 h-4 w-4" />
                      {item.watchCount ? 'Revu' : 'Vu'}
                    </Button>
                  )}
                  {item.status === 'planned' ? (
                    <>
                      <Link
                        href={mediaLink(item)!}
                        className="inline-flex items-center rounded-md bg-gray-700 px-3 py-2 text-sm text-white"
                      >
                        <PencilSquareIcon className="mr-1 h-4 w-4" />
                        Ouvrir
                      </Link>
                      {canRemove(item) && (
                        <Button
                          buttonSize="sm"
                          onClick={() => void remove(item)}
                        >
                          <TrashIcon className="mr-1 h-4 w-4" />
                          Supprimer
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button buttonSize="sm" onClick={() => openEdit(item)}>
                      <PencilSquareIcon className="mr-1 h-4 w-4" />
                      Ouvrir
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {entries.length > visibleCount && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setVisibleCount((count) => count + 50)}>
                {intl.locale.startsWith('fr') ? 'Afficher plus' : 'Show more'} (
                {visibleCount}/{entries.length})
              </Button>
            </div>
          )}
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
          <div className="max-h-[96vh] w-full overflow-y-auto rounded-t-xl bg-gray-800 shadow-2xl sm:max-w-3xl sm:rounded-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-700 bg-gray-800 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {editing ? form.title : 'Ajouter au suivi'}
                </h2>
                {form.tmdbId && (
                  <p className="text-xs text-emerald-300">
                    Fiche TMDB associée · {form.tmdbId}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="rounded p-1 text-gray-300 hover:bg-gray-700"
                aria-label="Fermer"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {isRewatching(editing?.viewingProgress) && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-400/40 bg-violet-900/20 p-3 text-sm text-violet-200 sm:col-span-2">
                  <span>
                    {intl.locale.startsWith('fr')
                      ? 'Revisionnage — votre historique précédent est conservé.'
                      : 'Rewatching — your previous watched history is preserved.'}
                  </span>
                  <Button
                    buttonSize="sm"
                    disabled={saving}
                    onClick={() => void stopRewatch()}
                  >
                    {intl.locale.startsWith('fr')
                      ? 'Arrêter le revisionnage'
                      : 'Stop rewatching'}
                  </Button>
                </div>
              )}
              <div className="sm:col-span-2">
                <span className="mb-1 block text-sm text-gray-300">
                  Titre *
                </span>
                <div className="flex gap-2">
                  <input
                    value={form.title}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setLookupQuery(form.title.trim());
                    }}
                    className="min-w-0 flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                  />
                  <Button
                    onClick={() => setLookupQuery(form.title.trim())}
                    disabled={!form.title.trim()}
                  >
                    <MagnifyingGlassIcon className="mr-1 h-4 w-4" />
                    Associer
                  </Button>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Associer la fiche récupère automatiquement les saisons et les
                  épisodes.
                </p>
              </div>

              {lookupQuery && (
                <div className="rounded-lg border border-gray-600 bg-gray-900 p-3 sm:col-span-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Résultats pour « {lookupQuery} »
                    </span>
                    <button
                      onClick={() => setLookupQuery('')}
                      className="text-gray-400 hover:text-white"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                  {lookupLoading ? (
                    <LoadingSpinner />
                  ) : (
                    <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                      {(lookupData?.results ?? [])
                        .filter(
                          (result) =>
                            result.mediaType === 'movie' ||
                            result.mediaType === 'tv'
                        )
                        .slice(0, 8)
                        .map((result) => {
                          const isMovie = result.mediaType === 'movie';
                          const title = isMovie ? result.title : result.name;
                          const date = isMovie
                            ? result.releaseDate
                            : result.firstAirDate;
                          return (
                            <button
                              key={`${result.mediaType}-${result.id}`}
                              onClick={() => selectSearchResult(result)}
                              className="rounded-md border border-gray-700 p-3 text-left hover:border-indigo-400 hover:bg-gray-800"
                            >
                              <span className="block font-medium text-white">
                                {title}
                              </span>
                              <span className="text-xs text-gray-400">
                                {isMovie ? 'Film' : 'Série'} ·{' '}
                                {date?.slice(0, 4) || 'année inconnue'}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              <label>
                <span className="mb-1 block text-sm text-gray-300">Type</span>
                <select
                  value={form.mediaType}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      mediaType: event.target.value as 'movie' | 'tv',
                      tmdbId: null,
                      seasonProgress: {},
                    })
                  }
                  className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                >
                  <option value="movie">Film</option>
                  <option value="tv">Série</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm text-gray-300">Année</span>
                <input
                  type="number"
                  value={form.releaseYear}
                  onChange={(event) =>
                    setForm({ ...form, releaseYear: event.target.value })
                  }
                  className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                />
              </label>

              <div className="sm:col-span-2">
                <span className="mb-2 block text-sm text-gray-300">Statut</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Object.entries(statusLabels)
                    .filter(([value]) => value !== 'planned')
                    .map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() =>
                          setForm({ ...form, status: value as Status })
                        }
                        className={`rounded-md border px-3 py-2 text-sm ${form.status === value ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-700'}`}
                      >
                        {label}
                      </button>
                    ))}
                </div>
              </div>

              {form.mediaType === 'tv' ? (
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 sm:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-white">
                        Progression par saison
                      </h3>
                      <p className="text-xs text-gray-400">
                        Indiquez le dernier épisode vu dans chaque saison.
                      </p>
                    </div>
                    {tvData && (
                      <span className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300">
                        {seasons.length} saison{seasons.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {!form.tmdbId ? (
                    <p className="rounded-md bg-amber-900/30 p-3 text-sm text-amber-200">
                      Associez d’abord la série à sa fiche TMDB.
                    </p>
                  ) : tvLoading ? (
                    <LoadingSpinner />
                  ) : seasons.length ? (
                    <div className="space-y-2">
                      {seasons.map((season) => {
                        const current =
                          form.seasonProgress[String(season.seasonNumber)] ?? 0;
                        const percent = Math.round(
                          (current / season.episodeCount) * 100
                        );
                        return (
                          <div
                            key={season.id}
                            className="rounded-md border border-gray-700 bg-gray-800 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="min-w-[7rem] flex-1">
                                <div className="font-medium text-white">
                                  Saison {season.seasonNumber}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {current
                                    ? `Épisode ${current}`
                                    : 'Non commencée'}{' '}
                                  · {percent}%
                                </div>
                              </div>
                              <div className="flex items-center rounded-md border border-gray-600 bg-gray-900">
                                <button
                                  onClick={() =>
                                    updateSeason(
                                      season.seasonNumber,
                                      season.episodeCount,
                                      current - 1
                                    )
                                  }
                                  className="p-2 text-gray-300 hover:text-white"
                                  aria-label="Épisode précédent"
                                >
                                  <MinusIcon className="h-4 w-4" />
                                </button>
                                <label className="flex items-center gap-1 border-x border-gray-600 px-2 text-sm text-white">
                                  <span className="text-gray-400">Ép.</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max={season.episodeCount}
                                    value={current}
                                    onChange={(event) =>
                                      updateSeason(
                                        season.seasonNumber,
                                        season.episodeCount,
                                        Number(event.target.value)
                                      )
                                    }
                                    className="w-12 border-0 bg-transparent p-1 text-center text-white focus:ring-0"
                                  />
                                  <span className="text-gray-400">
                                    / {season.episodeCount}
                                  </span>
                                </label>
                                <button
                                  onClick={() =>
                                    updateSeason(
                                      season.seasonNumber,
                                      season.episodeCount,
                                      current + 1
                                    )
                                  }
                                  className="p-2 text-gray-300 hover:text-white"
                                  aria-label="Épisode suivant"
                                >
                                  <PlusIcon className="h-4 w-4" />
                                </button>
                              </div>
                              <Button
                                buttonSize="sm"
                                buttonType={
                                  current === season.episodeCount
                                    ? 'success'
                                    : 'default'
                                }
                                onClick={() =>
                                  updateSeason(
                                    season.seasonNumber,
                                    season.episodeCount,
                                    current === season.episodeCount
                                      ? 0
                                      : season.episodeCount
                                  )
                                }
                              >
                                <CheckIcon className="mr-1 h-4 w-4" />
                                {current === season.episodeCount
                                  ? 'Terminée'
                                  : 'Finir'}
                              </Button>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-700">
                              <div
                                className="h-full rounded-full bg-indigo-500 transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">
                      Aucune saison standard trouvée.
                    </p>
                  )}
                </div>
              ) : (
                <label>
                  <span className="mb-1 block text-sm text-gray-300">
                    Nombre de visionnages
                  </span>
                  <div className="flex rounded-md border border-gray-600 bg-gray-900">
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          watchCount: String(
                            Math.max(0, Number(form.watchCount || 0) - 1)
                          ),
                        })
                      }
                      className="p-2 text-gray-300"
                    >
                      <MinusIcon className="h-5 w-5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={form.watchCount}
                      onChange={(event) =>
                        setForm({ ...form, watchCount: event.target.value })
                      }
                      className="min-w-0 flex-1 border-0 bg-transparent text-center text-white focus:ring-0"
                    />
                    <button
                      onClick={() =>
                        setForm({
                          ...form,
                          watchCount: String(Number(form.watchCount || 0) + 1),
                          status: 'completed',
                          watchedAt:
                            form.watchedAt ||
                            new Date().toISOString().slice(0, 10),
                        })
                      }
                      className="p-2 text-gray-300"
                    >
                      <PlusIcon className="h-5 w-5" />
                    </button>
                  </div>
                </label>
              )}

              <label>
                <span className="mb-1 block text-sm text-gray-300">
                  Date du dernier visionnage
                </span>
                <input
                  type="date"
                  value={form.watchedAt}
                  onChange={(event) =>
                    setForm({ ...form, watchedAt: event.target.value })
                  }
                  className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                />
              </label>

              <div>
                <span className="mb-1 block text-sm text-gray-300">
                  Votre score
                </span>
                <div className="flex h-[42px] items-center gap-1 rounded-md border border-gray-600 bg-gray-900 px-3">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      onClick={() =>
                        setForm({
                          ...form,
                          rating:
                            form.rating === String(rating)
                              ? ''
                              : String(rating),
                        })
                      }
                      aria-label={`${rating} sur 5`}
                      className={
                        Number(form.rating) >= rating
                          ? 'text-amber-300'
                          : 'text-gray-600'
                      }
                    >
                      <StarIcon
                        className="h-7 w-7"
                        fill={
                          Number(form.rating) >= rating
                            ? 'currentColor'
                            : 'none'
                        }
                      />
                    </button>
                  ))}
                </div>
              </div>

              <label>
                <span className="mb-1 block text-sm text-gray-300">
                  Catégories
                </span>
                <input
                  value={form.categories}
                  onChange={(event) =>
                    setForm({ ...form, categories: event.target.value })
                  }
                  className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm text-gray-300">
                  Priorité
                </span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={form.priority}
                  onChange={(event) =>
                    setForm({ ...form, priority: event.target.value })
                  }
                  className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm text-gray-300">
                  Saga / collection
                </span>
                <input
                  value={form.series}
                  onChange={(event) =>
                    setForm({ ...form, series: event.target.value })
                  }
                  className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm text-gray-300">
                  Notes personnelles
                </span>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                  className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-white"
                />
              </label>
            </div>

            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-gray-700 bg-gray-800 px-5 py-4">
              <div>
                {editing && (
                  <Button
                    buttonType="danger"
                    buttonSize="sm"
                    onClick={async () => {
                      if (await remove(editing)) setShowForm(false);
                    }}
                  >
                    <TrashIcon className="mr-1 h-4 w-4" />
                    Supprimer
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setShowForm(false)}>Annuler</Button>
                <Button buttonType="primary" disabled={saving} onClick={save}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WatchHistory;
