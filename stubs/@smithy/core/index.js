export class NoAuthSigner {
  constructor() {
    throw new Error(
      '@smithy/core is not included in this build. To use Bedrock with skip-auth, install the full @anthropic-ai/claude-code package.'
    )
  }
}
