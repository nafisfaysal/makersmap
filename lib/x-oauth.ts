import { readEnv } from "@/db";
import { fullSizeAvatar, type XUser } from "./x-api";

// X OAuth 2.0 with PKCE. Scopes: who is signing in, plus (opt-in) their confirmed email.
// users.email only works once "Request email from users" is on in the X developer console,
// which needs a privacy policy and terms URL. Asking for it before that makes X refuse the
// whole sign-in ("You weren't able to give access to the App"), so it is off unless
// X_REQUEST_EMAIL=true.
const BASE_SCOPES = "tweet.read users.read";
const signInScopes = () => (readEnv("X_REQUEST_EMAIL") === "true" ? `${BASE_SCOPES} users.email` : BASE_SCOPES);
// The operator account also needs to write replies and keep a refresh token.
export const OPERATOR_SCOPES = "tweet.read tweet.write users.read offline.access";

export function oauthConfigured(): boolean {
  return Boolean(readEnv("X_CLIENT_ID") && readEnv("X_CLIENT_SECRET") && readEnv("SESSION_SECRET"));
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function authorizeUrl(params: { redirectUri: string; state: string; challenge: string; scopes?: string }): string {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", readEnv("X_CLIENT_ID") || "");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scopes || signInScopes());
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(params: { code: string; redirectUri: string; verifier: string }): Promise<string> {
  return (await exchangeCodeFull(params)).accessToken;
}

export async function exchangeCodeFull(params: { code: string; redirectUri: string; verifier: string }): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
  const id = readEnv("X_CLIENT_ID") || "", secret = readEnv("X_CLIENT_SECRET") || "";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
    client_id: id,
  });
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body,
  });
  const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `Token exchange failed (${response.status})`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in || 7200 };
}

export type Me = { id: string; username: string; name: string; avatarUrl?: string; email?: string; description?: string; location?: string; url?: string };
export async function whoAmI(accessToken: string): Promise<Me> {
  const response = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url,name,username,confirmed_email,description,location,url", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({})) as { data?: XUser & { confirmed_email?: string }; detail?: string };
  if (!response.ok || !data.data) throw new Error(data.detail || `Could not read the X account (${response.status})`);
  return { id: data.data.id, username: data.data.username, name: data.data.name, avatarUrl: fullSizeAvatar(data.data.profile_image_url), email: data.data.confirmed_email || undefined, description: data.data.description || undefined, location: data.data.location || undefined, url: data.data.url || undefined };
}
