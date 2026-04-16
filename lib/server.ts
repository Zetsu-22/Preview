import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ContentType, CoverResult, CoverVariant, SearchTitleResult } from './types';

function maskSecrets(value: string) {
  if (!value) {
    return value;
  }

  if (value.length <= 8) {
    return '***';
  }

  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function sanitizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    for (const key of ['apikey', 'apiKey', 'key']) {
      const current = parsed.searchParams.get(key);
      if (current) {
        parsed.searchParams.set(key, maskSecrets(current));
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function sanitizeHeaders(headers?: HeadersInit) {
  if (!headers) {
    return {};
  }

  const source = new Headers(headers);
  const result: Record<string, string> = {};

  source.forEach((value, key) => {
    result[key] = key.toLowerCase().includes('key') || key.toLowerCase().includes('authorization')
      ? maskSecrets(value)
      : value;
  });

  return result;
}

const externalApiLogsDirectory = path.join(process.cwd(), 'logs');
const externalApiLogFile = path.join(externalApiLogsDirectory, 'external-api.log');

async function writeExternalApiLog(entry: string) {
  await mkdir(externalApiLogsDirectory, { recursive: true });
  await appendFile(externalApiLogFile, `${entry}\n`, 'utf8');
}

function formatExternalApiLog(label: string, payload: Record<string, unknown>) {
  return `${new Date().toISOString()} ${label} ${JSON.stringify(payload, null, 2)}`;
}

async function logExternalApi(label: string, payload: Record<string, unknown>) {
  const formatted = formatExternalApiLog(label, payload);

  console.log(label, payload);

  try {
    await writeExternalApiLog(formatted);
  } catch (error) {
    console.error('[external-api:log-write-error]', error);
  }
}

async function readResponseBody(response: Response) {
  const clone = response.clone();

  try {
    return await clone.text();
  } catch {
    return '<unavailable>';
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET';
  const safeUrl = sanitizeUrl(url);
  const safeHeaders = sanitizeHeaders(init?.headers);

  await logExternalApi('[external-api:request]', {
    method,
    url: safeUrl,
    headers: safeHeaders
  });

  const response = await fetch(url, {
    ...init,
    cache: 'no-store'
  });

  const body = await readResponseBody(response);

  await logExternalApi('[external-api:response]', {
    method,
    url: safeUrl,
    status: response.status,
    ok: response.ok,
    body
  });

  if (!response.ok) {
    throw new Error(body || `HTTP ${response.status}`);
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Внешний API вернул невалидный JSON');
  }
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function getBestOmdbPosterUrl(url: string) {
  if (!url || url === 'N/A') {
    return '';
  }

  if (!url.includes('m.media-amazon.com')) {
    return url;
  }

  return url.replace(/\._V1_[^.]+(?=\.[a-zA-Z]+(?:\?.*)?$)/, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => asRecord(item)) : [];
}

function normalizeText(value: string) {
  return value.toLowerCase().trim();
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

function normalizeTitleResults(items: SearchTitleResult[], query: string) {
  const normalized = normalizeText(query);

  return [...items].sort((left, right) => {
    const leftScore = scoreMatch(normalized, left.displayName, left.officialName);
    const rightScore = scoreMatch(normalized, right.displayName, right.officialName);
    return rightScore - leftScore;
  });
}

function createCoverResult(input: Omit<CoverResult, 'relevanceScore'>, query: string): CoverResult {
  return {
    ...input,
    relevanceScore: scoreMatch(query, input.displayName, input.officialName, input.itemName)
  };
}

function getKitsuPosterVariants(attributes: Record<string, unknown>): CoverVariant[] {
  const posterImage = asRecord(attributes.posterImage);
  const variants: CoverVariant[] = [];

  for (const [key, label] of [
    ['original', 'Original'],
    ['large', 'Large'],
    ['medium', 'Medium'],
    ['small', 'Small'],
    ['tiny', 'Tiny']
  ] as const) {
    const url = safeString(posterImage[key]);

    if (!url || variants.some((variant) => variant.url === url)) {
      continue;
    }

    variants.push({
      id: key,
      label,
      url
    });
  }

  return variants;
}

function getJikanPosterVariants(item: Record<string, unknown>): CoverVariant[] {
  const images = asRecord(item.images);
  const jpg = asRecord(images.jpg);
  const webp = asRecord(images.webp);
  const variants: CoverVariant[] = [];

  for (const [group, labelPrefix] of [
    [jpg, 'JPG'],
    [webp, 'WEBP']
  ] as const) {
    for (const [key, label] of [
      ['large_image_url', 'Large'],
      ['image_url', 'Default'],
      ['small_image_url', 'Small']
    ] as const) {
      const url = safeString(group[key]);

      if (!url || variants.some((variant) => variant.url === url)) {
        continue;
      }

      variants.push({
        id: `${labelPrefix.toLowerCase()}-${key}`,
        label: `${labelPrefix} ${label}`,
        url
      });
    }
  }

  return variants;
}

function getOpenLibraryCoverVariants(coverId: string): CoverVariant[] {
  if (!coverId) {
    return [];
  }

  return [
    {
      id: 'large',
      label: 'Large',
      url: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    },
    {
      id: 'medium',
      label: 'Medium',
      url: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
    },
    {
      id: 'small',
      label: 'Small',
      url: `https://covers.openlibrary.org/b/id/${coverId}-S.jpg`
    }
  ];
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
  const alternativeQuery = getAnimeAlternativeQuery(query);

  if (alternativeQuery !== query) {
    try {
      const jikanData = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(alternativeQuery)}&limit=20`);
      combined.push(...mapJikanAnimeTitles(jikanData));
    } catch {
    }
  }

  if (!combined.length) {
    const fallback = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=20`);
    combined.push(...mapJikanAnimeTitles(fallback));
  }

  return normalizeTitleResults(uniqueById(combined), query).slice(0, 20);
}

async function searchKinopoiskTitleResults(query: string, kind: ContentType, settings: { kinopoiskApiKey?: string }): Promise<SearchTitleResult[]> {
  if (!settings.kinopoiskApiKey) {
    return [];
  }

  const kinopoiskData = await fetchJson(`https://api.kinopoisk.dev/v1.4/movie/search?query=${encodeURIComponent(query)}&limit=20`, {
    headers: {
      'X-API-KEY': settings.kinopoiskApiKey
    }
  });

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

  return normalizeTitleResults(mapKinopoiskTitles({ docs: filtered }, kind === 'series' ? 'series' : 'movie'), query).slice(0, 20);
}

async function searchMovieOrSeriesTitles(query: string, kind: 'movie' | 'series', settings: { omdbApiKey?: string; kinopoiskApiKey?: string }): Promise<SearchTitleResult[]> {
  if (settings.kinopoiskApiKey) {
    try {
      const kinopoiskData = await fetchJson(`https://api.kinopoisk.dev/v1.4/movie/search?query=${encodeURIComponent(query)}&limit=20`, {
        headers: {
          'X-API-KEY': settings.kinopoiskApiKey
        }
      });

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

  const omdbData = await fetchJson(`https://www.omdbapi.com/?apikey=${encodeURIComponent(settings.omdbApiKey)}&s=${encodeURIComponent(query)}&type=${kind}`);
  return normalizeTitleResults(mapOmdbTitles(omdbData, kind), query).slice(0, 20);
}

async function searchBookTitles(query: string, settings: { googleBooksApiKey?: string }): Promise<SearchTitleResult[]> {
  const combined: SearchTitleResult[] = [];

  if (settings.googleBooksApiKey) {
    try {
      const googleBooksData = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&langRestrict=ru&maxResults=10&key=${encodeURIComponent(settings.googleBooksApiKey)}`);
      combined.push(...mapGoogleBooksTitles(googleBooksData));
    } catch {
    }
  }

  try {
    const openLibraryData = await fetchJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=20`);
    combined.push(...mapOpenLibraryTitles(openLibraryData));
  } catch (error) {
    if (!combined.length) {
      throw error;
    }
  }

  return normalizeTitleResults(uniqueById(combined), query).slice(0, 20);
}

export async function searchTitleResults(params: {
  query: string;
  contentType: ContentType;
  settings: {
    omdbApiKey?: string;
    kinopoiskApiKey?: string;
    googleBooksApiKey?: string;
  };
}): Promise<SearchTitleResult[]> {
  const { query, contentType, settings } = params;

  if (contentType === 'anime') {
    const combined: SearchTitleResult[] = [];

    try {
      combined.push(...await searchKinopoiskTitleResults(query, 'anime', settings));
    } catch {
    }

    try {
      combined.push(...await searchAnimeTitles(query));
    } catch (error) {
      if (!combined.length) {
        throw error;
      }
    }

    return normalizeTitleResults(uniqueById(combined), query).slice(0, 20);
  }

  if (contentType === 'movie') {
    return searchMovieOrSeriesTitles(query, 'movie', settings);
  }

  if (contentType === 'series') {
    return searchMovieOrSeriesTitles(query, 'series', settings);
  }

  return searchBookTitles(query, settings);
}

export async function searchCoverResults(params: {
  query: string;
  contentType: ContentType;
  api: string;
  settings: {
    omdbApiKey?: string;
    kinopoiskApiKey?: string;
    googleBooksApiKey?: string;
  };
}): Promise<CoverResult[]> {
  const { query, contentType, api, settings } = params;

  if (contentType === 'anime') {
    if (api === 'jikan') {
      const data = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=20`);
      const items = asArray(asRecord(data).data);
      return items
        .map((item: Record<string, unknown>) => {
          const variants = getJikanPosterVariants(item);

          return createCoverResult({
            id: `jikan-${String(item.mal_id ?? Math.random())}`,
            previewUrl: variants[0]?.url || '',
            variants,
            itemName: safeString(item.title) || 'anime',
            displayName: safeString(item.title) || safeString(item.title_english) || 'anime',
            officialName: safeString(item.title_english) || safeString(item.title_japanese) || safeString(item.title) || 'anime',
            year: item.year ? String(item.year) : '',
            sourceApi: 'Jikan API'
          }, query);
        })
        .filter((item: CoverResult) => item.previewUrl);
    }

    const data = await fetchJson(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=20`);
    const items = asArray(asRecord(data).data);
    return items
      .map((item: Record<string, unknown>) => {
        const attributes = asRecord(item.attributes);
        const variants = getKitsuPosterVariants(attributes);

        return createCoverResult({
          id: `kitsu-${safeString(item.id)}`,
          previewUrl: variants[0]?.url || '',
          variants,
          itemName: safeString(attributes.slug) || 'anime',
          displayName: safeString(asRecord(attributes.titles).en) || safeString(attributes.canonicalTitle) || 'anime',
          officialName: safeString(attributes.canonicalTitle) || safeString(asRecord(attributes.titles).en_jp) || safeString(asRecord(attributes.titles).ja_jp) || 'anime',
          year: safeString(attributes.startDate).slice(0, 4),
          sourceApi: 'Kitsu API'
        }, query);
      })
      .filter((item: CoverResult) => item.previewUrl);
  }

  if (contentType === 'book') {
    const data = await fetchJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=20`);
    const items = asArray(asRecord(data).docs);
    return items
      .map((item: Record<string, unknown>) => {
        const coverId = item.cover_i;
        const variants = getOpenLibraryCoverVariants(String(coverId ?? ''));

        return createCoverResult({
          id: `book-${safeString(item.key)}`,
          previewUrl: variants[0]?.url || '',
          variants,
          itemName: safeString(item.title) || 'book',
          displayName: safeString(item.title) || 'book',
          officialName: safeString(item.title) || 'book',
          year: item.first_publish_year ? String(item.first_publish_year) : '',
          sourceApi: 'Open Library API'
        }, query);
      })
      .filter((item: CoverResult) => item.previewUrl);
  }

  if (api === 'kinopoisk') {
    if (!settings.kinopoiskApiKey) {
      throw new Error('Для Kinopoisk API нужен ключ в настройках');
    }

    const type = contentType === 'series' ? 'tv-series' : 'movie';
    const data = await fetchJson(`https://api.kinopoisk.dev/v1.4/movie/search?query=${encodeURIComponent(query)}&limit=20`, {
      headers: {
        'X-API-KEY': settings.kinopoiskApiKey
      }
    });

    const items = asArray(asRecord(data).docs);
    return items
      .filter((item: Record<string, unknown>) => {
        const currentType = safeString(item.type);
        return contentType === 'movie' ? currentType !== 'tv-series' : currentType === type || currentType === 'animated-series' || currentType === 'mini-series';
      })
      .map((item: Record<string, unknown>) => createCoverResult({
        id: `kp-${String(item.id ?? Math.random())}`,
        previewUrl: safeString(asRecord(item.poster).url) || safeString(asRecord(item.poster).previewUrl),
        itemName: safeString(item.name) || safeString(item.alternativeName) || 'item',
        displayName: safeString(item.name) || safeString(item.alternativeName) || 'item',
        officialName: safeString(item.alternativeName) || safeString(item.enName) || safeString(item.name) || 'item',
        year: item.year ? String(item.year) : '',
        sourceApi: 'Kinopoisk API'
      }, query))
      .filter((item: CoverResult) => item.previewUrl);
  }

  if (!settings.omdbApiKey) {
    throw new Error('Для OMDb API нужен ключ в настройках');
  }

  const type = contentType === 'series' ? 'series' : 'movie';
  const data = await fetchJson(`https://www.omdbapi.com/?apikey=${encodeURIComponent(settings.omdbApiKey)}&s=${encodeURIComponent(query)}&type=${type}`);

  if (safeString(asRecord(data).Response) === 'False') {
    throw new Error(safeString(asRecord(data).Error) || 'Ничего не найдено');
  }

  const items = asArray(asRecord(data).Search);
  return items
    .map((item: Record<string, unknown>) => createCoverResult({
      id: `omdb-${safeString(item.imdbID)}`,
      previewUrl: getBestOmdbPosterUrl(safeString(item.Poster)),
      itemName: safeString(item.Title) || 'item',
      displayName: safeString(item.Title) || 'item',
      officialName: safeString(item.Title) || 'item',
      year: safeString(item.Year),
      sourceApi: 'OMDb API'
    }, query))
    .filter((item: CoverResult) => item.previewUrl);
}
