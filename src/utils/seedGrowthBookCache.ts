/**
 * One-shot seeder for disk-cached GrowthBook features.
 *
 * STRIPPED BUILD CONTEXT:
 *   This fork has the GrowthBook network egress removed. Getters continue to
 *   read from `cachedGrowthBookFeatures` in ~/.claude.json so cached flag
 *   values survive across restarts. But if a user has never run an authed
 *   session that populated the cache (or wiped ~/.claude.json), every flag
 *   falls to its in-tree default — which would silently disable yolo/auto-mode
 *   (because `tengu_auto_mode_config.enabled` defaults to `'disabled'`).
 *
 *   This seeder writes a minimal seed object to `cachedGrowthBookFeatures`
 *   on first run so all flag-gated features work out-of-the-box, with zero
 *   network access ever.
 *
 * Idempotent: writes only if the cache is missing or doesn't contain the
 * crucial `tengu_auto_mode_config` key. Never overwrites user-set values
 * or `/config` Gate-tab overrides.
 */

import { getGlobalConfig, saveGlobalConfig } from './config.js'

const REQUIRED_SEED_FEATURES: Record<string, unknown> = {
  // Yolo / auto-mode: 'auto' = enabled with the transcript classifier.
  // Matches the production default that external users land on when they
  // toggle yolo via --auto-mode flag or the prompt-mode selector.
  tengu_auto_mode_config: {
    enabled: 'auto',
    disableFastMode: false,
  },
}

/**
 * Seed cachedGrowthBookFeatures with structural defaults if missing.
 * Safe to call on every startup — writes only when the cache is empty or
 * missing the required keys.
 */
export function seedGrowthBookCacheIfMissing(): void {
  try {
    const config = getGlobalConfig()
    const existing = config.cachedGrowthBookFeatures ?? {}

    let needsWrite = false
    const merged: Record<string, unknown> = { ...existing }
    for (const [key, value] of Object.entries(REQUIRED_SEED_FEATURES)) {
      if (merged[key] === undefined) {
        merged[key] = value
        needsWrite = true
      }
    }

    if (!needsWrite) return

    saveGlobalConfig(current => ({
      ...current,
      cachedGrowthBookFeatures: {
        ...(current.cachedGrowthBookFeatures ?? {}),
        ...REQUIRED_SEED_FEATURES,
      },
    }))
  } catch {
    // getGlobalConfig can throw very early in startup before configReadingAllowed
    // is set. Seed is best-effort; getters will still fall to defaults if the
    // seed couldn't be written. The next run will retry and succeed.
  }
}
