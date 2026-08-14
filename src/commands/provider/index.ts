import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'provider',
  aliases: ['openai-provider'],
  description: 'Configure the OpenAI-compatible provider and API key',
  immediate: true,
  isSensitive: true,
  load: () => import('./provider.js'),
} satisfies Command
