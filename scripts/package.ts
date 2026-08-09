import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import packageMetadata from '../package.json' with { type: 'json' }

const repositoryRoot = resolve(import.meta.dir, '..')
const bundlePath = join(repositoryRoot, 'dist', 'cli.js')
const packageOutputDirectory = join(repositoryRoot, 'dist', 'package')
const stagingDirectory = join(packageOutputDirectory, 'staging')
const releaseVersion = process.env.CC_BUILD_VERSION ?? packageMetadata.version

if (!existsSync(bundlePath)) {
  console.error('error: dist/cli.js does not exist; run `bun run build` first.')
  process.exit(1)
}

rmSync(packageOutputDirectory, { recursive: true, force: true })
mkdirSync(join(stagingDirectory, 'dist'), { recursive: true })
copyFileSync(bundlePath, join(stagingDirectory, 'dist', 'cli.js'))
copyFileSync(join(repositoryRoot, 'README.md'), join(stagingDirectory, 'README.md'))

const releaseManifest = {
  name: packageMetadata.name,
  version: releaseVersion,
  description: packageMetadata.description,
  type: packageMetadata.type,
  bin: packageMetadata.bin,
  repository: packageMetadata.repository,
  bugs: packageMetadata.bugs,
  homepage: packageMetadata.homepage,
  engines: packageMetadata.engines,
}

writeFileSync(
  join(stagingDirectory, 'package.json'),
  `${JSON.stringify(releaseManifest, null, 2)}\n`,
)

const pack = Bun.spawn([
  'bun',
  'pm',
  'pack',
  '--ignore-scripts',
  '--filename',
  join(packageOutputDirectory, 'ccc.tgz'),
], {
  cwd: stagingDirectory,
  stdout: 'inherit',
  stderr: 'inherit',
})

const exitCode = await pack.exited
rmSync(stagingDirectory, { recursive: true, force: true })
process.exit(exitCode)
