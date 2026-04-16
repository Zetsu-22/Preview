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

async function getInternalJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
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

function mapGoogleBooksTitles(data: unknown): SearchTitleResult[] {
  return asArray(asRecord(data).items)
    .map((item) => {
      const volumeInfo = asRecord(item.volumeInfo);
      const authors = asArray(volumeInfo.authors).map((author) => safeString(author)).filter(Boolean);
      const title = safeString(volumeInfo.title);
      const subtitle = safeString(volumeInfo.subtitle);

      return {
        id: `google-books-${safeString(item.id) || Math.random()}`,
        displayName: title,
        officialName: authors.length ? `${title} ${authors.join(' ')}` : title,
        year: safeString(volumeInfo.publishedDate).slice(0, 4),
        kind: subtitle || 'book'
      };
    })
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

  const alternativeQuery = getAnimeAlternativeQuery(query);

  if (alternativeQuery !== query) {
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

async function searchKinopoiskTitles(query: string, kind: ContentType, settings: AppSettings): Promise<SearchTitleResult[]> {
  if (!settings.kinopoiskApiKey) {
    return [];
  }

  const kinopoiskData = await getExternalJson(`https://api.kinopoisk.dev/v1.4/movie/search?query=${encodeURIComponent(query)}&limit=20`, {
    headers: {
      'X-API-KEY': settings.kinopoiskApiKey
    }
  }, 'Kinopoisk API');

  const docs = asArray(asRecord(kinopoiskData).docs);

  const filtered = docs.filter((item) => {
    const currentType = safeString(item.type);

    if (kind === 'movie') {
      return currentType !== 'tv-series';
    }

    if (kind === 'series') {
      return currentType === 'tv-series' || currentType === 'animated-series' || currentType === 'mini-series';
    }

    return true;
  });

  return normalizeTitleResults(mapKinopoiskTitles({ docs: filtered }, kind === 'book' ? 'movie' : kind === 'series' ? 'series' : 'movie'), query).slice(0, 20);
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

async function searchBookTitles(query: string, settings: AppSettings): Promise<SearchTitleResult[]> {
  const combined: SearchTitleResult[] = [];

  if (settings.googleBooksApiKey) {
    try {
      const googleBooksData = await getExternalJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&langRestrict=ru&maxResults=10&key=${encodeURIComponent(settings.googleBooksApiKey)}`, undefined, 'Google Books API');
      combined.push(...mapGoogleBooksTitles(googleBooksData));
    } catch {
    }
  }

  try {
    const openLibraryData = await getExternalJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=20`, undefined, 'Open Library API');
    combined.push(...mapOpenLibraryTitles(openLibraryData));
  } catch (error) {
    if (!combined.length) {
      throw error;
    }
  }

  return normalizeTitleResults(uniqueById(combined), query).slice(0, 20);
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

  return getInternalJson<SearchTitleResult[]>('/api/search-title', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      contentType,
      settings
    })
  });
}

export async function searchCovers(payload: {
  query: string;
  contentType: ContentType;
  api: string;
  settings: AppSettings;
}): Promise<CoverResult[]> {
  const { query } = payload;

  if (!query.trim()) {
    return [];
  }

  return getInternalJson<CoverResult[]>('/api/search-cover', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
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
