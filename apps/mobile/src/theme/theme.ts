import tokens from '../../../../design/tokens.json';
import type { TextStyle } from 'react-native';

export const theme = tokens;
export function typography(name: keyof typeof tokens.type): TextStyle {
  const [fontSize, lineHeight, weight] = tokens.type[name];
  return { fontSize, lineHeight, fontWeight: String(weight) as TextStyle['fontWeight'], color: tokens.colors.textPrimary };
}
