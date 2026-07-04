export class DefaultAzureCredential {
  constructor() {
    throw new Error(
      '@azure/identity is not included in this build. To use Foundry with Azure AD auth, install the full @anthropic-ai/claude-code package.'
    )
  }
}
export function getBearerTokenProvider() {
  throw new Error(
    '@azure/identity is not included in this build. To use Foundry with Azure AD auth, install the full @anthropic-ai/claude-code package.'
  )
}
