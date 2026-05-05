"use client";
/**
 * IndexedDB-backed pipeline state for Step 2 extraction.
 *
 * Survives tab closes, Vercel cold starts, and provider rate-limit interruptions.
 * All state lives in the browser — nothing touches the server filesystem.
 *
 * DB: dcf-pipeline-v1
 *   manifests — one record per extraction session  { sessionId (PK) }
 *   chunks    — one record per completed chunk     { storageKey (PK), sessionId (index) }
 */

// =============================================================================
// Types
// =============================================================================

export type ChunkStatus = "pending" | "processing" | "completed" | "failed";
export type ManifestStatus = "running" | "paused" | "completed" | "failed";

export interface ManifestChunk {
  /** `${fileIndex}__${chunkIndex}` */
  chunkKey: string;
  fileIndex: number;
  chunkIndex: number;
  totalChunks: number;
  fileName: string;
  status: ChunkStatus;
}

export interface ManifestFile {
  fileIndex: number;
  fileName: string;
  fileSize: number;
  totalChunks: number;
}

export interface PipelineManifest {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  provider: "claude" | "gemini";
  targetYears: number[];
  companyName: string;
  files: ManifestFile[];
  chunks: ManifestChunk[];
  status: ManifestStatus;
  totalChunks: number;
  completedChunks: number;
}

// =============================================================================
// DB bootstrap
// =============================================================================

const DB_NAME = "dcf-pipeline-v1";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("manifests")) {
        db.createObjectStore("manifests", { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const store = db.createObjectStore("chunks", { keyPath: "storageKey" });
        store.createIndex("bySession", "sessionId", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// =============================================================================
// Low-level IDB helpers
// =============================================================================

function idbGet<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((res, rej) => {
    const r = store.get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}

function idbPut(store: IDBObjectStore, value: unknown): Promise<void> {
  return new Promise((res, rej) => {
    const r = store.put(value);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

function idbDelete(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return new Promise((res, rej) => {
    const r = store.delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

function idbGetAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((res, rej) => {
    const r = store.getAll();
    r.onsuccess = () => res(r.result as T[]);
    r.onerror = () => rej(r.error);
  });
}

function idbIndexGetAll<T>(
  store: IDBObjectStore,
  indexName: string,
  key: IDBValidKey,
): Promise<T[]> {
  return new Promise((res, rej) => {
    const r = store.index(indexName).getAll(key);
    r.onsuccess = () => res(r.result as T[]);
    r.onerror = () => rej(r.error);
  });
}

// =============================================================================
// Public API
// =============================================================================

/** Create or overwrite a manifest. */
export async function saveManifest(manifest: PipelineManifest): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("manifests", "readwrite");
  await idbPut(tx.objectStore("manifests"), manifest);
  db.close();
}

/** Partial update — merges with existing manifest. Returns updated record. */
export async function updateManifest(
  sessionId: string,
  updates: Partial<Omit<PipelineManifest, "sessionId" | "createdAt">>,
): Promise<PipelineManifest | undefined> {
  const db = await openDB();
  const tx = db.transaction("manifests", "readwrite");
  const store = tx.objectStore("manifests");
  const existing = await idbGet<PipelineManifest>(store, sessionId);
  if (!existing) {
    db.close();
    return undefined;
  }
  const updated: PipelineManifest = { ...existing, ...updates, updatedAt: Date.now() };
  await idbPut(store, updated);
  db.close();
  return updated;
}

/**
 * Atomically update a single chunk's status inside the manifest.
 * Safe under concurrent access: reads the latest manifest from IDB rather than
 * relying on the caller's (potentially stale) in-memory copy.
 * Pass incrementCompleted=true when marking a chunk completed.
 */
export async function updateChunkStatus(
  sessionId: string,
  chunkKey: string,
  status: ChunkStatus,
  incrementCompleted = false,
): Promise<PipelineManifest | undefined> {
  const db = await openDB();
  const tx = db.transaction("manifests", "readwrite");
  const store = tx.objectStore("manifests");
  const existing = await idbGet<PipelineManifest>(store, sessionId);
  if (!existing) {
    db.close();
    return undefined;
  }
  const updated: PipelineManifest = {
    ...existing,
    chunks: existing.chunks.map((c) =>
      c.chunkKey === chunkKey ? { ...c, status } : c,
    ),
    completedChunks: incrementCompleted
      ? existing.completedChunks + 1
      : existing.completedChunks,
    updatedAt: Date.now(),
  };
  await idbPut(store, updated);
  db.close();
  return updated;
}

export async function getManifest(sessionId: string): Promise<PipelineManifest | undefined> {
  const db = await openDB();
  const tx = db.transaction("manifests", "readonly");
  const result = await idbGet<PipelineManifest>(tx.objectStore("manifests"), sessionId);
  db.close();
  return result;
}

/** Returns all sessions that are still in-progress (status running | paused). */
export async function getIncompleteManifests(): Promise<PipelineManifest[]> {
  const db = await openDB();
  const tx = db.transaction("manifests", "readonly");
  const all = await idbGetAll<PipelineManifest>(tx.objectStore("manifests"));
  db.close();
  return all.filter((m) => m.status === "running" || m.status === "paused");
}

/** Persist a single chunk's extraction result. */
export async function saveChunkResult(
  sessionId: string,
  chunkKey: string,
  result: unknown,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("chunks", "readwrite");
  await idbPut(tx.objectStore("chunks"), {
    storageKey: `${sessionId}::${chunkKey}`,
    sessionId,
    chunkKey,
    result,
    savedAt: Date.now(),
  });
  db.close();
}

/** Load a single chunk's previously saved result. */
export async function getChunkResult<T>(
  sessionId: string,
  chunkKey: string,
): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction("chunks", "readonly");
  const record = await idbGet<{ result: T }>(
    tx.objectStore("chunks"),
    `${sessionId}::${chunkKey}`,
  );
  db.close();
  return record?.result;
}

/** Load all chunk results for a session (used in Reduce phase on resume). */
export async function getSessionChunkResults<T>(
  sessionId: string,
): Promise<Array<{ chunkKey: string; result: T }>> {
  const db = await openDB();
  const tx = db.transaction("chunks", "readonly");
  const records = await idbIndexGetAll<{ chunkKey: string; result: T }>(
    tx.objectStore("chunks"),
    "bySession",
    sessionId,
  );
  db.close();
  return records;
}

/** Delete a session's manifest and all its chunk results. */
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["manifests", "chunks"], "readwrite");
  await idbDelete(tx.objectStore("manifests"), sessionId);
  const records = await idbIndexGetAll<{ storageKey: string }>(
    tx.objectStore("chunks"),
    "bySession",
    sessionId,
  );
  for (const rec of records) {
    await idbDelete(tx.objectStore("chunks"), rec.storageKey);
  }
  db.close();
}

/** Wipe every manifest and chunk — used by the "Clear Cache" button. */
export async function clearAllSessions(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(["manifests", "chunks"], "readwrite");
  tx.objectStore("manifests").clear();
  tx.objectStore("chunks").clear();
  db.close();
}
