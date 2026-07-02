export type McpbUserConfigurationOption = {
  type: 'string' | 'number' | 'boolean' | 'file' | 'directory'
  title?: string
  description?: string
  required?: boolean
  sensitive?: boolean
  default?: string | number | boolean | string[]
  min?: number
  max?: number
  multiple?: boolean
}

export type McpbManifest = {
  name: string
  version?: string
  author: { name: string }
  description?: string
  server?: Record<string, unknown>
  user_config?: Record<string, McpbUserConfigurationOption>
  [key: string]: unknown
}

export const McpbManifestSchema: {
  safeParse(value: unknown):
    | { success: true; data: McpbManifest }
    | {
        success: false
        error: { flatten(): { fieldErrors: Record<string, string[]>; formErrors: string[] } }
      }
}

export function getMcpConfigForManifest(args: {
  manifest: McpbManifest
  extensionPath: string
  systemDirs?: Record<string, string>
  userConfig?: Record<string, string | number | boolean | string[]>
  pathSeparator?: string
}): Promise<unknown | null>
