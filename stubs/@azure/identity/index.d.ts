export class DefaultAzureCredential {
  constructor()
}
export function getBearerTokenProvider(
  credential: unknown,
  scopes: string[]
): () => Promise<string>
