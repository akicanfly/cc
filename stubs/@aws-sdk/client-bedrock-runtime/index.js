export class BedrockRuntimeClient {
  constructor(config) {
    throw new Error(
      '@aws-sdk/client-bedrock-runtime is not included in this build. To use Bedrock, install the full @anthropic-ai/claude-code package.'
    )
  }
}
export class CountTokensCommand {
  constructor(input) { this.input = input }
}
