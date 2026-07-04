export async function defaultProvider() {
  throw new Error(
    '@aws-sdk/credential-provider-node is not included in this build. To use Bedrock with a proxy, install the full @anthropic-ai/claude-code package.'
  )
}
