import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ContentType } from '../../types';

export interface VideoRecord {
  videoId: string; // bvid
  aid: number;
  cid: number;
  title: string;
  durationSec: number;
  hasCC: boolean;
  lastAnalyzedAt?: string;
  analysisVersion?: string;
}

export interface SegmentRecord {
  id: string; // `${videoId}:${startTime}-${endTime}`
  videoId: string;
  startTime: number;
  endTime: number;
  type: ContentType;
  confidence: number;
  summary: string;
  rawText?: string;
  source: 'gemini' | 'openai' | 'heuristic';
}

export interface EmbeddingRecord {
  id: string; // same as segment id
  videoId: string;
  startTime: number;
  vector: number[];
  text: string;
  model: string;
}

interface BiliDrySchema extends DBSchema {
  videos: {
    key: string;
    value: VideoRecord;
    indexes: { 'by-lastAnalyzedAt': string };
  };
  segments: {
    key: string;
    value: SegmentRecord;
    indexes: { 'by-videoId': string; 'by-videoId-startTime': [string, number] };
  };
  embeddings: {
    key: string;
    value: EmbeddingRecord;
    indexes: { 'by-videoId': string };
  };
}

let dbPromise: Promise<IDBPDatabase<BiliDrySchema>> | undefined;

export function getDb(): Promise<IDBPDatabase<BiliDrySchema>> {
  if (!dbPromise) {
    dbPromise = openDB<BiliDrySchema>('bilibilidry', 1, {
      upgrade(db) {
        const videos = db.createObjectStore('videos', { keyPath: 'videoId' });
        videos.createIndex('by-lastAnalyzedAt', 'lastAnalyzedAt');

        const segments = db.createObjectStore('segments', { keyPath: 'id' });
        segments.createIndex('by-videoId', 'videoId');
        segments.createIndex('by-videoId-startTime', ['videoId', 'startTime']);

        const embeddings = db.createObjectStore('embeddings', { keyPath: 'id' });
        embeddings.createIndex('by-videoId', 'videoId');
      }
    });
  }
  return dbPromise;
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['videos', 'segments', 'embeddings'], 'readwrite');
  await Promise.all([tx.objectStore('videos').clear(), tx.objectStore('segments').clear(), tx.objectStore('embeddings').clear()]);
  await tx.done;
}

export async function upsertVideo(video: VideoRecord): Promise<void> {
  const db = await getDb();
  await db.put('videos', video);
}

export async function getVideo(videoId: string): Promise<VideoRecord | undefined> {
  const db = await getDb();
  return db.get('videos', videoId);
}

export async function listSegments(videoId: string): Promise<SegmentRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex('segments', 'by-videoId', videoId);
}

export async function putSegments(segments: SegmentRecord[]): Promise<void> {
  if (segments.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('segments', 'readwrite');
  for (const seg of segments) await tx.store.put(seg);
  await tx.done;
}

export async function getEmbedding(id: string): Promise<EmbeddingRecord | undefined> {
  const db = await getDb();
  return db.get('embeddings', id);
}

export async function putEmbedding(record: EmbeddingRecord): Promise<void> {
  const db = await getDb();
  await db.put('embeddings', record);
}

export async function listEmbeddings(videoId: string): Promise<EmbeddingRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex('embeddings', 'by-videoId', videoId);
}

export async function listAllEmbeddings(): Promise<EmbeddingRecord[]> {
  const db = await getDb();
  return db.getAll('embeddings');
}

export async function listAllSegments(): Promise<SegmentRecord[]> {
  const db = await getDb();
  return db.getAll('segments');
}

export async function listVideos(): Promise<VideoRecord[]> {
  const db = await getDb();
  return db.getAll('videos');
}
