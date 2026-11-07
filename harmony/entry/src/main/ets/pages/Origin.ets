import { url } from '@kit.ArkTS';

export function httpsOrigin(input: string, rootOnly: boolean = false): string {
  try {
    const parsed = url.URL.parseURL(input);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return '';
    if (rootOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

interface BridgeOrigin { scheme: string; host: string; port: string; path: string; }
interface BridgePermission { urlPermissionList: BridgeOrigin[]; }
interface PermissionEnvelope { javascriptProxyPermission: BridgePermission; }

export function bridgePermission(origin: string): string {
  const parsed = url.URL.parseURL(origin);
  const item: BridgeOrigin = { scheme: 'https', host: parsed.hostname, port: parsed.port, path: '' };
  const envelope: PermissionEnvelope = { javascriptProxyPermission: { urlPermissionList: [item] } };
  return JSON.stringify(envelope);
}
