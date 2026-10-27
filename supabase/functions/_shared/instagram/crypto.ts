// Instagram Agent — proteção de tokens e do "state" do login.
// Tokens da Meta são guardados cifrados (AES-256-GCM). A chave fica só no secret
// INSTAGRAM_TOKEN_KEY (32 bytes em base64; gere com `openssl rand -base64 32`).
// O state do OAuth é assinado (HMAC-SHA256 com META_APP_SECRET) e expira em 15 min.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

async function aesKey(raw: string | undefined): Promise<CryptoKey> {
  if (!raw) throw new Error('INSTAGRAM_TOKEN_KEY não configurada.');
  let bytes: Uint8Array;
  try {
    bytes = unb64(raw.trim());
  } catch {
    throw new Error('INSTAGRAM_TOKEN_KEY inválida (use `openssl rand -base64 32`).');
  }
  if (bytes.length !== 32) throw new Error('INSTAGRAM_TOKEN_KEY precisa ter 32 bytes (use `openssl rand -base64 32`).');
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Cifra o token: "v1.<iv>.<dados>" em base64. */
export async function sealToken(token: string, rawKey = Deno.env.get('INSTAGRAM_TOKEN_KEY')): Promise<string> {
  const key = await aesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function openToken(sealed: string, rawKey = Deno.env.get('INSTAGRAM_TOKEN_KEY')): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Token guardado em formato desconhecido.');
  const key = await aesKey(rawKey);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, key, unb64(ct) as BufferSource);
  return dec.decode(pt);
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export interface OAuthState {
  owner: string;
  user: string;
  exp: number;
}

export async function signState(s: Omit<OAuthState, 'exp'>, secret: string, now = Date.now()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...s, exp: now + 15 * 60_000, n: b64url(crypto.getRandomValues(new Uint8Array(9))) })));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

/** Devolve o state se a assinatura confere e não expirou; senão null. */
export async function verifyState(state: string, secret: string, now = Date.now()): Promise<OAuthState | null> {
  const [body, sig] = String(state ?? '').split('.');
  if (!body || !sig) return null;
  try {
    if (!sameBytes(unb64url(sig), await hmac(secret, body))) return null;
    const s = JSON.parse(dec.decode(unb64url(body))) as OAuthState;
    if (typeof s.owner !== 'string' || typeof s.user !== 'string' || typeof s.exp !== 'number' || s.exp < now) return null;
    return s;
  } catch {
    return null;
  }
}
