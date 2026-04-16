import type { ContentType, CoverResult, SearchTitleResult } from './types';

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
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

function uniqueById<T extends { id: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

function normalizeSearchTitles(items: SearchTitleResult[], query: string) {
  const normalized = query.toLowerCase();
  return items.sort((a, b) => {
    const aExact = Number(a.displayName.toLowerCase() === normalized || a.officialName.toLowerCase() === normalized);
    const bExact = Number(b.displayName.toLowerCase() === normalized || b.officialName.toLowerCase() === normalized);
    return bExact - aExact;
  });
}

export async function searchKinopoiskTitles(query: string): Promise<SearchTitleResult[]> {
  const encoded = encodeURIComponent(query.trim());
  const candidates: SearchTitleResult[] = [];

  try {
    const data = await fetchJson(`https://api.allorigins.win/raw?url=${encodeURIComponent(`https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=${encoded}&page=1`)}`, {
      headers: {
        'X-API-KEY': 'demo'
      }
    });

    const films = asArray(asRecord(data).films);
    for (const item of films) {
      const displayName = safeString(item.nameRu) || safeString(item.nameEn) || safeString(item.nameOriginal);
      const officialName = safeString(item.nameOriginal) || safeString(item.nameEn) || displayName;
      if (!displayName) {
        continue;
      }
      candidates.push({
        id: String(item.filmId ?? officialName),
        displayName,
        officialName,
        year: safeString(item.year),
        kind: safeString(item.type)
      });
    }
  } catch {
  }

  try {
    const data = await fetchJson(`https://api.jikan.moe/v4/anime?q=${encoded}&limit=10`);
    const items = asArray(asRecord(data).data);
    for (const item of items) {
      const displayName = safeString(item.title) || safeString(item.title_english);
      const officialName = safeString(item.title_english) || safeString(item.title_japanese) || displayName;
      if (!displayName) {
        continue;
      }
      candidates.push({
        id: `anime-${String(item.mal_id ?? officialName)}`,
        displayName,
        officialName,
        year: safeString(item.year),
        kind: 'anime'
      });
    }
  } catch {
  }

  try {
    const data = await fetchJson(`https://openlibrary.org/search.json?title=${encoded}&limit=10`);
    const docs = asArray(asRecord(data).docs);
    for (const item of docs) {
      const displayName = safeString(item.title);
      const officialName = safeString(item.title);
      if (!displayName) {
        continue;
      }
      candidates.push({
        id: `book-${safeString(item.key) || displayName}`,
        displayName,
        officialName,
        year: item.first_publish_year ? String(item.first_publish_year) : '',
        kind: 'book'
      });
    }
  } catch {
  }

  return normalizeSearchTitles(uniqueById(candidates), query).slice(0, 20);
}

function scoreMatch(query: string, ...values: Array<string | undefined>) {
  const q = query.toLowerCase().trim();
  const words = q.split(/[\s,._-]+/).filter((word) => word.length > 1);
  let score = 0;

  for (const value of values) {
    const current = safeString(value).toLowerCase();
    if (!current) {
      continue;
    }
    if (current === q) {
      score += 10000;
    }
    if (current.startsWith(q)) {
      score += 5000;
    }
    if (current.includes(q)) {
      score += 1200;
    }
    for (const word of words) {
      if (current.includes(word)) {
        score += 200;
      }
    }
  }

  return score;
}

function createCoverResult(input: Omit<CoverResult, 'relevanceScore'>, query: string): CoverResult {
  return {
    ...input,
    relevanceScore: scoreMatch(query, input.displayName, input.officialName, input.itemName)
  };
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
        .map((item: Record<string, unknown>) => createCoverResult({
          id: `jikan-${String(item.mal_id ?? Math.random())}`,
          previewUrl: safeString(asRecord(asRecord(item.images).jpg).large_image_url) || safeString(asRecord(asRecord(item.images).jpg).image_url) || safeString(asRecord(asRecord(item.images).webp).large_image_url),
          itemName: safeString(item.title) || 'anime',
          displayName: safeString(item.title) || safeString(item.title_english) || 'anime',
          officialName: safeString(item.title_english) || safeString(item.title_japanese) || safeString(item.title) || 'anime',
          year: item.year ? String(item.year) : '',
          sourceApi: 'Jikan API'
        }, query))
        .filter((item: CoverResult) => item.previewUrl);
    }

    const data = await fetchJson(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=20`);
    const items = asArray(asRecord(data).data);
    return items
      .map((item: Record<string, unknown>) => createCoverResult({
        id: `kitsu-${safeString(item.id)}`,
        previewUrl: safeString(asRecord(asRecord(item.attributes).posterImage).original) || safeString(asRecord(asRecord(item.attributes).posterImage).large),
        itemName: safeString(asRecord(item.attributes).slug) || 'anime',
        displayName: safeString(asRecord(asRecord(item.attributes).titles).en) || safeString(asRecord(item.attributes).canonicalTitle) || 'anime',
        officialName: safeString(asRecord(item.attributes).canonicalTitle) || safeString(asRecord(asRecord(item.attributes).titles).en_jp) || safeString(asRecord(asRecord(item.attributes).titles).ja_jp) || 'anime',
        year: safeString(asRecord(item.attributes).startDate).slice(0, 4),
        sourceApi: 'Kitsu API'
      }, query))
      .filter((item: CoverResult) => item.previewUrl);
  }

  if (contentType === 'book') {
    const data = await fetchJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=20`);
    const items = asArray(asRecord(data).docs);
    return items
      .map((item: Record<string, unknown>) => {
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
      previewUrl: safeString(item.Poster) === 'N/A' ? '' : safeString(item.Poster),
      itemName: safeString(item.Title) || 'item',
      displayName: safeString(item.Title) || 'item',
      officialName: safeString(item.Title) || 'item',
      year: safeString(item.Year),
      sourceApi: 'OMDb API'
    }, query))
    .filter((item: CoverResult) => item.previewUrl);
}
