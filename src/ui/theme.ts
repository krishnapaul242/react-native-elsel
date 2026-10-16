import { Platform } from 'react-native';

export const colors = {
  accent: '#4F8CFF',
  accentFill: 'rgba(79, 140, 255, 0.16)',
  panel: '#12141A',
  panelBorder: '#262A35',
  surface: '#1C1F28',
  text: '#E7E9EF',
  muted: '#8A90A2',
  component: '#7DD3FC',
  library: '#6B7183',
  string: '#A5D6A7',
  number: '#F5C27A',
  danger: '#FF7A7A',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });
