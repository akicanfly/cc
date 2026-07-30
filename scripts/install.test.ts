import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(path =>
      rm(path, { recursive: true, force: true }),
    ),
  )
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'cc-install-test-'))
  temporaryDirectories.push(path)
  return path
}

async function runInstaller(args: string[]) {
  const process = Bun.spawn(['bun', 'scripts/install.ts', ...args], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...globalThis.process.env },
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

describe('custom standalone installer', () => {
  test('installs platform-suffixed release assets under the cc command name', async () => {
    const root = await temporaryDirectory()
    const source = join(root, 'cc-linux-x64')
    const target = join(root, 'bin')
    await writeFile(source, `#!/bin/sh\n${'#'.repeat(2048)}\n`)
    await chmod(source, 0o755)

    const result = await runInstaller([
      '--outfile',
      source,
      '--target',
      target,
      '--dry-run',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Would install to: ${join(target, 'cc')}`)
  })

  test('rejects a suspiciously small source binary', async () => {
    const root = await temporaryDirectory()
    const source = join(root, 'cc')
    await writeFile(source, '#!/bin/sh\n')
    await chmod(source, 0o755)

    const result = await runInstaller([
      '--outfile',
      source,
      '--target',
      join(root, 'bin'),
      '--dry-run',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('suspiciously small')
  })
})
