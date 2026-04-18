import type { AppSettings, ContentType, CoverApiOption } from './types';

export const serverApiKeyAvailability = {
  omdb: process.env.NEXT_PUBLIC_HAS_OMDB_API_KEY === 'true',
  kinopoisk: process.env.NEXT_PUBLIC_HAS_KINOPOISK_API_KEY === 'true',
  googleBooks: process.env.NEXT_PUBLIC_HAS_GOOGLE_BOOKS_API_KEY === 'true'
};

export const contentTypeLabels: Record<ContentType, string> = {
  anime: 'Аниме',
  movie: 'Фильм',
  series: 'Сериал',
  book: 'Книга'
};

export const defaultSettings: AppSettings = {
  omdbApiKey: '',
  kinopoiskApiKey: '',
  googleBooksApiKey: '',
  downloadPath: '',
  fileNameTemplate: '{eng_title}_preview'
};

export function hasApiKey(value: string) {
  return Boolean(value.trim());
}

export function getCoverApiOptions(contentType: ContentType, kinopoiskApiKey: string): CoverApiOption[] {
  const hasKinopoiskAccess = hasApiKey(kinopoiskApiKey) || serverApiKeyAvailability.kinopoisk;

  switch (contentType) {
    case 'anime':
      return [
        { value: 'kitsu', label: 'Kitsu API' },
        { value: 'jikan', label: 'Jikan API' }
      ];
    case 'movie':
    case 'series':
      return [
        ...(hasKinopoiskAccess ? [{ value: 'kinopoisk', label: 'Kinopoisk API' }] : []),
        { value: 'omdb', label: 'OMDb API' }
      ];
    case 'book':
      return [{ value: 'openlibrary', label: 'Open Library API' }];
  }
}
