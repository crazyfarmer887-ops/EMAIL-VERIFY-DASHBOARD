import { readFileSync } from 'node:fs';

export const DEFAULT_GMAIL_CLIENT_SECRET_PATH = '/home/ubuntu/.config/gws/client_secret.json';

type GmailClientSecretEnvironment = Readonly<Record<string, string | undefined>>;

interface GmailInstalledCredentials {
  client_id: string;
  client_secret: string;
}

export function resolveGmailClientSecretPath(
  env: GmailClientSecretEnvironment = process.env,
): string {
  return env.GMAIL_CLIENT_SECRET_PATH?.trim() || DEFAULT_GMAIL_CLIENT_SECRET_PATH;
}

export function loadGmailClientSecret(path = resolveGmailClientSecretPath()): GmailInstalledCredentials {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    throw new Error('Gmail OAuth client secret 파일을 읽을 수 없습니다. GMAIL_CLIENT_SECRET_PATH와 서비스 사용자 권한을 확인하세요.');
  }

  try {
    const installed = (JSON.parse(contents) as { installed?: Partial<GmailInstalledCredentials> }).installed;
    if (!installed?.client_id || !installed.client_secret) throw new Error('invalid credentials');
    return { client_id: installed.client_id, client_secret: installed.client_secret };
  } catch {
    throw new Error('Gmail OAuth client secret 파일 형식이 올바르지 않습니다.');
  }
}
