// PR3-2 phase 1: SQLite schema placeholder.
//
// We will store:
// - files: workspace-relative path + content hash + mtime + metadata
// - chunks: per-file chunks with line ranges
// - meta: schema version + provider/model fingerprint (later)

export const MEMORY_INDEX_SCHEMA_VERSION = 1;
