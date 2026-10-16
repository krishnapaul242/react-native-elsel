export type SourceLocation = {
  /** Absolute (or project-relative) path as reported by Metro. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** True when the file lives in node_modules. */
  isLibrary: boolean;
};

export type Frame = { x: number; y: number; width: number; height: number };

export type ChainEntry = {
  name: string;
  kind: 'composite' | 'host';
  source: SourceLocation | null;
};

export type SelectedElement = ChainEntry & {
  props: Record<string, unknown>;
  style: Record<string, unknown> | null;
  /** Position in window coordinates. */
  frame: Frame | null;
};

export type Selection = {
  element: SelectedElement;
  /** Component path from the app root down to the touched element. */
  chain: ChainEntry[];
  platform: string;
  window: { width: number; height: number };
  timestamp: string;
};
