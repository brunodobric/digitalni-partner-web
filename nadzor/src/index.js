// Worker dashboarda Digitalnog partnera (dp-nadzor).
// - GET /            stranica dashboarda (samo uz prijavu kroz Cloudflare Access)
// - GET /api/podaci  svi brojevi za dashboard (Access)
// - POST /api/trosak, POST /api/upit-status  ručni unos (Access)
// - POST /api/trosak-obrisi  brisanje jednog troška po id-u (Access)
// - GET /api/racuni  računi iz fiskalizacije (Access)
// - GET /api/korisnici  registrirani korisnici Kuverte: e-mail, registracija, zadnja prijava (Access)
// - GET /api/cestitka?dana=…  Božićna čestitka: posjete po izvoru, kupnje, prihod i Meta oglasi (Access)
// - POST /api/korisnik-obrisi  brisanje korisničkog računa Kuverte po e-mailu (Access), vidi obrisiKorisnika
// - GET /api/racun-pdf?izvor=…&id=…  PDF računa iz servisa fisk-racun (Access)
// - GET /api/banka   stanje računa, izvodi i promet iz uvezenih izvoda CAMT.053 (Access)
// - GET /api/knjige?godina=…&okolina=…  knjiga prometa (KPR) i podaci za PO-SD (Access)
// - GET /api/obavijesti  popis obavijesti mailom, što je uključeno i zadnje poslane (Access)
// - GET /api/mailovi  automatski mailovi Kuverte: pravila, kome idu idućih 14 dana, zadnje poslano (Access)
// - POST /api/mail-spremi, /api/mail-obrisi  novo pravilo, izmjena ili brisanje pravila (Access), vidi mailovi
// - POST /api/mail-pregled  pregled maila ili proba na adresu za probe (Access), Worker Kuverte /interno/mail-pregled
// - POST /api/kpr-stavka  uključi ili isključi stavku izvoda iz KPR-a (Access)
// - POST /api/izvod  uvoz jednog izvoda CAMT.053 (XML u tijelu zahtjeva) (Access)
// - POST /upit       javni prijem upita s kontakt obrasca na webu (bez prijave, samo s dopuštene adrese)
// - email            mail na izvodi@banka… (Email Routing) uvozi kao izvod CAMT.053, vidi primiMail
// - cron u 5:00 UTC  (6:00 zimi, 7:00 ljeti po hrvatskom vremenu) skuplja podatke iz izvora
// - cron svaki sat   provjerava upozorenja i šalje mail za svako novo (vidi provjeriUpozorenja)
//
// Tajne (wrangler secret put): NADZOR_KLJUC, a po potrebi CF_API_TOKEN, RESEND_KEY
// i FISK_CITANJE_TOKEN (ista vrijednost kao istoimena tajna servisa fisk-racun, smije samo čitati;
// stari naziv FISK_TOKEN još radi kao rezerva).
// Baza se zove samo preko funkcija u Supabaseu koje provjeravaju NADZOR_KLJUC (vidi nadzor/sql).

import STRANICA from "./stranica.html";
import IKONA from "./apple-touch-icon.png"; // ikona za oznaku (bookmark) i početni zaslon
import { citajCamt053 } from "./camt.js";
import { izOmotnice, jeZip, posiljateljDopusten, privitci, xmlIzZipa } from "./mail.js";
import { DOMENA_NADZORA, POPIS_OBAVIJESTI, sastaviUpozorenja } from "./upozorenja.js";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/upit") return await primiUpit(req, env, ctx);

      const korisnik = await provjeriAccess(req, env);
      if (!korisnik) return new Response("Potrebna je prijava.", { status: 403 });

      if (req.method === "GET" && url.pathname === "/apple-touch-icon.png") {
        return new Response(IKONA, { headers: { "content-type": "image/png", "cache-control": "private, max-age=604800" } });
      }
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
      if (req.method === "POST" && url.pathname === "/api/trosak-obrisi") {
        const b = await req.json();
        const id = Number(b.id);
        if (!Number.isInteger(id) || id <= 0) return json({ greska: "Nepoznat trošak." }, 400);
        const obrisan = await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_trosak_obrisi", { p_kljuc: env.NADZOR_KLJUC, p_id: id });
        if (!obrisan) return json({ greska: "Trošak više ne postoji. Osvježi stranicu." }, 404);
        return json({ ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/upit-status") {
        const b = await req.json();
        if (!["novi", "razgovor", "ponuda", "ugovor", "odbijen"].includes(b.status)) return json({ greska: "Nepoznat status." }, 400);
        await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_upit_status", { p_kljuc: env.NADZOR_KLJUC, p_id: Number(b.id), p_status: b.status });
        return json({ ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/racuni") {
        const racuni = await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_racuni", { p_kljuc: env.NADZOR_KLJUC });
        return json({ racuni });
      }
      if (req.method === "GET" && url.pathname === "/api/korisnici") {
        const korisnici = await rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_korisnici", { p_kljuc: env.NADZOR_KLJUC });
        return json({ korisnici });
      }
      if (req.method === "GET" && url.pathname === "/api/izvori") {
        const dana = [7, 30, 90, 0].includes(Number(url.searchParams.get("dana"))) ? Number(url.searchParams.get("dana")) : 30;
        // Jedan dan (klik na stupac grafa): p_dan postoji tek nakon sql/22, pa se šalje samo kad je dan odabran.
        const dan = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("dan") || "") ? url.searchParams.get("dan") : null;
        const args = { p_kljuc: env.NADZOR_KLJUC, p_dana: dana, ...(dan ? { p_dan: dan } : {}) };
        const greska = (e) => ({ greska: e.message });
        const danasZg = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });
        const [izvori, oznake, oglasi, danasIzvori] = await Promise.all([
          rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_izvori", args).catch((e) => {
            if (dan) return { greska_dan: true };
            throw e;
          }),
          // Po oznaci poveznice (sql/20-kuverta-oznake-sve.sql, prije sql/19): sve oznake, grupe i Pinterest. Ako funkcije još nema,
          // grupe se čitaju starom funkcijom iz sql/18, a ostatak sekcije radi normalno.
          rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_oznake", args).catch(greska),
          // Meta oglasi Kuverte: isti oglasni račun, bez kampanja čestitke.
          metaOglasi(env, { dana, dan, cestitka: false }).catch(greska),
          // Samo današnji dan (sql/22), za "danas N" ispod zbroja. Bez sql/22 se ne prikazuje.
          rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_izvori", { p_kljuc: env.NADZOR_KLJUC, p_dana: 1, p_dan: danasZg }).catch(() => null),
        ]);
        const zbrojDanas = (k) => ((danasIzvori && danasIzvori.po_izvoru) || []).reduce((a, x) => a + Number(x[k] || 0), 0);
        const danas = danasIzvori && danasIzvori.po_izvoru ? { posjete: zbrojDanas("posjete"), registracije: zbrojDanas("registracije"), kupnje: zbrojDanas("kupnje") } : null;
        if (izvori && izvori.greska_dan) return json({ greska: "Pregled po danu radi kad se u projektu MyWeddingInvite pokrene sql/22-kuverta-aktivnost-i-dani.sql." }, 500);
        let po_grupi = [], grupe_greska = "", po_pinterestu = [], pinterest_greska = "", po_oznaci = [];
        if (Array.isArray(oznake)) {
          po_oznaci = oznake;
          po_grupi = oznake.filter((x) => x.medij === "grupa").map((x) => ({ ...x, grupa: x.oglas }));
          po_pinterestu = oznake.filter((x) => x.izvor === "pinterest");
        } else {
          pinterest_greska = oznake.greska;
          const grupe = await rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_grupe", { p_kljuc: env.NADZOR_KLJUC, p_dana: dana }).catch(greska);
          if (Array.isArray(grupe)) po_grupi = grupe; else grupe_greska = grupe.greska;
        }
        return json({ ...izvori, po_oznaci, po_grupi, grupe_greska, po_pinterestu, pinterest_greska, dana, dan, oglasi, danas });
      }
      if (req.method === "GET" && url.pathname === "/api/cestitka") {
        // Božićna čestitka (bozicna.kuverta.hr): posjete po izvoru i kupnje, funkcija nadzor_cestitka iz
        // migracije 009_posjete_i_nadzor.sql u repozitoriju bozicna-cestitka.
        if (!env.CESTITKA_URL || !env.CESTITKA_KEY) return json({ greska: "Nije postavljen CESTITKA_KEY (javni ključ Supabase projekta bozicna-cestitka)." }, 500);
        const dana = [7, 30, 90, 0].includes(Number(url.searchParams.get("dana"))) ? Number(url.searchParams.get("dana")) : 30;
        // Jedan dan (klik na stupac grafa): p_dan postoji od migracije 010 u repozitoriju bozicna-cestitka.
        const dan = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("dan") || "") ? url.searchParams.get("dan") : null;
        const [c, oglasi] = await Promise.all([
          rpc(env.CESTITKA_URL, env.CESTITKA_KEY, "nadzor_cestitka", { p_kljuc: env.NADZOR_KLJUC, p_dana: dana, ...(dan ? { p_dan: dan } : {}) }).catch((e) => {
            if (dan) throw new Error("Pregled jednog dana radi kad se u projektu bozicna-cestitka pokrene migracija 010_nadzor_po_danu.sql.");
            throw e;
          }),
          metaOglasi(env, { dana, dan, cestitka: true }).catch((e) => ({ greska: String(e.message || e) })),
        ]);
        return json({ ...c, dana, dan, oglasi });
      }
      if (req.method === "POST" && url.pathname === "/api/korisnik-obrisi") return await obrisiKorisnika(req, env);
      if (url.pathname.startsWith("/api/mail")) {
        const odgovor = await mailovi(req, url, env);
        if (odgovor) return odgovor;
      }
      if (req.method === "GET" && url.pathname === "/api/racun-pdf") return await pdfRacuna(url, env);
      if (req.method === "GET" && url.pathname === "/api/banka") {
        return json(await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_banka", { p_kljuc: env.NADZOR_KLJUC }));
      }
      if (req.method === "POST" && url.pathname === "/api/izvod") return await uvezIzvod(req, env);
      if (req.method === "GET" && url.pathname === "/api/knjige") {
        const godina = Number(url.searchParams.get("godina")) || new Date().getUTCFullYear();
        const okolina = ["produkcija", "test", "sve"].includes(url.searchParams.get("okolina")) ? url.searchParams.get("okolina") : "produkcija";
        if (godina < 2000 || godina > 2100) return json({ greska: "Neispravna godina." }, 400);
        return json(await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_knjige", { p_kljuc: env.NADZOR_KLJUC, p_godina: godina, p_okolina: okolina }));
      }
      if (req.method === "GET" && url.pathname === "/api/obavijesti") {
        const uvjeti = { mail: !!(env.RESEND_KEY && env.OBAVIJEST_NA), iban: !!env.IZVODI_IBAN, fisk: !!fiskToken(env) };
        uvjeti.iban = uvjeti.iban && uvjeti.mail;
        uvjeti.fisk = uvjeti.fisk && uvjeti.mail;
        return json({
          adresa: env.OBAVIJEST_NA || "",
          popis: POPIS_OBAVIJESTI.map((o) => ({ ...o, ukljuceno: uvjeti[o.uvjet] })),
          poslane: await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_obavijesti_popis", { p_kljuc: env.NADZOR_KLJUC }),
        });
      }
      if (req.method === "POST" && url.pathname === "/api/kpr-stavka") {
        const b = await req.json();
        const id = Number(b.id);
        if (!Number.isInteger(id) || id <= 0 || ![true, false, null].includes(b.kpr)) return json({ greska: "Neispravna stavka." }, 400);
        const ok = await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_kpr_stavka", { p_kljuc: env.NADZOR_KLJUC, p_id: id, p_kpr: b.kpr });
        if (!ok) return json({ greska: "Stavka više ne postoji. Osvježi stranicu." }, 404);
        return json({ ok: true });
      }
      return new Response("Nema te stranice.", { status: 404 });
    } catch (e) {
      console.error(e);
      return json({ greska: "Greška na poslužitelju." }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Jutarnji cron skuplja brojke pa provjerava upozorenja; satni samo provjerava.
    ctx.waitUntil((event.cron === JUTARNJI_CRON ? prikupi(env) : Promise.resolve()).then(() => provjeriUpozorenja(env)));
  },

  // Mail stiže preko Cloudflare Email Routinga (poddomena banka.): onaj na adresu za izvode
  // (IZVODI_ADRESA) se uvozi kao izvod, a ostali se odbace.
  async email(poruka, env) {
    if (!jeAdresaZaIzvode(poruka.to, env)) return;
    let raw = null;
    try {
      raw = poruka.rawSize > NAJVECI_MAIL ? null : new Uint8Array(await new Response(poruka.raw).arrayBuffer());
    } catch (e) {
      console.error("mail", e);
    }
    try {
      await primiMail(poruka, raw, env);
    } catch (e) {
      console.error("izvodi-mail", e);
    }
  },
};

const JUTARNJI_CRON = "0 5 * * *";

const SIGURNOSNA_ZAGLAVLJA = {
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: https://kuverta.hr; frame-ancestors 'none'",
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

// ---------- PDF računa (servis fisk-racun u Supabaseu) ----------

function fiskToken(env) {
  return env.FISK_CITANJE_TOKEN || env.FISK_TOKEN || "";
}

// Ključ samo za čitanje (PDF, stanje, zdravlje) ima prednost. Ako ga fisk-racun odbije (npr. nije isti kao u
// Supabaseu), poziv se ponovi s punim ključem FISK_TOKEN, da PDF i provjera ne stanu.
async function fisk(env, tijelo) {
  const posalji = (token) =>
    fetch(env.FISK_URL || (env.SUPABASE_URL + "/functions/v1/fisk-racun"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-fisk-token": token },
      body: JSON.stringify(tijelo),
    });
  const tokeni = [env.FISK_CITANJE_TOKEN, env.FISK_TOKEN].filter(Boolean);
  if (!tokeni.length) return posalji("");
  let r;
  for (const t of tokeni) {
    r = await posalji(t);
    if (r.status !== 401) return r;
    if (t === env.FISK_CITANJE_TOKEN) console.warn("fisk-racun je odbio FISK_CITANJE_TOKEN");
  }
  return r;
}

async function pdfRacuna(url, env) {
  const izvor = url.searchParams.get("izvor") || "";
  const vanjskiId = url.searchParams.get("id") || "";
  if (!izvor || !vanjskiId || izvor.length > 200 || vanjskiId.length > 200) return json({ greska: "Nedostaju izvor i id." }, 400);
  if (!fiskToken(env)) return new Response("PDF nije postavljen: nedostaje tajna FISK_CITANJE_TOKEN.", { status: 503 });
  const r = await fisk(env, { radnja: "pdf", izvor, vanjskiId });
  if (!r.ok || !(r.headers.get("content-type") || "").startsWith("application/pdf")) {
    const t = await r.text();
    let poruka = "PDF se nije mogao napraviti (" + r.status + ").";
    try { poruka = JSON.parse(t).greska || poruka; } catch (_) {}
    return new Response(poruka, { status: r.status === 404 || r.status === 409 ? r.status : 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(r.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": r.headers.get("content-disposition") || "inline",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// ---------- Uvoz bankovnog izvoda (CAMT.053) ----------

const NAJVECI_IZVOD = 5 * 1024 * 1024;

// Greška u samoj datoteci (nije izvod, krivi IBAN...), za razliku od greške baze ili mreže.
class GreskaIzvoda extends Error {}

// Uvozi jednu datoteku: XML izvod ili ZIP s XML izvodima. dopusteniIban (niz) ograničava račune.
async function uveziDatoteku(env, bajtovi, naziv, dopusteniIban) {
  if (!bajtovi.length) throw new GreskaIzvoda("Datoteka je prazna.");
  let unutra;
  try {
    unutra = izOmotnice(bajtovi);
  } catch (e) {
    throw new GreskaIzvoda(String(e.message || e));
  }
  if (unutra) return await uveziDatoteku(env, unutra, naziv, dopusteniIban);
  if (jeZip(bajtovi)) {
    let xmlovi;
    try {
      xmlovi = await xmlIzZipa(bajtovi);
    } catch (e) {
      throw new GreskaIzvoda(String(e.message || e));
    }
    if (!xmlovi.length) throw new GreskaIzvoda("U ZIP-u nema XML datoteke.");
    const zbroj = { uvezeni: [], preskoceni: [], neuskladeni: [] };
    for (const x of xmlovi) {
      const r = await uveziDatoteku(env, x.bajtovi, naziv + " / " + x.naziv, dopusteniIban);
      for (const k in zbroj) zbroj[k].push(...r[k]);
    }
    return zbroj;
  }
  if (bajtovi.length > NAJVECI_IZVOD) throw new GreskaIzvoda("Datoteka je veća od 5 MB.");
  let xml;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bajtovi);
  } catch (_) {
    throw new GreskaIzvoda("Datoteka nije u kodiranju UTF-8, pa nije izvod CAMT.053.");
  }
  let izvodi;
  try {
    izvodi = citajCamt053(xml);
  } catch (e) {
    throw new GreskaIzvoda(String(e.message || e));
  }
  if (dopusteniIban) {
    const tudi = izvodi.filter((i) => !dopusteniIban.includes(i.iban)).map((i) => i.iban);
    if (tudi.length) throw new GreskaIzvoda("Izvod je za račun koji nije na popisu IZVODI_IBAN: " + tudi.join(", "));
  }
  const sazetak = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bajtovi))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const ishod = await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_izvod_uvoz", { p_kljuc: env.NADZOR_KLJUC, p_naziv: naziv.slice(0, 200), p_sazetak: sazetak, p_xml: xml, p_izvodi: izvodi });
  return { uvezeni: ishod.uvezeni, preskoceni: ishod.preskoceni, neuskladeni: izvodi.filter((i) => i.uskladeno === false).map((i) => i.oznaka) };
}

async function uvezIzvod(req, env) {
  // application/xml nije "jednostavna" vrsta za CORS, pa tuđa stranica ne može poslati izvod u ime prijavljenog.
  if (!(req.headers.get("content-type") || "").startsWith("application/xml")) return json({ greska: "Izvod se šalje kao application/xml." }, 415);
  const duljina = Number(req.headers.get("content-length") || 0);
  if (duljina > NAJVECI_IZVOD) return json({ greska: "Datoteka je veća od 5 MB." }, 413);
  const bajtovi = new Uint8Array(await req.arrayBuffer());
  if (bajtovi.length > NAJVECI_IZVOD) return json({ greska: "Datoteka je veća od 5 MB." }, 413);
  let naziv = "";
  try { naziv = decodeURIComponent(req.headers.get("x-naziv") || ""); } catch (_) {}
  try {
    return json(await uveziDatoteku(env, bajtovi, naziv, null));
  } catch (e) {
    if (e instanceof GreskaIzvoda) return json({ greska: e.message }, 400);
    throw e;
  }
}

// ---------- Izvodi stižu mailom (Cloudflare Email Routing -> ovaj Worker) ----------
// IZVODI_IBAN (obavezno): IBAN-i za koje se izvodi primaju, odvojeni zarezom.
// IZVODI_POSILJATELJI (preporučeno): adrese ili domene pošiljatelja, npr. "@pbz.hr".
// IZVODI_PROSLIJEDI (neobavezno): potvrđena adresa u Email Routingu na koju se mail proslijedi.

const NAJVECI_MAIL = 25 * 1024 * 1024;

function popis(v) {
  return String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
}

async function primiMail(poruka, raw, env) {
  const od = String(poruka.from || "").toLowerCase();
  const zapisi = (uspjeh, tekst) => {
    return rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_zapis", { p_kljuc: env.NADZOR_KLJUC, p_izvor: "izvodi-mail", p_uspjeh: uspjeh, p_poruka: tekst }).catch(console.error);
  };
  const javi = (tekst) => env.RESEND_KEY && env.OBAVIJEST_NA ? posaljiMail(env, "Izvod iz banke nije uvezen", tekst) : null;
  await primiIzvod(poruka, raw, env, od, zapisi, javi);
}

async function primiIzvod(poruka, raw, env, od, zapisi, javi) {
  if (env.IZVODI_PROSLIJEDI) {
    try {
      await poruka.forward(env.IZVODI_PROSLIJEDI);
    } catch (e) {
      console.error("proslijedi", e);
    }
  }
  const ibani = popis(env.IZVODI_IBAN).map((i) => i.replace(/\s+/g, "").toUpperCase());
  if (!ibani.length) {
    const t = "Mail od " + od + " nije uvezen: u Workeru dp-nadzor nije postavljena tajna IZVODI_IBAN.";
    await zapisi(false, t);
    return await javi(t);
  }
  // Kod prosljeđivanja (npr. iz Zoha) omotnica nosi adresu sandučića koji prosljeđuje,
  // a zaglavlje From ostaje banka, pa vrijedi ako se bilo koja od njih poklapa.
  const odZaglavlje = ((poruka.headers.get("from") || "").match(/[^\s<>"]+@[^\s<>"]+/) || [""])[0].toLowerCase();
  const dopusteni = popis(env.IZVODI_POSILJATELJI);
  if (!posiljateljDopusten(od, dopusteni) && !posiljateljDopusten(odZaglavlje, dopusteni)) return await zapisi(false, "Mail od " + od + " nije uvezen: pošiljatelj nije na popisu IZVODI_POSILJATELJI.");
  if (!raw) {
    const t = "Mail od " + od + " je veći od 25 MB, pa nije uvezen.";
    await zapisi(false, t);
    return await javi(t);
  }

  const datoteke = privitci(raw).filter((p) => /\.(xml|zip|sgn)$/i.test(p.naziv) || /(^|\/)(xml|zip|x-zip-compressed)$/.test(p.vrsta));
  if (!datoteke.length) {
    const t = "Mail od " + od + " (" + (poruka.headers.get("subject") || "bez naslova") + ") nema privitka s izvodom (XML, ZIP ili SGN).";
    await zapisi(false, t);
    return await javi(t);
  }
  const uvezeni = [], preskoceni = [], neuskladeni = [], greske = [];
  for (const d of datoteke) {
    try {
      const r = await uveziDatoteku(env, d.bajtovi, "mail: " + d.naziv, ibani);
      uvezeni.push(...r.uvezeni);
      preskoceni.push(...r.preskoceni);
      neuskladeni.push(...r.neuskladeni);
    } catch (e) {
      greske.push(d.naziv + ": " + String(e.message || e));
    }
  }
  const t = [
    uvezeni.length ? "uvezeno izvoda: " + uvezeni.length : "",
    preskoceni.length ? "već uvezeno: " + preskoceni.length : "",
    neuskladeni.length ? "ne slaže se: " + neuskladeni.join(", ") : "",
    greske.length ? "greške: " + greske.join("; ") : "",
  ].filter(Boolean).join(", ");
  await zapisi(!greske.length && !neuskladeni.length, t);
  if (greske.length || neuskladeni.length) await javi("Mail od " + od + ": " + t + "\n\nIzvod možeš uvesti i ručno na ekranu Banka u dashboardu.");
}

async function posaljiMail(env, naslov, tekst) {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: env.OBAVIJEST_OD || "Digitalni partner <onboarding@resend.dev>", to: [env.OBAVIJEST_NA], subject: naslov, text: tekst }),
    });
    if (!r.ok) console.error("obavijest", r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) {
    console.error("obavijest", e);
    return false;
  }
}

// IZVODI_ADRESA (neobavezno): adrese odvojene zarezom koje se uvoze kao izvodi. Bez nje vrijedi svaka adresa "izvodi@…".

function jeAdresaZaIzvode(za, env) {
  const a = String(za || "").trim().toLowerCase();
  const popisAdresa = popis(env.IZVODI_ADRESA).map((x) => x.toLowerCase());
  return popisAdresa.length ? popisAdresa.includes(a) : a.startsWith("izvodi@");
}

// ---------- Javni prijem upita s weba ----------

async function primiUpit(req, env, ctx) {
  const origin = req.headers.get("origin") || "";
  const dopusteni = (env.DOZVOLJENI_IZVORI || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cors = dopusteni.includes(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "accept", vary: "origin" }
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

  // Izvor posjeta s weba (js/izvor.js): UTM oznake, domena s koje je posjetitelj došao ili "izravno", te prva otvorena stranica.
  const izvor = (f.get("izvor") || "").toString().replace(/[^\p{L}\p{N} .·:/()_-]/gu, "").trim().slice(0, 200) || "nepoznato";

  const kontakt = [email, tel].filter(Boolean).join(" · ");
  const upit = { p_kljuc: env.NADZOR_KLJUC, p_ime: ime, p_kontakt: kontakt, p_djelatnost: "", p_poruka: poruka };
  try {
    await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_upit", { ...upit, p_izvor: izvor });
  } catch (e) {
    // Baza još nema funkciju s izvorom (sql/11-izvor-upita.sql): upit se ipak sprema, samo bez izvora. Izvor ostaje u mailu.
    console.error("upit s izvorom", e);
    await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_upit", upit);
  }
  if (env.RESEND_KEY && env.OBAVIJEST_NA) ctx.waitUntil(posaljiObavijest(env, ime, kontakt, poruka, izvor));
  return json({ ok: true }, 200, cors);
}

async function posaljiObavijest(env, ime, kontakt, poruka, izvor) {
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + (env.RESEND_KEY), "content-type": "application/json" },
      body: JSON.stringify({
        from: env.OBAVIJEST_OD || "Digitalni partner <onboarding@resend.dev>",
        to: [env.OBAVIJEST_NA],
        subject: "Novi upit s weba: " + (ime),
        text: "Ime: " + (ime) + "\nKontakt: " + (kontakt) + "\nIzvor: " + (izvor) + "\n\n" + (poruka),
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

// ---------- Meta oglasi (ekrani Kuverta i Čestitka, tab Oglasi i izvori) ----------
// Prikazi, doseg, klikovi i potrošnja po oglasu iz Metinog API-ja za oglase (Insights, razina oglasa).
// Treba tajnu META_ADS_TOKEN (token sistemskog korisnika s dozvolom ads_read) i META_OGLASNI_RACUN (broj računa).
// META_KAMPANJE: regularni izraz za imena kampanja čestitke (zadano čestitka ili Božić). Račun dijeli i Kuverta:
// ekran Čestitka pokazuje kampanje koje mu odgovaraju (cestitka: true), a ekran Kuverta sve ostale.
// Kupnje se spajaju s oglasom preko utm_content={{ad.id}} u parametrima URL-a oglasa.
async function metaOglasi(env, { dana, dan = null, cestitka }) {
  const racun = String(env.META_OGLASNI_RACUN || "").replace(/^act_/, "").trim();
  if (!env.META_ADS_TOKEN || !racun) return { postavljeno: false };
  const zg = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });
  const danas = zg(Date.now());
  const parametri = new URLSearchParams({
    level: "ad",
    fields: "ad_id,ad_name,campaign_name,impressions,reach,clicks,spend,frequency,actions",
    limit: "500",
  });
  if (dan) parametri.set("time_range", JSON.stringify({ since: dan, until: dan }));
  else if (dana) parametri.set("time_range", JSON.stringify({ since: zg(Date.now() - (dana - 1) * 864e5), until: danas }));
  else parametri.set("date_preset", "maximum");
  const r = await fetch("https://graph.facebook.com/v26.0/act_" + encodeURIComponent(racun) + "/insights?" + parametri, {
    headers: { authorization: "Bearer " + env.META_ADS_TOKEN },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error("Meta: " + ((j.error && j.error.message) || r.status));
  let filtar;
  try { filtar = new RegExp(env.META_KAMPANJE || "čestit|cestit|božić|bozic", "i"); } catch { filtar = /čestit|cestit|božić|bozic/i; }
  const broj = (v) => Number(v || 0);
  const jeCestitka = (x) => filtar.test(x.campaign_name || "") || filtar.test(x.ad_name || "");
  // Metin vlastiti broj registracija i kupnji (Pixel + Conversions API), samo za usporedbu s našim brojem iz baze.
  // Meta isti događaj vraća pod više naziva, pa se uzima prvi koji postoji, ne zbroj.
  const akcija = (x, vrste) => { const a = x.actions || []; for (const v of vrste) { const n = a.find((y) => y.action_type === v); if (n) return broj(n.value); } return 0; };
  const redovi = (j.data || []).filter((x) => jeCestitka(x) === cestitka).map((x) => ({
    id: x.ad_id, ime: x.ad_name, kampanja: x.campaign_name, prikazi: broj(x.impressions), doseg: broj(x.reach), klikovi: broj(x.clicks), potrosnja: broj(x.spend),
    frekvencija: broj(x.frequency),
    meta_registracije: akcija(x, ["complete_registration", "offsite_conversion.fb_pixel_complete_registration"]),
    meta_kupnje: akcija(x, ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]),
  }));
  redovi.sort((a, b) => b.potrosnja - a.potrosnja || b.prikazi - a.prikazi);
  return { postavljeno: true, redovi };
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

// ---------- Upozorenja mailom ----------

async function provjeriUpozorenja(env) {
  if (!env.RESEND_KEY || !env.OBAVIJEST_NA) return;
  try {
    const danas = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zagreb" });
    const stanje = await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_upozorenja", { p_kljuc: env.NADZOR_KLJUC });
    let zdravlje = null;
    if (fiskToken(env)) {
      try {
        const r = await fisk(env, { radnja: "zdravlje" });
        const j = await r.json().catch(() => ({}));
        // Stara verzija servisa nema radnju "zdravlje" (400): to nije kvar, samo se preskoči.
        zdravlje = r.ok ? j : (r.status === 400 ? null : { greska: "HTTP " + r.status + (j.greska ? ", " + j.greska : "") });
      } catch (e) {
        zdravlje = { greska: String(e.message || e) };
      }
    }
    const sva = sastaviUpozorenja(stanje, zdravlje, danas);
    if (!sva.length) return;
    const nova = new Set(await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_obavijesti_nove", { p_kljuc: env.NADZOR_KLJUC, p_kljucevi: sva.map((x) => x.kljuc) }) || []);
    const zaSlanje = sva.filter((x) => nova.has(x.kljuc));
    if (!zaSlanje.length) return;
    const tekst = zaSlanje.map((x) => "• " + x.tekst + "\n  " + DOMENA_NADZORA + "/#" + x.ekran).join("\n\n")
      + "\n\nSvako upozorenje stiže samo jednom. Nadzor provjerava svaki sat.";
    const naslov = zaSlanje.length === 1 ? "Nadzor: " + zaSlanje[0].tekst.slice(0, 70) : "Nadzor: " + zaSlanje.length + " upozorenja";
    if (await posaljiMail(env, naslov, tekst)) {
      await rpc(env.SUPABASE_URL, env.SUPABASE_KEY, "nadzor_obavijesti_poslane", { p_kljuc: env.NADZOR_KLJUC, p_kljucevi: zaSlanje.map((x) => x.kljuc) });
    }
  } catch (e) {
    console.error("upozorenja", e);
  }
}

// Brisanje korisničkog računa Kuverte. Datoteke albuma su u R2 Kuverte, pa račun briše Worker Kuverte
// (/interno/obrisi-korisnika). Šalje mu se NADZOR_KLJUC, a provjerava ga baza Kuverte
// (nadzor_obrisi_korisnika, migracija 023 u repozitoriju MyWeddingInvite).
async function obrisiKorisnika(req, env) {
  const b = await req.json().catch(() => ({}));
  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!email || email.length > 320) return json({ greska: "Nedostaje e-mail." }, 400);
  const r = await fetch(new URL("/interno/obrisi-korisnika", env.KUVERTA_WEB), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kljuc: env.NADZOR_KLJUC, email }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("korisnik-obrisi", r.status, j);
    return json({ greska: j.greska || "Kuverta je vratila " + r.status + "." }, r.status === 404 ? 404 : 502);
  }
  console.log("korisnik-obrisi", "obrisan račun Kuverte");
  return json({ ok: true, upozorenja: j.upozorenja || [] });
}

// ---------- Automatski mailovi Kuverte (ekran Mailovi) ----------
// Pravila su u bazi Kuverte (migracija 033_mail_pravila.sql u repozitoriju MyWeddingInvite); nadzor ih čita i
// mijenja preko funkcija nadzor_mail* koje traže NADZOR_KLJUC. Pregled i probu slaže Worker Kuverte, da izgledaju
// točno kao pravi mail.

const MAIL_POLJA = ["kljuc", "naziv", "predlozak", "okidac", "dana", "nakon", "datum", "datum_do", "sat", "kome", "usluga", "sadrzaj", "aktivno", "redoslijed"];

// Poruka iz PostgRESTa (npr. provjera u tablici) bez tehničkog dijela.
function porukaBaze(e) {
  const m = String((e && e.message) || e);
  const j = m.indexOf("{");
  try {
    const x = JSON.parse(m.slice(j));
    if (x.code === "PGRST202") return "U projektu MyWeddingInvite još nije pokrenuta migracija 033_mail_pravila.sql.";
    if (x.code === "23514") return "Neka vrijednost nije dopuštena (npr. broj dana ili sat). Provjeri polja.";
    if (x.code === "23503") return "Pravilo nakon kojeg ide ovaj mail ne postoji.";
    if (x.code === "22007" || x.code === "22P02") return "Neispravan datum ili broj.";
    if (x.message) return x.message;
  } catch (_) {
    // nije JSON
  }
  return m.slice(0, 200);
}

async function mailovi(req, url, env) {
  try {
    if (req.method === "GET" && url.pathname === "/api/mailovi") {
      return json(await rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_mailovi", { p_kljuc: env.NADZOR_KLJUC }));
    }
    if (req.method === "POST" && url.pathname === "/api/mail-spremi") {
      const b = await req.json().catch(() => ({}));
      const p = {};
      for (const k of MAIL_POLJA) if (b.pravilo && k in b.pravilo) p[k] = b.pravilo[k];
      if (p.sadrzaj && (typeof p.sadrzaj !== "object" || JSON.stringify(p.sadrzaj).length > 50000)) return json({ greska: "Tekst maila je predugačak." }, 400);
      const kljuc = await rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_mail_spremi", { p_kljuc: env.NADZOR_KLJUC, p });
      return json({ kljuc });
    }
    if (req.method === "POST" && url.pathname === "/api/mail-obrisi") {
      const b = await req.json().catch(() => ({}));
      if (typeof b.kljuc !== "string" || !b.kljuc) return json({ greska: "Nepoznato pravilo." }, 400);
      const ok = await rpc(env.KUVERTA_URL, env.KUVERTA_KEY, "nadzor_mail_obrisi", { p_kljuc: env.NADZOR_KLJUC, p_pravilo: b.kljuc });
      if (!ok) return json({ greska: "Početna pravila se ne brišu, samo isključuju." }, 400);
      return json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/mail-pregled") {
      const b = await req.json().catch(() => ({}));
      const r = await fetch(new URL("/interno/mail-pregled", env.KUVERTA_WEB), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kljuc: env.NADZOR_KLJUC, pravilo: b.pravilo || {}, verzija: b.verzija || "", proba: b.proba === true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ greska: j.greska || (r.status === 404 ? "Kuverta još nema pregled mailova (treba objaviti novu verziju Kuverte)." : "Kuverta je vratila " + r.status + ".") }, 502);
      return json(j);
    }
  } catch (e) {
    console.error("mailovi", e);
    return json({ greska: porukaBaze(e) }, 500);
  }
  return null;
}

