export type CachedMCState = { cacheEdits: CacheEditsBlock[]; pinnedCacheEdits: PinnedCacheEdits[] };
export type CacheEditsBlock = { type: string; content: any };
export type PinnedCacheEdits = { type: string; content: any };
export const createCachedMCState = (): CachedMCState => ({ cacheEdits: [], pinnedCacheEdits: [] });
export const cachedMicrocompact = async (...args: any[]) => null;
