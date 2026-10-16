import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

let override: string | null = null;
let cached: string | null = null;

export function setDevServerUrl(url: string | undefined) {
  override = url ? url.replace(/\/+$/, '') : null;
}

/** Origin of the Metro server that served the bundle, e.g. http://192.168.1.4:8081 */
export function devServerUrl(): string {
  if (override) return override;
  if (cached) return cached;
  let scriptURL: string | undefined;
  if (Platform.OS === 'web') {
    scriptURL = (globalThis as any).location?.href;
  } else {
    try {
      const mod: any = TurboModuleRegistry.get('SourceCode') ?? NativeModules.SourceCode;
      scriptURL = mod?.getConstants?.().scriptURL ?? mod?.scriptURL;
    } catch {}
  }
  const match = scriptURL?.match(/^https?:\/\/[^/?#]+/);
  cached = match ? match[0] : 'http://localhost:8081';
  return cached;
}

export async function postJson<T = any>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
  const res = await fetch(devServerUrl() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {}
  return { status: res.status, data };
}

export type ServerInfo = { ok: boolean; projectRoot?: string; version?: string };

let infoPromise: Promise<ServerInfo | null> | null = null;

/** Whether `withElementSelector` middleware is installed in metro.config.js. */
export function serverInfo(): Promise<ServerInfo | null> {
  if (!infoPromise) {
    infoPromise = fetch(devServerUrl() + '/__elsel/ping')
      .then((r) => (r.ok ? (r.json() as Promise<ServerInfo>) : null))
      .catch(() => null)
      .then((info) => {
        if (!info) infoPromise = null; // retry next time; metro may restart
        return info;
      });
  }
  return infoPromise;
}
