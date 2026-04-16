import type { AppSettings, ContentType, CoverApiOption } from './types';

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

export function getCoverApiOptions(contentType: ContentType, kinopoiskApiKey: string): CoverApiOption[] {
  switch (contentType) {
    case 'anime':
      return [
        { value: 'kitsu', label: 'Kitsu API' },
        { value: 'jikan', label: 'Jikan API' }
      ];
    case 'movie':
    case 'series':
      return [
        ...(kinopoiskApiKey ? [{ value: 'kinopoisk', label: 'Kinopoisk API' }] : []),
        { value: 'omdb', label: 'OMDb API' }
      ];
    case 'book':
      return [{ value: 'openlibrary', label: 'Open Library API' }];
  }
}
