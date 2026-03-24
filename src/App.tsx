import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueueItem, QueuePayload, QueueStatus, Podcast, SearchState } from './lib/types';
import { readStorage, writeStorage } from './lib/storage';

const SEARCH_KEY = 'podcastdeck.search';
const COMPARE_KEY = 'podcastdeck.compare';
const QUEUE_KEY = 'podcastdeck.queue';

const initialSearch: SearchState = {
  query: 'night shift',
  country: 'US',
  limit: 24,
};

const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP'];
const statuses: QueueStatus[] = ['planned', 'queued', 'listening', 'completed'];

type SortKey = 'relevance' | 'title' | 'episodes' | 'recent';
type FilterKey = 'all' | 'clean' | 'explicit';

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function queueId(podcastId: number) {
  return `${podcastId}-${Date.now()}`;
}

function App() {
  const [search, setSearch] = useState<SearchState>(() => readStorage(SEARCH_KEY, initialSearch));
  const [sortKey, setSortKey] = useState<SortKey>('relevance');
  const [explicitFilter, setExplicitFilter] = useState<FilterKey>('all');
  const [results, setResults] = useState<Podcast[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>(() => readStorage(COMPARE_KEY, []));
  const [queue, setQueue] = useState<QueueItem[]>(() => readStorage(QUEUE_KEY, []));
  const [importMessage, setImportMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    writeStorage(SEARCH_KEY, search);
  }, [search]);

  useEffect(() => {
    writeStorage(COMPARE_KEY, compareIds);
  }, [compareIds]);

  useEffect(() => {
    writeStorage(QUEUE_KEY, queue);
  }, [queue]);

  useEffect(() => {
    void runSearch(search);
  }, []);

  const podcastsById = useMemo(() => new Map(results.map((podcast) => [podcast.collectionId, podcast])), [results]);
  const selectedPodcast = selectedId ? podcastsById.get(selectedId) ?? null : results[0] ?? null;
  const compareItems = compareIds.map((id) => podcastsById.get(id)).filter(Boolean) as Podcast[];

  const filteredResults = useMemo(() => {
    let next = [...results];

    if (explicitFilter === 'clean') {
      next = next.filter((podcast) => podcast.collectionExplicitness !== 'explicit');
    }

    if (explicitFilter === 'explicit') {
      next = next.filter((podcast) => podcast.collectionExplicitness === 'explicit');
    }

    if (sortKey === 'title') {
      next.sort((a, b) => a.collectionName.localeCompare(b.collectionName));
    } else if (sortKey === 'episodes') {
      next.sort((a, b) => (b.trackCount ?? 0) - (a.trackCount ?? 0));
    } else if (sortKey === 'recent') {
      next.sort((a, b) => +new Date(b.releaseDate) - +new Date(a.releaseDate));
    }

    return next;
  }, [explicitFilter, results, sortKey]);

  async function runSearch(nextSearch: SearchState) {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        term: nextSearch.query,
        country: nextSearch.country,
        limit: String(nextSearch.limit),
        media: 'podcast',
        entity: 'podcast',
      });

      const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { results?: Podcast[] };
      const nextResults = payload.results ?? [];
      setResults(nextResults);
      setSelectedId(nextResults[0]?.collectionId ?? null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Search failed.');
      setResults([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(search);
  }

  function toggleCompare(id: number) {
    setCompareIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }

      if (current.length >= 3) {
        return [...current.slice(1), id];
      }

      return [...current, id];
    });
  }

  function addToQueue(podcast: Podcast) {
    setQueue((current) => {
      const nextItem: QueueItem = {
        id: queueId(podcast.collectionId),
        podcastId: podcast.collectionId,
        podcastName: podcast.collectionName,
        podcastAuthor: podcast.artistName,
        artworkUrl: podcast.artworkUrl600 ?? podcast.artworkUrl100,
        priority: current.length + 1,
        targetDate: '',
        notes: '',
        status: 'planned',
        addedAt: new Date().toISOString(),
      };

      return [...current, nextItem];
    });
  }

  function updateQueueItem(id: string, patch: Partial<QueueItem>) {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function removeQueueItem(id: string) {
    setQueue((current) => current.filter((item) => item.id !== id));
  }

  function exportQueue() {
    const payload: QueuePayload = {
      exportedAt: new Date().toISOString(),
      items: queue,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'podcastdeck-queue.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function importQueue(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const contents = await file.text();
      const payload = JSON.parse(contents) as QueuePayload;

      if (!Array.isArray(payload.items)) {
        throw new Error('Invalid queue payload.');
      }

      setQueue(payload.items);
      setImportMessage(`Imported ${payload.items.length} queue item(s).`);
    } catch (importError) {
      setImportMessage(importError instanceof Error ? importError.message : 'Import failed.');
    } finally {
      event.target.value = '';
    }
  }

  const totalEpisodes = compareItems.reduce((sum, item) => sum + (item.trackCount ?? 0), 0);

  return (
    <div className="min-h-screen bg-grain text-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="animate-rise rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 shadow-glow backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="font-display text-sm uppercase tracking-[0.35em] text-signal">Nightshift build 039</p>
              <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                PodcastDeck
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                Search the iTunes podcast catalog, inspect the signal, compare up to three candidates, and
                turn discoveries into a durable listening queue.
              </p>
            </div>

            <div className="grid gap-3 rounded-3xl border border-cyan-400/20 bg-cyan-300/10 p-4 text-sm text-slate-200 sm:grid-cols-3">
              <Stat label="Results" value={results.length} />
              <Stat label="Compared" value={compareItems.length} />
              <Stat label="Queued" value={queue.length} />
            </div>
          </div>
        </header>

        <main className="grid gap-8 xl:grid-cols-[1.25fr_0.95fr]">
          <section className="flex flex-col gap-8">
            <div className="animate-rise rounded-[2rem] border border-white/10 bg-slate-950/55 p-5 shadow-glow backdrop-blur [animation-delay:100ms]">
              <form className="grid gap-4 md:grid-cols-[1.8fr_0.7fr_0.7fr_auto]" onSubmit={handleSubmit}>
                <Field label="Query">
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
                    value={search.query}
                    onChange={(event) => setSearch((current) => ({ ...current, query: event.target.value }))}
                    placeholder="Search podcasts"
                  />
                </Field>
                <Field label="Country">
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
                    value={search.country}
                    onChange={(event) => setSearch((current) => ({ ...current, country: event.target.value }))}
                  >
                    {countries.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Limit">
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
                    type="number"
                    min={1}
                    max={50}
                    value={search.limit}
                    onChange={(event) =>
                      setSearch((current) => ({
                        ...current,
                        limit: Number(event.target.value) || 1,
                      }))
                    }
                  />
                </Field>
                <button
                  type="submit"
                  className="rounded-2xl bg-cyan-300 px-5 py-3 font-medium text-slate-950 transition hover:bg-cyan-200"
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </form>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Sort">
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
                    value={sortKey}
                    onChange={(event) => setSortKey(event.target.value as SortKey)}
                  >
                    <option value="relevance">Relevance</option>
                    <option value="title">Title</option>
                    <option value="episodes">Episode count</option>
                    <option value="recent">Most recent</option>
                  </select>
                </Field>
                <Field label="Filter">
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
                    value={explicitFilter}
                    onChange={(event) => setExplicitFilter(event.target.value as FilterKey)}
                  >
                    <option value="all">All shows</option>
                    <option value="clean">Clean only</option>
                    <option value="explicit">Explicit only</option>
                  </select>
                </Field>
              </div>

              {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
            </div>

            <div className="animate-rise rounded-[2rem] border border-white/10 bg-slate-950/55 p-5 shadow-glow backdrop-blur [animation-delay:200ms]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-2xl text-white">Search Results</h2>
                  <p className="text-sm text-slate-400">Client-side sorting and filtering stay active after each search.</p>
                </div>
                <p className="text-sm text-slate-400">{filteredResults.length} visible</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {filteredResults.map((podcast, index) => {
                  const compared = compareIds.includes(podcast.collectionId);
                  const selected = selectedPodcast?.collectionId === podcast.collectionId;

                  return (
                    <article
                      key={podcast.collectionId}
                      className={`rounded-3xl border p-4 transition ${
                        selected
                          ? 'border-cyan-300/70 bg-slate-900/95 shadow-glow'
                          : 'border-white/10 bg-slate-900/70 hover:border-white/20'
                      }`}
                      style={{ animationDelay: `${100 + index * 30}ms` }}
                    >
                      <div className="flex gap-4">
                        <img
                          src={podcast.artworkUrl600 ?? podcast.artworkUrl100}
                          alt={podcast.collectionName}
                          className="h-24 w-24 rounded-2xl object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setSelectedId(podcast.collectionId)}
                          >
                            <h3 className="font-display text-lg text-white">{podcast.collectionName}</h3>
                            <p className="mt-1 text-sm text-slate-300">{podcast.artistName}</p>
                          </button>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                            <Badge>{podcast.country}</Badge>
                            <Badge>{podcast.primaryGenreName ?? 'Podcast'}</Badge>
                            <Badge>{podcast.trackCount ?? 0} episodes</Badge>
                            <Badge>{podcast.collectionExplicitness}</Badge>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-cyan-300/40 px-3 py-2 text-sm text-cyan-100 transition hover:border-cyan-200"
                          onClick={() => setSelectedId(podcast.collectionId)}
                        >
                          Inspect
                        </button>
                        <button
                          type="button"
                          className={`rounded-full border px-3 py-2 text-sm transition ${
                            compared
                              ? 'border-rose-300/60 bg-rose-300/10 text-rose-100'
                              : 'border-white/10 text-slate-200 hover:border-white/25'
                          }`}
                          onClick={() => toggleCompare(podcast.collectionId)}
                        >
                          {compared ? 'Remove compare' : 'Add compare'}
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-emerald-300/40 px-3 py-2 text-sm text-emerald-100 transition hover:border-emerald-200"
                          onClick={() => addToQueue(podcast)}
                        >
                          Queue
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-8">
            <section className="animate-rise rounded-[2rem] border border-white/10 bg-slate-950/55 p-5 shadow-glow backdrop-blur [animation-delay:300ms]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-2xl text-white">Inspector</h2>
                  <p className="text-sm text-slate-400">Selected show metadata and quick actions.</p>
                </div>
              </div>

              {selectedPodcast ? (
                <div className="space-y-4">
                  <img
                    src={selectedPodcast.artworkUrl600 ?? selectedPodcast.artworkUrl100}
                    alt={selectedPodcast.collectionName}
                    className="aspect-square w-full rounded-[1.75rem] object-cover"
                  />
                  <div>
                    <h3 className="font-display text-2xl text-white">{selectedPodcast.collectionName}</h3>
                    <p className="mt-1 text-slate-300">{selectedPodcast.artistName}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                    {(selectedPodcast.genres ?? [selectedPodcast.primaryGenreName ?? 'Podcast']).map((genre) => (
                      <Badge key={genre}>{genre}</Badge>
                    ))}
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Meta label="Country" value={selectedPodcast.country} />
                    <Meta label="Episodes" value={String(selectedPodcast.trackCount ?? 0)} />
                    <Meta label="Updated" value={formatDate(selectedPodcast.releaseDate)} />
                    <Meta label="Explicit" value={selectedPodcast.collectionExplicitness} />
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-200"
                      onClick={() => addToQueue(selectedPodcast)}
                    >
                      Add to queue
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-white/25"
                      onClick={() => toggleCompare(selectedPodcast.collectionId)}
                    >
                      {compareIds.includes(selectedPodcast.collectionId) ? 'Remove from compare' : 'Add to compare'}
                    </button>
                    {selectedPodcast.feedUrl ? (
                      <a
                        className="rounded-full border border-emerald-300/40 px-4 py-2 text-sm text-emerald-100 transition hover:border-emerald-200"
                        href={selectedPodcast.feedUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open feed
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Select a podcast to inspect it.</p>
              )}
            </section>

            <section className="animate-rise rounded-[2rem] border border-white/10 bg-slate-950/55 p-5 shadow-glow backdrop-blur [animation-delay:400ms]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-2xl text-white">Comparison Deck</h2>
                  <p className="text-sm text-slate-400">Up to three shows side-by-side.</p>
                </div>
                <p className="text-sm text-slate-400">{compareItems.length}/3 selected</p>
              </div>

              {compareItems.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-3">
                    {compareItems.map((item) => (
                      <div key={item.collectionId} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={item.artworkUrl100}
                            alt={item.collectionName}
                            className="h-16 w-16 rounded-2xl object-cover"
                          />
                          <div className="min-w-0">
                            <h3 className="truncate font-display text-lg text-white">{item.collectionName}</h3>
                            <p className="truncate text-sm text-slate-300">{item.artistName}</p>
                          </div>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                          <Meta label="Country" value={item.country} />
                          <Meta label="Genre" value={item.primaryGenreName ?? 'Podcast'} />
                          <Meta label="Episodes" value={String(item.trackCount ?? 0)} />
                          <Meta label="Updated" value={formatDate(item.releaseDate)} />
                        </dl>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-slate-200">
                    <p>Total episodes across compared podcasts: {totalEpisodes}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Add podcasts from search results to compare them here.</p>
              )}
            </section>

            <section className="animate-rise rounded-[2rem] border border-white/10 bg-slate-950/55 p-5 shadow-glow backdrop-blur [animation-delay:500ms]">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-display text-2xl text-white">Listening Queue</h2>
                  <p className="text-sm text-slate-400">Persistent planner with JSON import and export.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-white/25"
                    onClick={triggerImport}
                  >
                    Import JSON
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-200"
                    onClick={exportQueue}
                  >
                    Export JSON
                  </button>
                  <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={importQueue} />
                </div>
              </div>

              {importMessage ? <p className="mb-3 text-sm text-cyan-200">{importMessage}</p> : null}

              <div className="space-y-4">
                {queue.length > 0 ? (
                  queue.map((item) => (
                    <div key={item.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row">
                        <div className="flex min-w-0 flex-1 gap-3">
                          <img src={item.artworkUrl} alt={item.podcastName} className="h-16 w-16 rounded-2xl object-cover" />
                          <div className="min-w-0">
                            <h3 className="truncate font-display text-lg text-white">{item.podcastName}</h3>
                            <p className="truncate text-sm text-slate-300">{item.podcastAuthor}</p>
                            <p className="mt-1 text-xs text-slate-500">Added {formatDate(item.addedAt)}</p>
                          </div>
                        </div>

                        <div className="grid flex-[1.3] gap-3 md:grid-cols-3">
                          <Field label="Priority">
                            <input
                              type="number"
                              min={1}
                              className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
                              value={item.priority}
                              onChange={(event) =>
                                updateQueueItem(item.id, { priority: Number(event.target.value) || 1 })
                              }
                            />
                          </Field>
                          <Field label="Target date">
                            <input
                              type="date"
                              className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
                              value={item.targetDate}
                              onChange={(event) => updateQueueItem(item.id, { targetDate: event.target.value })}
                            />
                          </Field>
                          <Field label="Status">
                            <select
                              className="w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
                              value={item.status}
                              onChange={(event) => updateQueueItem(item.id, { status: event.target.value as QueueStatus })}
                            >
                              {statuses.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-col gap-3 md:flex-row">
                        <Field label="Notes" className="flex-1">
                          <textarea
                            className="min-h-24 w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
                            value={item.notes}
                            onChange={(event) => updateQueueItem(item.id, { notes: event.target.value })}
                            placeholder="What makes this worth queuing?"
                          />
                        </Field>
                        <div className="flex items-end">
                          <button
                            type="button"
                            className="rounded-full border border-rose-300/40 px-4 py-2 text-sm text-rose-100 transition hover:border-rose-200"
                            onClick={() => removeQueueItem(item.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">Queue podcasts from the search results or inspector to start planning.</p>
                )}
              </div>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}

function Field({
  children,
  label,
  className = '',
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-2 font-display text-2xl text-white">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-white/10 px-3 py-1">{children}</span>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
      <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</dt>
      <dd className="mt-2 text-sm text-slate-100">{value}</dd>
    </div>
  );
}

export default App;
