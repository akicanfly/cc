import { writeToStdout } from 'src/utils/process.js'

export async function update(): Promise<void> {
  writeToStdout(
    'Automatic updates are disabled in this OpenAI-compatible build. Install a release from this repository instead.\n',
  )
}
