export class BedrockClient {
  constructor(config?: Record<string, unknown>)
  send(command: unknown): Promise<unknown>
}
export class ListInferenceProfilesCommand {
  constructor(input: Record<string, unknown>)
}
export class GetInferenceProfileCommand {
  constructor(input: Record<string, unknown>)
}
