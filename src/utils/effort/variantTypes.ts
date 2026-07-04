export const VARIANT_IDS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type VariantID = (typeof VARIANT_IDS)[number]

export type VariantBlob = Record<string, unknown>

export type VariantTable = Partial<Record<VariantID, VariantBlob>>

export function isVariantID(value: string): value is VariantID {
  return (VARIANT_IDS as readonly string[]).includes(value)
}
