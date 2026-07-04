export class GoogleAuth {
  constructor(opts?: {
    scopes?: string | string[]
    projectId?: string
    keyFilename?: string
  })
  getAccessToken(): Promise<{ token: string; res?: unknown }>
  getClient(): Promise<unknown>
}
