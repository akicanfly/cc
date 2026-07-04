export class BedrockClient {
  constructor(config) {
    throw new Error(
      '@aws-sdk/client-bedrock is not included in this build. To use Bedrock, install the full @anthropic-ai/claude-code package.'
    )
  }
}
export class ListInferenceProfilesCommand {
  constructor(input) { this.input = input }
}
export class GetInferenceProfileCommand {
  constructor(input) { this.input = input }
}
