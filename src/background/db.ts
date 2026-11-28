import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Trace } from '../core/trace/tracer';
import type { CaptionLine, Segment, VideoDigest } from '../core/types';
import type { ChatTurnRecord, JobState, VideoRecord } from '../shared/protocol';

export interface JobRecord extends JobState {
  /** Checkpoint: segments finished so far, in order from line 0. An interrupted run continues after the last one. */
  partial: Segment[];
}

interface Schema extends DBSchema {
  videos: { key: string; value: VideoRecord; indexes: { byAdded: number } };
  captions: { key: string; value: { videoId: string; lines: CaptionLine[] } };
  segments: { key: string; value: { videoId: string; segments: Segment[] } };
  digests: { key: string; value: { videoId: string; digest: VideoDigest } };
  jobs: { key: string; value: JobRecord };
  vectors: { key: string; value: { key: string; videoId: string; model: string; passageId: string; vector: number[] }; indexes: { byVideo: string } };
  traces: { key: string; value: Trace; indexes: { byVideo: string; byStart: number } };
  chats: { key: string; value: { videoId: string; turns: ChatTurnRecord[] } };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('bilibilidry', 2, {
    upgrade(d, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        d.createObjectStore('videos', { keyPath: 'videoId' }).createIndex('byAdded', 'addedAt');
        d.createObjectStore('captions', { keyPath: 'videoId' });
        d.createObjectStore('segments', { keyPath: 'videoId' });
        d.createObjectStore('digests', { keyPath: 'videoId' });
        d.createObjectStore('jobs', { keyPath: 'videoId' });
        d.createObjectStore('vectors', { keyPath: 'key' }).createIndex('byVideo', 'videoId');
        const t = d.createObjectStore('traces', { keyPath: 'id' });
        t.createIndex('byVideo', 'videoId');
        t.createIndex('byStart', 'startedAt');
        d.createObjectStore('chats', { keyPath: 'videoId' });
      }
      if (oldVersion === 1) {
        // Version 1 kept per-chunk checkpoints and transcripts from an unverified subtitle source.
        void tx.objectStore('jobs').clear();
        void tx.objectStore('captions').clear();
      }
    }
  });
  return dbPromise;
}

export async function getVideo(videoId: string) {
  return (await db()).get('videos', videoId);
}
export async function putVideo(v: VideoRecord) {
  await (await db()).put('videos', v);
}
export async function listVideos(): Promise<VideoRecord[]> {
  return (await (await db()).getAll('videos')).sort((a, b) => (b.analyzedAt ?? b.addedAt) - (a.analyzedAt ?? a.addedAt));
}
export async function getCaptions(videoId: string) {
  return (await (await db()).get('captions', videoId))?.lines ?? null;
}
export async function putCaptions(videoId: string, lines: CaptionLine[]) {
  await (await db()).put('captions', { videoId, lines });
}
export async function getSegments(videoId: string) {
  return (await (await db()).get('segments', videoId))?.segments ?? [];
}
export async function putSegments(videoId: string, segments: Segment[]) {
  await (await db()).put('segments', { videoId, segments });
}
export async function getDigest(videoId: string) {
  return (await (await db()).get('digests', videoId))?.digest ?? null;
}
export async function putDigest(videoId: string, digest: VideoDigest) {
  await (await db()).put('digests', { videoId, digest });
}
export async function getJob(videoId: string) {
  return (await db()).get('jobs', videoId);
}
export async function putJob(job: JobRecord) {
  await (await db()).put('jobs', job);
}
export async function listJobs() {
  return (await db()).getAll('jobs');
}

export async function getVectors(videoIds: string[] | null, model: string): Promise<Map<string, number[]>> {
  const d = await db();
  const rows = videoIds
    ? (await Promise.all(videoIds.map((id) => d.getAllFromIndex('vectors', 'byVideo', id)))).flat()
    : await d.getAll('vectors');
  return new Map(rows.filter((r) => r.model === model).map((r) => [r.passageId, r.vector]));
}
export async function putVectors(videoId: string, model: string, rows: Array<{ id: string; vector: number[] }>) {
  const tx = (await db()).transaction('vectors', 'readwrite');
  await Promise.all(rows.map((r) => tx.store.put({ key: `${model}|${r.id}`, videoId, model, passageId: r.id, vector: r.vector })));
  await tx.done;
}

const MAX_TRACES = 300;
export async function putTrace(t: Trace) {
  const d = await db();
  await d.put('traces', JSON.parse(JSON.stringify(t)) as Trace);
  const count = await d.count('traces');
  if (count > MAX_TRACES) {
    const tx = d.transaction('traces', 'readwrite');
    let cursor = await tx.store.index('byStart').openCursor();
    let extra = count - MAX_TRACES;
    while (cursor && extra > 0) {
      await cursor.delete();
      extra -= 1;
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
export async function listTraces(videoId?: string, limit = 50): Promise<Trace[]> {
  const d = await db();
  const all = videoId ? await d.getAllFromIndex('traces', 'byVideo', videoId) : await d.getAll('traces');
  return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

/** Chat threads are keyed by videoId, or 'library' for the cross-video thread. */
export async function getChat(key: string): Promise<ChatTurnRecord[]> {
  return (await (await db()).get('chats', key))?.turns ?? [];
}
export async function putChat(key: string, turns: ChatTurnRecord[]) {
  await (await db()).put('chats', { videoId: key, turns: turns.slice(-60) });
}

export async function deleteVideo(videoId: string) {
  const d = await db();
  const tx = d.transaction(['videos', 'captions', 'segments', 'digests', 'jobs', 'chats', 'vectors', 'traces'], 'readwrite');
  await Promise.all([
    tx.objectStore('videos').delete(videoId),
    tx.objectStore('captions').delete(videoId),
    tx.objectStore('segments').delete(videoId),
    tx.objectStore('digests').delete(videoId),
    tx.objectStore('jobs').delete(videoId),
    tx.objectStore('chats').delete(videoId)
  ]);
  for (const store of ['vectors', 'traces'] as const) {
    let c = await tx.objectStore(store).index('byVideo').openCursor(videoId);
    while (c) {
      await c.delete();
      c = await c.continue();
    }
  }
  await tx.done;
}

export async function clearAll() {
  const d = await db();
  await Promise.all((['videos', 'captions', 'segments', 'digests', 'jobs', 'vectors', 'traces', 'chats'] as const).map((s) => d.clear(s)));
}

export async function stats() {
  const d = await db();
  return {
    videos: await d.count('videos'),
    vectors: await d.count('vectors'),
    traces: await d.count('traces'),
    chats: await d.count('chats')
  };
}
