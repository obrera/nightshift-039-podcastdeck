export type Podcast = {
  artistName: string;
  artworkUrl100: string;
  artworkUrl600?: string;
  collectionCensoredName?: string;
  collectionExplicitness: string;
  collectionId: number;
  collectionName: string;
  country: string;
  feedUrl?: string;
  genres?: string[];
  primaryGenreName?: string;
  releaseDate: string;
  trackCount?: number;
};

export type SearchState = {
  query: string;
  country: string;
  limit: number;
};

export type QueueStatus = 'planned' | 'queued' | 'listening' | 'completed';

export type QueueItem = {
  id: string;
  podcastId: number;
  podcastName: string;
  podcastAuthor: string;
  artworkUrl: string;
  priority: number;
  targetDate: string;
  notes: string;
  status: QueueStatus;
  addedAt: string;
};

export type QueuePayload = {
  exportedAt: string;
  items: QueueItem[];
};
