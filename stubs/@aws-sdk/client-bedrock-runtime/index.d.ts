export class BedrockRuntimeClient {
  constructor(config?: Record<string, unknown>)
  send(command: unknown): Promise<unknown>
}
export class CountTokensCommand {
  constructor(input: { messages: unknown[]; anthropicVersion: string })
}
