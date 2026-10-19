// Login por senha. APP_PASSWORD e SESSION_SECRET são segredos do Worker (wrangler secret put).
// A sessão é um cookie assinado com HMAC; trocar a senha ou o SESSION_SECRET derruba todas as sessões.
import { getMeta, setMeta } from "./items.js";

const COOKIE = "md_session";
const MAX_AGE = 30 * 24 * 3600;
const LIMIT = 5, WINDOW = 15 * 60 * 1000;

const enc = s => new TextEncoder().encode(s);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha = async s => hex(await crypto.subtle.digest("SHA-256", enc(s)));

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sign(env, msg) {
  const key = await crypto.subtle.importKey("raw", enc(`${env.SESSION_SECRET}:${env.APP_PASSWORD}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc(msg)));
}

function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export const authConfigured = env => !!(env.APP_PASSWORD && env.SESSION_SECRET);

export async function isAuthorized(request, env) {
  if (env.ALLOW_UNAUTHENTICATED === "true") return true;
  if (!authConfigured(env)) return false;
  const [exp, sig] = (readCookie(request, COOKIE) || "").split(".");
  if (!exp || !sig || !(Number(exp) > Date.now() / 1000)) return false;
  return safeEqual(sig, await sign(env, exp));
}

/** Bloqueia requisições de outros sites (além do SameSite=Strict do cookie). */
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function login(request, env, db) {
  if (!authConfigured(env)) {
    return { status: 503, error: "A senha ainda não foi configurada. Rode: npx wrangler secret put APP_PASSWORD" };
  }
  const key = "login:" + (request.headers.get("cf-connecting-ip") || "local");
  const st = JSON.parse((await getMeta(db, key)) || '{"n":0,"at":0}');
  const inWindow = Date.now() - st.at < WINDOW;
  if (st.n >= LIMIT && inWindow) {
    const min = Math.ceil((WINDOW - (Date.now() - st.at)) / 60000);
    return { status: 429, error: `Muitas tentativas erradas. Tente de novo em ${min} min.` };
  }
  let password = "";
  try { ({ password = "" } = await request.json()); } catch {}
  if (!safeEqual(await sha(String(password)), await sha(env.APP_PASSWORD))) {
    const n = inWindow ? st.n + 1 : 1;
    await setMeta(db, key, JSON.stringify({ n, at: n === 1 ? Date.now() : st.at }));
    return { status: 401, error: n >= LIMIT ? "Senha incorreta. Login bloqueado por 15 min." : "Senha incorreta." };
  }
  await setMeta(db, key, '{"n":0,"at":0}');
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return { status: 200, cookie: `${COOKIE}=${exp}.${await sign(env, exp)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict` };
}

export const logoutCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
