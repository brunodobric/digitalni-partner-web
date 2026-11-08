// Worker dashboarda Digitalnog partnera (dp-nadzor).
// - GET /            stranica dashboarda (samo uz prijavu kroz Cloudflare Access)
// - GET /api/podaci  svi brojevi za dashboard (Access)
// - POST /api/trosak, POST /api/upit-status  ručni unos (Access)
// - POST /upit       javni prijem upita s kontakt obrasca na webu (bez prijave, samo s dopuštene adrese)
// - cron u 5:00 UTC  (6:00 zimi, 7:00 ljeti po hrvatskom vremenu) skuplja podatke iz izvora
//
// Tajne (wrangler secret put): NADZOR_KLJUC, a po potrebi CF_API_TOKEN i RESEND_KEY.
// Baza se zove samo preko funkcija u Supabaseu koje provjeravaju NADZOR_KLJUC (vidi nadzor/sql).

import STRANICA from "./stranica.html";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/upit") return await primiUpit(req, env, ctx);

      const korisnik = await provjeriAccess(req, env);
      if (!korisnik) return new Response("Potrebna je prijava.", { status: 403 });

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(STRANICA, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SIGURNOSNA_ZAGLAVLJA } });
      }
      if (req.method === "GET" && url.pathname === "/api/podaci") {
        const [podaci, kuverta] = await Promise.all([
          rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_podaci", { p_kljuc: env.NADZOR_KLJUC }),
          rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_statistika", { p_kljuc: env.NADZOR_KLJUC }).catch((e) => ({ greska: String(e.message || e) })),
        ]);
        return json({ ...podaci, kuverta, korisnik });
      }
      if (req.method === "POST" && url.pathname === "/api/trosak") {
        const b = await req.json();
        const iznos = Number(b.iznos);
        if (!b.opis || !(iznos >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(b.datum || "")) return json({ greska: "Provjerite datum, opis i iznos." }, 400);
        const id = await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_trosak", { p_kljuc: env.NADZOR_KLJUC, p_datum: b.datum, p_opis: String(b.opis).slice(0, 200), p_iznos: iznos, p_linija: b.linija || "obrt" });
        return json({ id });
      }
      if (req.method === "POST" && url.pathname === "/api/upit-status") {
        const b = await req.json();
        if (!["novi", "razgovor", "ponuda", "ugovor", "odbijen"].includes(b.status)) return json({ greska: "Nepoznat status." }, 400);
        await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_upit_status", { p_kljuc: env.NADZOR_KLJUC, p_id: Number(b.id), p_status: b.status });
        return json({ ok: true });
      }
      return new Response("Nema te stranice.", { status: 404 });
    } catch (e) {
      console.error(e);
      return json({ greska: "Greška na poslužitelju." }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(prikupi(env));
  },
};

const SIGURNOSNA_ZAGLAVLJA = {
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
}

async function rpc(base, key, fn, args) {
  const r = await fetch((base) + "/rest/v1/rpc/" + (fn), {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error((fn) + ": " + (r.status) + " " + (t.slice(0, 300)));
  return t ? JSON.parse(t) : null;
}

// ---------- Javni prijem upita s weba ----------

async function primiUpit(req, env, ctx) {
  const izvor = req.headers.get("origin") || "";
  const dopusteni = (env.DOZVOLJENI_IZVORI || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cors = dopusteni.includes(izvor)
    ? { "access-control-allow-origin": izvor, "access-control-allow-methods": "POST", "access-control-allow-headers": "accept", vary: "origin" }
    : {};
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Samo POST.", { status: 405 });
  if (!cors["access-control-allow-origin"]) return json({ greska: "Nedopušten izvor." }, 403);

  const f = await req.formData();
  if ((f.get("_web") || "").toString().trim() !== "") return json({ ok: true }, 200, cors); // zamka za botove
  const ime = (f.get("ime") || "").toString().trim();
  const email = (f.get("email") || "").toString().trim();
  const tel = (f.get("tel") || "").toString().trim();
  const poruka = (f.get("poruka") || "").toString().trim();
  if (!ime || !/^\S+@\S+\.\S+$/.test(email) || !poruka) return json({ greska: "Nedostaju podaci." }, 400, cors);

  const kontakt = [email, tel].filter(Boolean).join(" · ");
  await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_upit", { p_kljuc: env.NADZOR_KLJUC, p_ime: ime, p_kontakt: kontakt, p_djelatnost: "", p_poruka: poruka });
  if (env.RESEND_KEY && env.OBAVIJEST_NA) ctx.waitUntil(posaljiObavijest(env, ime, kontakt, poruka));
  return json({ ok: true }, 200, cors);
}

async function posaljiObavijest(env, ime, kontakt, poruka) {
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + (env.RESEND_KEY), "content-type": "application/json" },
      body: JSON.stringify({
        from: env.OBAVIJEST_OD || "Digitalni partner <onboarding@resend.dev>",
        to: [env.OBAVIJEST_NA],
        subject: "Novi upit s weba: " + (ime),
        text: "Ime: " + (ime) + "\nKontakt: " + (kontakt) + "\n\n" + (poruka),
      }),
    });
  } catch (e) {
    console.error("obavijest", e);
  }
}

// ---------- Cloudflare Access: provjera potpisanog tokena ----------

let kesKljuceva = null;

async function provjeriAccess(req, env) {
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TIM || !env.ACCESS_AUD) return null;
  const [h, p, s] = token.split(".");
  if (!s) return null;
  const zaglavlje = JSON.parse(b64uTekst(h));
  const sadrzaj = JSON.parse(b64uTekst(p));
  const sada = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(sadrzaj.aud) ? sadrzaj.aud : [sadrzaj.aud];
  if (!aud.includes(env.ACCESS_AUD) || sadrzaj.exp < sada || sadrzaj.iss !== "https://" + (env.ACCESS_TIM)) return null;

  if (!kesKljuceva || kesKljuceva.do < Date.now()) {
    const r = await fetch("https://" + (env.ACCESS_TIM) + "/cdn-cgi/access/certs");
    kesKljuceva = { kljucevi: (await r.json()).keys, do: Date.now() + 3600_000 };
  }
  const jwk = kesKljuceva.kljucevi.find((k) => k.kid === zaglavlje.kid);
  if (!jwk) return null;
  const kljuc = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kljuc, b64uBajtovi(s), new TextEncoder().encode((h) + "." + (p)));
  return ok ? sadrzaj.email || "prijavljen" : null;
}

function b64uBajtovi(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function b64uTekst(s) {
  return new TextDecoder().decode(b64uBajtovi(s));
}

// ---------- Dnevni prikupljači ----------

async function prikupi(env) {
  const danas = new Date().toISOString().slice(0, 10);
  const jucer = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const zapis = (izvor, uspjeh, poruka) =>
    rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_zapis", { p_kljuc: env.NADZOR_KLJUC, p_izvor: izvor, p_uspjeh: uspjeh, p_poruka: poruka }).catch(console.error);
  const upisi = (redovi) => rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_metrike", { p_kljuc: env.NADZOR_KLJUC, p_redovi: redovi });

  // 1. Kuverta (Supabase MyWeddingInvite)
  try {
    const k = await rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_statistika", { p_kljuc: env.NADZOR_KLJUC });
    const polja = ["pozivnice", "pozivnice_objavljene", "potvrde", "gosti_potvrdeni", "albumi", "fotografije", "album_bajtovi", "rasporedi", "stolovi", "gosti_u_rasporedu"];
    const n = await upisi(polja.map((m) => ({ datum: danas, linija: "vjencanja", metrika: m, vrijednost: Number(k[m] || 0), izvor: "Supabase MyWeddingInvite" })));
    await zapis("kuverta", true, (n) + " metrika");
  } catch (e) {
    await zapis("kuverta", false, String(e.message || e));
  }

  // 2. Cloudflare: zahtjevi na web i na Kuvertu (Workers), samo ako postoji API token
  if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
    try {
      const upit = "query($a: String!, $d: Date!) { viewer { accounts(filter: { accountTag: $a }) {\n        workersInvocationsAdaptive(limit: 50, filter: { date: $d }) { sum { requests } dimensions { scriptName } } } } }";
      const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { authorization: "Bearer " + (env.CF_API_TOKEN), "content-type": "application/json" },
        body: JSON.stringify({ query: upit, variables: { a: env.CF_ACCOUNT_ID, d: jucer } }),
      });
      const j = await r.json();
      if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
      const grupe = j.data.viewer.accounts[0]?.workersInvocationsAdaptive || [];
      const zbroj = (ime) => grupe.filter((g) => g.dimensions.scriptName === ime).reduce((a, g) => a + g.sum.requests, 0);
      await upisi([
        { datum: jucer, linija: "obrt", metrika: "web_zahtjevi", vrijednost: zbroj("digitalni-partner-web"), izvor: "Cloudflare" },
        { datum: jucer, linija: "vjencanja", metrika: "kuverta_zahtjevi", vrijednost: zbroj("myweddinginvite"), izvor: "Cloudflare" },
      ]);
      await zapis("cloudflare", true, "zahtjevi za jučer");
    } catch (e) {
      await zapis("cloudflare", false, String(e.message || e));
    }
  }
}
