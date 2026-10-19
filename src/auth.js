// Valida o JWT do Cloudflare Access (header Cf-Access-Jwt-Assertion).
// Sem Access configurado, a API recusa tudo, exceto com ALLOW_UNAUTHENTICATED=true (só para dev local).

const b64urlToBytes = s => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};
const decodeJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

let certsCache = { at: 0, keys: [] };

async function accessKeys(team) {
  if (Date.now() - certsCache.at < 10 * 60 * 1000 && certsCache.keys.length) return certsCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("Não consegui buscar as chaves do Cloudflare Access.");
  const { keys } = await res.json();
  certsCache = { at: Date.now(), keys };
  return keys;
}

export async function isAuthorized(request, env) {
  if (env.ALLOW_UNAUTHENTICATED === "true") return true;
  const team = env.ACCESS_TEAM_DOMAIN, aud = env.ACCESS_AUD;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!team || !aud || !token) return false;
  try {
    const [h, p, s] = token.split(".");
    const header = decodeJson(h), payload = decodeJson(p);
    const now = Math.floor(Date.now() / 1000);
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
    if (!audOk || payload.iss !== `https://${team}` || !(payload.exp > now)) return false;
    if (env.OWNER_EMAIL && payload.email?.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) return false;
    const jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return false;
  }
}
