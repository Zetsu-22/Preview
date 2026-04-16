import type { AppSettings, ContentType, CoverResult, SearchTitleResult } from './types';

function normalizeText(value: string) {
  return value.toLowerCase().trim();
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => asRecord(item)) : [];
}

function splitWords(value: string) {
  return normalizeText(value).split(/[,._\s-]+/).filter((word) => word.length > 1);
}

function scoreMatch(searchQuery: string, ...values: Array<string | undefined>) {
  if (!searchQuery) {
    return 0;
  }

  const query = normalizeText(searchQuery);
  const words = splitWords(searchQuery);
  let score = 0;

  for (const current of values) {
    if (!current) {
      continue;
    }

    const value = normalizeText(current);
    if (value === query) {
      score += 10000;
    }

    if (value.startsWith(query)) {
      score += 5000;
    }

    if (value.includes(query)) {
      score += 1200;
    }

    for (const word of words) {
      if (value.includes(word)) {
        score += 200;
      }
    }
  }

  if ((query.includes('герой') || query.includes('hero')) && values.some((value) => normalizeText(value ?? '').includes('hero') && normalizeText(value ?? '').includes('academia'))) {
    score += 2500;
  }

  if ((query.includes('титан') || query.includes('titan')) && values.some((value) => normalizeText(value ?? '').includes('titan'))) {
    score += 2000;
  }

  return score;
}

function createNetworkError(apiName: string, error: unknown) {
  if (error instanceof Error && error.message) {
    if (error.message === 'Failed to fetch') {
      return new Error(`${apiName}: запрос заблокирован браузером, CORS или сетью`);
    }
    return new Error(`${apiName}: ${error.message}`);
  }

  return new Error(`${apiName}: неизвестная ошибка запроса`);
}

async function getExternalJson(url: string, init: RequestInit | undefined, apiName: string): Promise<unknown> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store'
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  } catch (error) {
    throw createNetworkError(apiName, error);
  }
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const map = new Map<string, T>();

  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }

  return [...map.values()];
}

function normalizeTitleResults(items: SearchTitleResult[], query: string) {
  const normalized = normalizeText(query);

  return [...items].sort((left, right) => {
    const leftScore = scoreMatch(normalized, left.displayName, left.officialName);
    const rightScore = scoreMatch(normalized, right.displayName, right.officialName);
    return rightScore - leftScore;
  });
}

function mapJikanAnimeTitles(data: unknown): SearchTitleResult[] {
  return asArray(asRecord(data).data)
    .map((item) => ({
      id: `anime-${String(item.mal_id ?? Math.random())}`,
      displayName: safeString(item.title) || safeString(item.title_english) || safeString(item.title_japanese),
      officialName: safeString(item.title_english) || safeString(item.title_japanese) || safeString(item.title),
      year: item.year ? String(item.year) : '',
      kind: 'anime'
    }))
    .filter((item) => item.displayName);
}

function mapKitsuAnimeTitles(data: unknown): SearchTitleResult[] {
  return asArray(asRecord(data).data)
    .map((item) => {
      const attributes = asRecord(item.attributes);
      const titles = asRecord(attributes.titles);

      return {
        id: `kitsu-${safeString(item.id) || Math.random()}`,
        displayName: safeString(titles.en) || safeString(attributes.canonicalTitle) || safeString(titles.en_jp),
        officialName: safeString(attributes.canonicalTitle) || safeString(titles.en_jp) || safeString(titles.ja_jp) || safeString(titles.en),
        year: safeString(attributes.startDate).slice(0, 4),
        kind: 'anime'
      };
    })
    .filter((item) => item.displayName);
}

function mapOpenLibraryTitles(data: unknown): SearchTitleResult[] {
  return asArray(asRecord(data).docs)
    .map((item) => ({
      id: `book-${safeString(item.key) || Math.random()}`,
      displayName: safeString(item.title),
      officialName: safeString(item.title),
      year: item.first_publish_year ? String(item.first_publish_year) : '',
      kind: 'book'
    }))
    .filter((item) => item.displayName);
}

function mapKinopoiskTitles(data: unknown, kind: 'movie' | 'series'): SearchTitleResult[] {
  return asArray(asRecord(data).docs)
    .filter((item) => {
      const currentType = safeString(item.type);
      return kind === 'movie' ? currentType !== 'tv-series' : currentType === 'tv-series' || currentType === 'animated-series' || currentType === 'mini-series';
    })
    .map((item) => ({
      id: `kp-${String(item.id ?? Math.random())}`,
      displayName: safeString(item.name) || safeString(item.alternativeName) || safeString(item.enName),
      officialName: safeString(item.alternativeName) || safeString(item.enName) || safeString(item.name),
      year: item.year ? String(item.year) : '',
      kind
    }))
    .filter((item) => item.displayName);
}

function mapOmdbTitles(data: unknown, kind: 'movie' | 'series'): SearchTitleResult[] {
  const record = asRecord(data);

  if (safeString(record.Response) === 'False') {
    throw new Error(safeString(record.Error) || 'Ничего не найдено');
  }

  return asArray(record.Search)
    .map((item) => ({
      id: `omdb-${safeString(item.imdbID) || Math.random()}`,
      displayName: safeString(item.Title),
      officialName: safeString(item.Title),
      year: safeString(item.Year),
      kind
    }))
    .filter((item) => item.displayName);
}

function getAnimeAlternativeQuery(query: string) {
  const normalized = normalizeText(query);

  if (normalized.includes('моя геройская') || normalized.includes('геройская академия') || normalized.includes('герой')) {
    return 'my hero academia';
  }

  if (normalized.includes('атака титанов') || normalized.includes('титаны') || normalized.includes('титан')) {
    return 'attack on titan';
  }

  return query;
}

async function searchAnimeTitles(query: string): Promise<SearchTitleResult[]> {
  const combined: SearchTitleResult[] = [];

  try {
    const kitsuData = await getExternalJson(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=20`, undefined, 'Kitsu API');
    combined.push(...mapKitsuAnimeTitles(kitsuData));
  } catch {
  }

  const alternativeQuery = getAnimeAlternativeQuery(query);

  if (combined.length < 5) {
    try {
      const jikanData = await getExternalJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(alternativeQuery)}&limit=20`, undefined, 'Jikan API');
      combined.push(...mapJikanAnimeTitles(jikanData));
    } catch {
    }
  }

  if (!combined.length) {
    const fallback = await getExternalJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=20`, undefined, 'Jikan API');
    combined.push(...mapJikanAnimeTitles(fallback));
  }

  return normalizeTitleResults(uniqueById(combined), query).slice(0, 20);
}

async function searchMovieOrSeriesTitles(query: string, kind: 'movie' | 'series', settings: AppSettings): Promise<SearchTitleResult[]> {
  if (settings.kinopoiskApiKey) {
    try {
      const kinopoiskData = await getExternalJson(`https://api.kinopoisk.dev/v1.4/movie/search?query=${encodeURIComponent(query)}&limit=20`, {
        headers: {
          'X-API-KEY': settings.kinopoiskApiKey
        }
      }, 'Kinopoisk API');

      const kinopoiskResults = mapKinopoiskTitles(kinopoiskData, kind);
      if (kinopoiskResults.length) {
        return normalizeTitleResults(kinopoiskResults, query).slice(0, 20);
      }
    } catch {
    }
  }

  if (!settings.omdbApiKey) {
    throw new Error('Для поиска нужен OMDb API key или Kinopoisk API key');
  }

  const omdbData = await getExternalJson(`https://www.omdbapi.com/?apikey=${encodeURIComponent(settings.omdbApiKey)}&s=${encodeURIComponent(query)}&type=${kind}`, undefined, 'OMDb API');
  return normalizeTitleResults(mapOmdbTitles(omdbData, kind), query).slice(0, 20);
}

async function searchBookTitles(query: string): Promise<SearchTitleResult[]> {
  const data = await getExternalJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=20`, undefined, 'Open Library API');
  return normalizeTitleResults(mapOpenLibraryTitles(data), query).slice(0, 20);
}

function createCoverResult(input: Omit<CoverResult, 'relevanceScore'>, query: string): CoverResult {
  return {
    ...input,
    relevanceScore: scoreMatch(query, input.displayName, input.officialName, input.itemName)
  };
}

export function getDefaultCoverApi(contentType: ContentType, settings: AppSettings) {
  if (contentType === 'anime') {
    return 'kitsu';
  }

  if (contentType === 'book') {
    return 'openlibrary';
  }

  return settings.kinopoiskApiKey ? 'kinopoisk' : 'omdb';
}

export async function searchTitles(query: string, contentType: ContentType, settings: AppSettings): Promise<SearchTitleResult[]> {
  if (!query.trim()) {
    return [];
  }

  if (contentType === 'anime') {
    return searchAnimeTitles(query);
  }

  if (contentType === 'movie') {
    return searchMovieOrSeriesTitles(query, 'movie', settings);
  }

  if (contentType === 'series') {
    return searchMovieOrSeriesTitles(query, 'series', settings);
  }

  return searchBookTitles(query);
}

export async function searchCovers(payload: {
  query: string;
  contentType: ContentType;
  api: string;
  settings: AppSettings;
}): Promise<CoverResult[]> {
  const { query, contentType, api, settings } = payload;

  if (!query.trim()) {
    return [];
  }

  if (contentType === 'anime') {
    if (api === 'jikan') {
      const data = await getExternalJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=20`, undefined, 'Jikan API');
      return asArray(asRecord(data).data)
        .map((item) => createCoverResult({
          id: `jikan-${String(item.mal_id ?? Math.random())}`,
          previewUrl: safeString(asRecord(asRecord(item.images).jpg).large_image_url) || safeString(asRecord(asRecord(item.images).jpg).image_url) || safeString(asRecord(asRecord(item.images).webp).large_image_url),
          itemName: safeString(item.title) || 'anime',
          displayName: safeString(item.title) || safeString(item.title_english) || 'anime',
          officialName: safeString(item.title_english) || safeString(item.title_japanese) || safeString(item.title) || 'anime',
          year: item.year ? String(item.year) : '',
          sourceApi: 'Jikan API'
        }, query))
        .filter((item) => item.previewUrl);
    }

    const data = await getExternalJson(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=20`, undefined, 'Kitsu API');
    return asArray(asRecord(data).data)
      .map((item) => {
        const attributes = asRecord(item.attributes);
        const titles = asRecord(attributes.titles);
        const posterImage = asRecord(attributes.posterImage);

        return createCoverResult({
          id: `kitsu-${safeString(item.id)}`,
          previewUrl: safeString(posterImage.original) || safeString(posterImage.large),
          itemName: safeString(attributes.slug) || 'anime',
          displayName: safeString(titles.en) || safeString(attributes.canonicalTitle) || 'anime',
          officialName: safeString(attributes.canonicalTitle) || safeString(titles.en_jp) || safeString(titles.ja_jp) || 'anime',
          year: safeString(attributes.startDate).slice(0, 4),
          sourceApi: 'Kitsu API'
        }, query);
      })
      .filter((item) => item.previewUrl);
  }

  if (contentType === 'book') {
    const data = await getExternalJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=20`, undefined, 'Open Library API');
    return asArray(asRecord(data).docs)
      .map((item) => {
        const coverId = item.cover_i;
        return createCoverResult({
          id: `book-${safeString(item.key) || String(coverId)}`,
          previewUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
          itemName: safeString(item.title) || 'book',
          displayName: safeString(item.title) || 'book',
          officialName: safeString(item.title) || 'book',
          year: item.first_publish_year ? String(item.first_publish_year) : '',
          sourceApi: 'Open Library API'
        }, query);
      })
      .filter((item) => item.previewUrl);
  }

  if (api === 'kinopoisk') {
    if (!settings.kinopoiskApiKey) {
      throw new Error('Для Kinopoisk API нужен ключ в настройках');
    }

    const data = await getExternalJson(`https://api.kinopoisk.dev/v1.4/movie/search?query=${encodeURIComponent(query)}&limit=20`, {
      headers: {
        'X-API-KEY': settings.kinopoiskApiKey
      }
    }, 'Kinopoisk API');

    return asArray(asRecord(data).docs)
      .filter((item) => {
        const currentType = safeString(item.type);
        return contentType === 'movie' ? currentType !== 'tv-series' : currentType === 'tv-series' || currentType === 'animated-series' || currentType === 'mini-series';
      })
      .map((item) => createCoverResult({
        id: `kp-${String(item.id ?? Math.random())}`,
        previewUrl: safeString(asRecord(item.poster).url) || safeString(asRecord(item.poster).previewUrl),
        itemName: safeString(item.name) || safeString(item.alternativeName) || 'item',
        displayName: safeString(item.name) || safeString(item.alternativeName) || 'item',
        officialName: safeString(item.alternativeName) || safeString(item.enName) || safeString(item.name) || 'item',
        year: item.year ? String(item.year) : '',
        sourceApi: 'Kinopoisk API'
      }, query))
      .filter((item) => item.previewUrl);
  }

  if (!settings.omdbApiKey) {
    throw new Error('Для OMDb API нужен ключ в настройках');
  }

  const data = await getExternalJson(`https://www.omdbapi.com/?apikey=${encodeURIComponent(settings.omdbApiKey)}&s=${encodeURIComponent(query)}&type=${contentType === 'series' ? 'series' : 'movie'}`, undefined, 'OMDb API');
  const record = asRecord(data);

  if (safeString(record.Response) === 'False') {
    throw new Error(safeString(record.Error) || 'Ничего не найдено');
  }

  return asArray(record.Search)
    .map((item) => createCoverResult({
      id: `omdb-${safeString(item.imdbID)}`,
      previewUrl: safeString(item.Poster) === 'N/A' ? '' : safeString(item.Poster),
      itemName: safeString(item.Title) || 'item',
      displayName: safeString(item.Title) || 'item',
      officialName: safeString(item.Title) || 'item',
      year: safeString(item.Year),
      sourceApi: 'OMDb API'
    }, query))
    .filter((item) => item.previewUrl);
}

export async function downloadCover(payload: {
  imageUrl: string;
  fileName: string;
}) {
  const response = await fetch('/api/download-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Не удалось скачать изображение');
  }

  return response.blob();
}

export function buildFileName(template: string, item: Pick<CoverResult, 'displayName' | 'officialName' | 'year'>) {
  const source = {
    '{title}': item.displayName,
    '{eng_title}': item.officialName,
    '{year}': item.year ?? ''
  };

  let value = template || '{eng_title}_preview';

  for (const [token, tokenValue] of Object.entries(source)) {
    value = value.replaceAll(token, tokenValue || '');
  }

  value = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');

  return value || 'preview';
}

export function rankResults(searchQuery: string, items: CoverResult[]) {
  return [...items].sort((left, right) => {
    const leftScore = left.relevanceScore || scoreMatch(searchQuery, left.displayName, left.officialName, left.itemName);
    const rightScore = right.relevanceScore || scoreMatch(searchQuery, right.displayName, right.officialName, right.itemName);
    return rightScore - leftScore;
  });
}
