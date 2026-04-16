'use client';

import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { buildFileName, downloadCover, getDefaultCoverApi, rankResults, searchCovers, searchTitles } from '@/lib/api';
import { contentTypeLabels, defaultSettings, getCoverApiOptions } from '@/lib/constants';
import { loadSettings, saveSettings } from '@/lib/storage';
import type { AppSettings, ContentType, CoverResult, CoverVariant, SearchTitleResult } from '@/lib/types';
import styles from './preview-app.module.css';

const contentTypes = Object.entries(contentTypeLabels) as Array<[ContentType, string]>;

export function PreviewApp() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [titleResults, setTitleResults] = useState<SearchTitleResult[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<SearchTitleResult | null>(null);
  const [contentType, setContentType] = useState<ContentType>('anime');
  const [coverApi, setCoverApi] = useState('kitsu');
  const [coverResults, setCoverResults] = useState<CoverResult[]>([]);
  const [selectedCover, setSelectedCover] = useState<CoverResult | null>(null);
  const [selectedCoverVariantId, setSelectedCoverVariantId] = useState('');
  const [titleLoading, setTitleLoading] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [isFullscreenPreviewOpen, setIsFullscreenPreviewOpen] = useState(false);
  const [status, setStatus] = useState('Сначала выполните поиск названия в шаге 1');
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = loadSettings();
    setSettings(stored);
    setCoverApi(getDefaultCoverApi('anime', stored));
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    saveSettings(settings);
  }, [settings, settingsLoaded]);

  const coverApiOptions = useMemo(() => getCoverApiOptions(contentType, settings.kinopoiskApiKey), [contentType, settings.kinopoiskApiKey]);

  const selectedTitleQuery = useMemo(() => {
    if (!selectedTitle) {
      return '';
    }

    const official = selectedTitle.officialName.trim();
    const display = selectedTitle.displayName.trim();

    if (official && official.toLowerCase() !== display.toLowerCase()) {
      return official;
    }

    return official || display;
  }, [selectedTitle]);

  const selectedTitleCaption = useMemo(() => {
    if (!selectedTitle) {
      return 'Выбранное название: не выбрано';
    }

    if (selectedTitleQuery && selectedTitleQuery.toLowerCase() !== selectedTitle.displayName.trim().toLowerCase()) {
      return `Выбранное название: ${selectedTitle.displayName} → ${selectedTitleQuery}`;
    }

    return `Выбранное название: ${selectedTitleQuery || selectedTitle.displayName}`;
  }, [selectedTitle, selectedTitleQuery]);

  const selectedCoverVariant = useMemo(() => {
    if (!selectedCover?.variants?.length) {
      return null;
    }

    return selectedCover.variants.find((variant) => variant.id === selectedCoverVariantId) ?? selectedCover.variants[0] ?? null;
  }, [selectedCover, selectedCoverVariantId]);

  const selectedCoverImageUrl = selectedCoverVariant?.url || selectedCover?.previewUrl || '';

  useEffect(() => {
    if (!coverApiOptions.some((item: { value: string }) => item.value === coverApi)) {
      setCoverApi(coverApiOptions[0]?.value ?? '');
    }
  }, [coverApi, coverApiOptions]);

  useEffect(() => {
    setSelectedCoverVariantId(selectedCover?.variants?.[0]?.id ?? '');
  }, [selectedCover]);

  useEffect(() => {
    if (!isFullscreenPreviewOpen) {
      return;
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsFullscreenPreviewOpen(false);
      }
    }

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isFullscreenPreviewOpen]);

  async function handleTitleSearch() {
    setTitleLoading(true);
    setError('');
    setStatus('Ищу точное название...');
    setSelectedTitle(null);
    setSelectedCover(null);
    setCoverResults([]);

    try {
      const results = await searchTitles(searchQuery, contentType, settings);
      setTitleResults(results);
      setStatus(results.length ? `Найдено вариантов: ${results.length}. Выберите точное название.` : 'Ничего не найдено');
    } catch (currentError) {
      const message = currentError instanceof Error ? currentError.message : 'Ошибка поиска названия';
      setError(message);
      setStatus(message);
      setTitleResults([]);
    } finally {
      setTitleLoading(false);
    }
  }

  async function handleCoverSearch() {
    const query = selectedTitleQuery || searchQuery.trim();
    if (!query) {
      setError('Сначала выберите точное название');
      return;
    }

    setCoverLoading(true);
    setError('');
    setSelectedCover(null);
    setStatus('Ищу обложки...');

    try {
      const results = await searchCovers({
        query,
        contentType,
        api: coverApi,
        settings
      });
      const ranked = rankResults(query, results);
      setCoverResults(ranked);
      setStatus(ranked.length ? `Найдено обложек: ${ranked.length}. Выберите подходящую.` : 'Обложки не найдены');
    } catch (currentError) {
      const message = currentError instanceof Error ? currentError.message : 'Ошибка поиска обложек';
      setError(message);
      setStatus(message);
      setCoverResults([]);
    } finally {
      setCoverLoading(false);
    }
  }

  async function handleDownload() {
    if (!selectedCover) {
      setError('Сначала выберите обложку');
      return;
    }

    setDownloadLoading(true);
    setError('');

    try {
      const fileName = buildFileName(settings.fileNameTemplate, selectedCover);
      const blob = await downloadCover({ imageUrl: selectedCoverImageUrl || selectedCover.previewUrl, fileName });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      anchor.href = url;
      anchor.download = `${fileName}.${extension}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setStatus(`Готово! Загружено: ${fileName}.${extension}`);
    } catch (currentError) {
      const message = currentError instanceof Error ? currentError.message : 'Ошибка скачивания';
      setError(message);
      setStatus(message);
    } finally {
      setDownloadLoading(false);
    }
  }

  function updateSettings<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((previous: AppSettings) => ({
      ...previous,
      [key]: value
    }));
  }

  function handleTextInputChange(setter: (value: string) => void) {
    return (event: ChangeEvent<HTMLInputElement>) => setter(event.target.value);
  }

  function handleSelectValueChange<T extends string>(setter: (value: T) => void) {
    return (event: ChangeEvent<HTMLSelectElement>) => setter(event.target.value as T);
  }

  function handleModalClick(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  function handlePreviewKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsFullscreenPreviewOpen(true);
    }
  }

  function handleCoverVariantSelect(variant: CoverVariant) {
    setSelectedCoverVariantId(variant.id);
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <span className={styles.badge}>React + Next.js</span>
          <h1 className={styles.title}>Preview</h1>
          <p className={styles.subtitle}>
            Поиск и скачивание обложек для аниме, фильмов, сериалов и книг с адаптивным интерфейсом для десктопа и мобильных устройств.
          </p>
        </div>
        <button className={styles.secondaryButton} onClick={() => setIsSettingsOpen(true)} type="button">
          Настройки
        </button>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.step}>Шаг 1</span>
              <h2>Поиск точного названия</h2>
            </div>
          </div>

          <div className={styles.formRow}>
            <input
              className={styles.input}
              value={searchQuery}
              onChange={handleTextInputChange(setSearchQuery)}
              placeholder="Например: атака титанов, Fight Club, Ведьмак"
            />
            <button className={styles.primaryButton} onClick={handleTitleSearch} disabled={titleLoading} type="button">
              {titleLoading ? 'Поиск...' : 'Найти название'}
            </button>
          </div>

          <div className={styles.resultList}>
            {titleResults.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.resultItem} ${selectedTitle?.id === item.id ? styles.resultItemActive : ''}`}
                onClick={() => {
                  setSelectedTitle(item);
                  setStatus('Название выбрано. Теперь можно искать обложку.');
                }}
              >
                <strong>{item.displayName}</strong>
                <span>{item.officialName}</span>
                <span>{[item.kind, item.year].filter(Boolean).join(' • ')}</span>
              </button>
            ))}
            {!titleLoading && !titleResults.length && <div className={styles.emptyState}>Результаты поиска появятся здесь</div>}
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.step}>Шаг 2</span>
              <h2>Поиск обложки</h2>
            </div>
          </div>

          <div className={styles.filters}>
            <label className={styles.field}>
              <span>Тип контента</span>
              <select className={styles.select} value={contentType} onChange={handleSelectValueChange<ContentType>(setContentType)}>
                {contentTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>API для обложки</span>
              <select className={styles.select} value={coverApi} onChange={handleSelectValueChange<string>(setCoverApi)}>
                {coverApiOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button className={styles.primaryButton} onClick={handleCoverSearch} disabled={coverLoading} type="button">
              {coverLoading ? 'Поиск...' : 'Найти обложку'}
            </button>
          </div>

          <div className={styles.status}>{selectedTitleCaption}</div>

          <div className={styles.status}>{status}</div>
          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.coverGrid}>
            {coverResults.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.coverCard} ${selectedCover?.id === item.id ? styles.coverCardActive : ''}`}
                onClick={() => setSelectedCover(item)}
              >
                <div className={styles.coverImageWrap}>
                  <img src={item.previewUrl} alt={item.displayName} className={styles.coverImage} />
                </div>
                <div className={styles.coverMeta}>
                  <strong>{item.displayName}</strong>
                  <span>{item.officialName}</span>
                  <span>{[item.sourceApi, item.year].filter(Boolean).join(' • ')}</span>
                </div>
              </button>
            ))}
            {!coverLoading && !coverResults.length && <div className={styles.emptyState}>Здесь появятся найденные обложки</div>}
          </div>
        </article>
      </section>

      <section className={styles.previewSection}>
        <article className={styles.previewCard}>
          <div>
            <span className={styles.step}>Выбранная обложка</span>
            <h2>Предпросмотр</h2>
          </div>
          {selectedCover ? (
            <>
              <button
                type="button"
                className={styles.previewImageButton}
                onClick={() => setIsFullscreenPreviewOpen(true)}
                onKeyDown={handlePreviewKeyDown}
              >
                <div className={styles.previewImageWrap}>
                  <img src={selectedCoverImageUrl || selectedCover.previewUrl} alt={selectedCover.displayName} className={styles.previewImage} />
                </div>
              </button>
              {selectedCover.variants?.length ? (
                <div className={styles.variantSection}>
                  <div className={styles.variantTitle}>Варианты постера</div>
                  <div className={styles.variantList}>
                    {selectedCover.variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        className={`${styles.variantButton} ${selectedCoverVariant?.id === variant.id ? styles.variantButtonActive : ''}`}
                        onClick={() => handleCoverVariantSelect(variant)}
                      >
                        {variant.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className={styles.previewMeta}>
                <strong>{selectedCover.displayName}</strong>
                <span>{selectedCover.officialName}</span>
                <span>{selectedCover.sourceApi}</span>
                {selectedCoverVariant ? <span>Выбранный размер: {selectedCoverVariant.label}</span> : null}
              </div>
              <button className={styles.primaryButton} onClick={handleDownload} disabled={downloadLoading} type="button">
                {downloadLoading ? 'Скачивание...' : 'Скачать выбранную обложку'}
              </button>
              <div className={styles.hint}>
                На вебе файл будет скачан в стандартную папку браузера. Путь из desktop-версии заменён на безопасное браузерное скачивание.
              </div>
            </>
          ) : (
            <div className={styles.emptyPreview}>Выбери обложку в галерее, и здесь появится предпросмотр</div>
          )}
        </article>
      </section>

      {isFullscreenPreviewOpen && selectedCover && (
        <div className={styles.fullscreenPreviewBackdrop} onClick={() => setIsFullscreenPreviewOpen(false)}>
          <div className={styles.fullscreenPreviewContent} onClick={handleModalClick}>
            <button className={styles.fullscreenCloseButton} onClick={() => setIsFullscreenPreviewOpen(false)} type="button">
              ×
            </button>
            <img src={selectedCoverImageUrl || selectedCover.previewUrl} alt={selectedCover.displayName} className={styles.fullscreenPreviewImage} />
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsSettingsOpen(false)}>
          <div className={styles.modal} onClick={handleModalClick}>
            <div className={styles.modalHeader}>
              <h2>Настройки</h2>
              <button className={styles.iconButton} onClick={() => setIsSettingsOpen(false)} type="button">
                ×
              </button>
            </div>
            <div className={styles.settingsGrid}>
              <label className={styles.field}>
                <span>OMDb API key</span>
                <input className={styles.input} value={settings.omdbApiKey} onChange={handleTextInputChange((value) => updateSettings('omdbApiKey', value))} />
              </label>
              <label className={styles.field}>
                <span>Kinopoisk API key</span>
                <input className={styles.input} value={settings.kinopoiskApiKey} onChange={handleTextInputChange((value) => updateSettings('kinopoiskApiKey', value))} />
              </label>
              <label className={styles.field}>
                <span>Google Books API key</span>
                <input className={styles.input} value={settings.googleBooksApiKey} onChange={handleTextInputChange((value) => updateSettings('googleBooksApiKey', value))} />
              </label>
              <label className={styles.field}>
                <span>Путь сохранения</span>
                <input className={styles.input} value={settings.downloadPath} onChange={handleTextInputChange((value) => updateSettings('downloadPath', value))} />
              </label>
              <label className={`${styles.field} ${styles.fieldFull}`}>
                <span>Шаблон имени файла</span>
                <input className={styles.input} value={settings.fileNameTemplate} onChange={handleTextInputChange((value) => updateSettings('fileNameTemplate', value))} />
              </label>
            </div>
            <div className={styles.hint}>Поддерживаются плейсхолдеры: {'{title}'}, {'{eng_title}'}, {'{year}'}</div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryButton} onClick={() => setIsSettingsOpen(false)} type="button">
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
