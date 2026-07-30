import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import envPaths from 'env-paths'

const originalCacheHome = process.env.XDG_CACHE_HOME
const cacheRoot = await mkdtemp(join(tmpdir(), 'cc-models-cache-test-'))
process.env.XDG_CACHE_HOME = cacheRoot

const cacheDir = envPaths('cc').cache
await mkdir(cacheDir, { recursive: true })
await writeFile(
  join(cacheDir, 'models-dev-catalog.json'),
  JSON.stringify({
    timestamp: Date.now(),
    entries: [
      {
        id: 'provider/coder-large',
        providerId: 'provider',
        normalized: 'provider/coder-large',
        name: 'Coder Large',
        contextWindow: 131072,
        maxOutput: 8192,
        supportsImage: false,
        supportsToolCall: true,
        isReasoning: true,
        reasoningOptions: ['low', 'high'],
      },
      {
        id: 'shared/model',
        providerId: 'provider-a',
        normalized: 'shared/model',
        name: 'Shared A',
        contextWindow: 32000,
        maxOutput: 4096,
        supportsImage: false,
        supportsToolCall: true,
        isReasoning: false,
        reasoningOptions: [],
      },
      {
        id: 'shared/model',
        providerId: 'provider-b',
        normalized: 'shared/model',
        name: 'Shared B',
        contextWindow: 128000,
        maxOutput: 16384,
        supportsImage: true,
        supportsToolCall: true,
        isReasoning: true,
        reasoningOptions: ['high'],
      },
    ],
  }),
)

afterAll(async () => {
  if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = originalCacheHome
  await rm(cacheRoot, { recursive: true, force: true })
})

describe('models.dev catalog integration', () => {
  test('loads cached metadata and matches aggregator-suffixed model IDs', async () => {
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        `import envPaths from 'env-paths'; import { existsSync } from 'node:fs'; import { join } from 'node:path'; import { getModelDevEntry } from './src/utils/model/modelsDevCatalog.ts'; const cache = envPaths('cc').cache; const path = join(cache, 'models-dev-catalog.json'); console.log(JSON.stringify({ cache, exists: existsSync(path), entry: getModelDevEntry('provider/coder-large-[Openrouter]'), ambiguous: getModelDevEntry('shared/model') ?? null }));`,
      ],
      {
        cwd: join(import.meta.dir, '../../..'),
        env: { ...process.env, XDG_CACHE_HOME: cacheRoot },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    const diagnostic = JSON.parse(stdout) as {
      cache: string
      exists: boolean
      entry?: Record<string, unknown>
      ambiguous: Record<string, unknown> | null
    }
    expect(diagnostic.cache).toBe(cacheDir)
    expect(diagnostic.exists).toBe(true)
    const entry = diagnostic.entry
    expect(entry?.name).toBe('Coder Large')
    expect(entry?.contextWindow).toBe(131072)
    expect(entry?.maxOutput).toBe(8192)
    expect(entry?.supportsToolCall).toBe(true)
    expect(diagnostic.ambiguous).toBeNull()
  })
})
