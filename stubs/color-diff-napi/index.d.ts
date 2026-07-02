export class ColorDiff {}
export class ColorFile {}
export interface SyntaxTheme {
  name: string;
}
export function getSyntaxTheme(themeName: string): SyntaxTheme | null;
