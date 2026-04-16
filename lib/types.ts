export type ContentType = 'anime' | 'movie' | 'series' | 'book';

export type CoverApiOption = {
  value: string;
  label: string;
};

export type AppSettings = {
  omdbApiKey: string;
  kinopoiskApiKey: string;
  googleBooksApiKey: string;
  downloadPath: string;
  fileNameTemplate: string;
};

export type SearchTitleResult = {
  id: string;
  displayName: string;
  officialName: string;
  year?: string;
  kind?: string;
};

export type CoverVariant = {
  id: string;
  label: string;
  url: string;
};

export type CoverResult = {
  id: string;
  previewUrl: string;
  variants?: CoverVariant[];
  itemName: string;
  displayName: string;
  officialName: string;
  year?: string;
  sourceApi: string;
  relevanceScore: number;
};
