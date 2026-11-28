// Vođenje Meta oglasa (zamjena za Crush): svako jutro čita brojeve po oglasu, ocijeni aktivne oglase
// i mailom predloži pauzu slabih. Pauzira se tek kad Bruno klikne "Pauziraj" na stranici /meta/odobri.
// Budžete alat ne mijenja; samo upozori ako potrošnja prijeđe dnevnu granicu.
// Ocjena i mail su čiste funkcije (bez mreže), testovi su u test/oglasi.test.mjs.

export const META_API = "https://graph.facebook.com/v26.0/";

// Pragovi (eura, frekvencija). Mogu se promijeniti varijablama Workera istih imena.
export function postavke(env = {}) {
  const n = (k, d) => (Number.isFinite(Number(env[k])) && String(env[k] ?? "").trim() !== "" ? Number(env[k]) : d);
  return {
    dobar: n("META_PRAG_DOBAR", 3), // do ovoliko € po registraciji oglas je dobar
    slab: n("META_PRAG_SLAB", 5), // iznad ovoga prijedlog za pauzu
    bezRegistracije: n("META_BEZ_REG", 6), // potrošeno bez ijedne registracije
    frekvencija: n("META_FREKV", 3),
    budzetKuverta: n("META_BUDZET_KUVERTA", 30),
    budzetCestitka: n("META_BUDZET_CESTITKA", 20),
  };
}

let filtarCestitke = null;
export function jeCestitka(env, imeKampanje, imeOglasa = "") {
  if (!filtarCestitke) {
    try { filtarCestitke = new RegExp(env.META_KAMPANJE || "čestit|cestit|božić|bozic", "i"); } catch { filtarCestitke = /čestit|cestit|božić|bozic/i; }
  }
  return filtarCestitke.test(imeKampanje || "") || filtarCestitke.test(imeOglasa || "");
}

const broj = (v) => Number(v || 0);
export function akcija(x, vrste) {
  const a = x.actions || [];
  for (const v of vrste) { const n = a.find((y) => y.action_type === v); if (n) return broj(n.value); }
  return 0;
}
export const REG = ["complete_registration", "offsite_conversion.fb_pixel_complete_registration"];
export const KUP = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

// Ocjena jednog oglasa iz zbroja zadnjih 7 dana. registracije su naše (baza Kuverte, utm_content = ad.id).
export function ocijeniOglas({ potrosnja, registracije, frekvencija }, p) {
  const eur = (v) => v.toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  if (frekvencija > p.frekvencija) return { stanje: "prijedlog_pauza", razlog: "Frekvencija " + frekvencija.toFixed(1) + " (iznad " + p.frekvencija + "): ljudi ga vide prečesto, treba nova kreativa." };
  if (!registracije) {
    if (potrosnja >= p.bezRegistracije) return { stanje: "prijedlog_pauza", razlog: "Potrošeno " + eur(potrosnja) + " bez ijedne registracije." };
    return { stanje: "malo_podataka", razlog: "Potrošeno " + eur(potrosnja) + ", još nema registracije." };
  }
  const cpr = potrosnja / registracije;
  if (cpr > p.slab) return { stanje: "prijedlog_pauza", razlog: eur(cpr) + " po registraciji (iznad " + eur(p.slab) + ")." };
  if (cpr > p.dobar) return { stanje: "slab", razlog: eur(cpr) + " po registraciji, pod nadzorom." };
  return { stanje: "dobar", razlog: eur(cpr) + " po registraciji." };
}

// redovi7: Metini zbrojevi za 7 dana po oglasu, aktivni: Set ad_id aktivnih oglasa, nase: { ad_id: {registracije, kupnje} }.
export function ocijeni(redovi7, aktivni, nase, p, datum) {
  return redovi7.filter((x) => aktivni.has(x.ad_id)).map((x) => {
    const n = nase[x.ad_id] || {};
    const temelj = { ad_id: x.ad_id, datum, ad_name: x.ad_name, campaign_name: x.campaign_name, proizvod: x.proizvod,
      potrosnja_7: x.spend, registracije_7: broj(n.registracije), frekvencija_7: x.frequency };
    if (x.proizvod === "cestitka") return { ...temelj, stanje: "samo_izvjestaj", razlog: "Čestitka: prvi tjedan samo izvještaj." };
    return { ...temelj, ...ocijeniOglas({ potrosnja: x.spend, registracije: broj(n.registracije), frekvencija: x.frequency }, p) };
  });
}

const OZNAKE = { dobar: "dobar", slab: "pod nadzorom", malo_podataka: "premalo podataka", prijedlog_pauza: "PRIJEDLOG: pauza", samo_izvjestaj: "izvještaj" };

// Jutarnji mail. jucer: { kuverta: €, cestitka: € }, prijedlozi: [{id, ad_id}] iz baze.
export function sastaviMail({ stanja, jucer, p, prijedlozi, domena, datumJucer }) {
  const eur = (v) => Number(v || 0).toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const linija = [];
  const idPo = Object.fromEntries((prijedlozi || []).map((x) => [x.ad_id, x.id]));
  linija.push("Potrošnja jučer (" + datumJucer + "): Kuverta " + eur(jucer.kuverta) + " od " + eur(p.budzetKuverta) + ", Čestitka " + eur(jucer.cestitka) + " od " + eur(p.budzetCestitka) + ".");
  const preko = [];
  if (jucer.kuverta > p.budzetKuverta * 1.05) preko.push("Kuverta je potrošila " + eur(jucer.kuverta) + ", više od granice " + eur(p.budzetKuverta) + ".");
  if (jucer.cestitka > p.budzetCestitka * 1.05) preko.push("Čestitka je potrošila " + eur(jucer.cestitka) + ", više od granice " + eur(p.budzetCestitka) + ".");
  if (preko.length) linija.push("", "UPOZORENJE: " + preko.join(" ") + " Provjeri budžete u Ads Manageru.");
  const grupa = (proizvod, naslov) => {
    const s = stanja.filter((x) => x.proizvod === proizvod).sort((a, b) => b.potrosnja_7 - a.potrosnja_7);
    if (!s.length) return;
    linija.push("", naslov + " (zadnjih 7 dana):");
    for (const x of s) {
      linija.push("• " + x.ad_name + " · " + eur(x.potrosnja_7) + (proizvod === "kuverta" ? ", " + x.registracije_7 + " reg." : "") + " · " + OZNAKE[x.stanje] + ". " + x.razlog);
      if (x.stanje === "prijedlog_pauza" && idPo[x.ad_id]) linija.push("  Pauziraj ili ostavi: " + domena + "/meta/odobri?id=" + idPo[x.ad_id]);
    }
  };
  grupa("kuverta", "Kuverta");
  grupa("cestitka", "Božićna čestitka");
  const n = stanja.filter((x) => x.stanje === "prijedlog_pauza").length;
  linija.push("", "Registracije su naše (baza Kuverte, po utm_content). Alat ne mijenja budžete i ništa ne pauzira bez tvog klika.");
  return { naslov: "Oglasi: " + (n ? n + (n === 1 ? " prijedlog za pauzu" : " prijedloga za pauzu") : "sve u redu") + " · Kuverta " + eur(jucer.kuverta), tekst: linija.join("\n") };
}

// ---------- Mreža ----------

async function graf(env, put, parametri = {}, metoda = "GET") {
  const url = put.startsWith("http") ? put : META_API + put + (metoda === "GET" && Object.keys(parametri).length ? "?" + new URLSearchParams(parametri) : "");
  const r = await fetch(url, {
    method: metoda,
    headers: { authorization: "Bearer " + env.META_ADS_TOKEN, ...(metoda === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: metoda === "POST" ? new URLSearchParams(parametri) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error("Meta: " + ((j.error && j.error.message) || r.status));
  return j;
}

// Sve stranice odgovora (paging.next).
async function sve(env, put, parametri) {
  let j = await graf(env, put, parametri), out = [...(j.data || [])];
  for (let i = 0; i < 20 && j.paging && j.paging.next; i++) { j = await graf(env, j.paging.next); out.push(...(j.data || [])); }
  return out;
}

export function racun(env) {
  return "act_" + String(env.META_OGLASNI_RACUN || "").replace(/^act_/, "").trim();
}

const zg = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });

export async function dozvole(env) {
  const j = await graf(env, "me/permissions");
  return (j.data || []).filter((x) => x.status === "granted").map((x) => x.permission);
}

// Jutarnji posao. rpcNadzor(fn, args) zove funkcije u bazi nadzora, oznakeKuverta() vraća naše oznake poveznica (7 dana).
export async function metaJutro(env, { rpcNadzor, oznakeKuverta, posaljiMail, domena }) {
  if (!env.META_ADS_TOKEN || !env.META_OGLASNI_RACUN) return "nije postavljeno";
  const p = postavke(env);
  const danas = zg(Date.now());
  const jucer = zg(Date.now() - 864e5);
  const od7 = zg(Date.now() - 7 * 864e5);
  const polja = "ad_id,ad_name,campaign_name,adset_name,impressions,reach,clicks,spend,cpm,ctr,frequency,actions";
  const proizvod = (x) => (jeCestitka(env, x.campaign_name, x.ad_name) ? "cestitka" : "kuverta");
  const redak = (x) => ({
    ad_id: x.ad_id, ad_name: x.ad_name, campaign_name: x.campaign_name, adset: x.adset_name, proizvod: proizvod(x),
    impressions: broj(x.impressions), reach: broj(x.reach), clicks: broj(x.clicks), spend: broj(x.spend),
    cpm: broj(x.cpm), ctr: broj(x.ctr), frequency: broj(x.frequency),
    meta_registracije: akcija(x, REG), meta_kupnje: akcija(x, KUP),
  });

  // 1. Dnevni retci za zadnjih 7 dana (Meta ispravlja zadnje dane, pa se prepisuju).
  const dnevno = await sve(env, racun(env) + "/insights", { level: "ad", fields: polja, time_increment: "1", time_range: JSON.stringify({ since: od7, until: jucer }), limit: "500" });
  const dani = dnevno.map((x) => ({ datum: x.date_start, ...redak(x) }));
  if (dani.length) await rpcNadzor("nadzor_meta_upis", { p_redovi: dani });

  // 2. Zbroj 7 dana po oglasu (doseg i frekvencija se ne mogu zbrajati po danima) i popis aktivnih oglasa.
  const [zbroj, oglasi, oznake] = await Promise.all([
    sve(env, racun(env) + "/insights", { level: "ad", fields: polja, time_range: JSON.stringify({ since: od7, until: jucer }), limit: "500" }),
    sve(env, racun(env) + "/ads", { fields: "id,name,effective_status", effective_status: JSON.stringify(["ACTIVE"]), limit: "500" }),
    oznakeKuverta().catch(() => []),
  ]);
  const aktivni = new Set(oglasi.map((x) => x.id));
  const nase = spojiNase(oglasi.map((x) => ({ id: x.id, ime: x.name })), oznake);
  const stanja = ocijeni(zbroj.map(redak), aktivni, nase, p, danas);
  const prijedlozi = stanja.length ? await rpcNadzor("nadzor_meta_stanje_upis", { p_redovi: stanja }) : [];

  // 3. Mail.
  const jucerPotrosnja = { kuverta: 0, cestitka: 0 };
  for (const d of dani) if (d.datum === jucer) jucerPotrosnja[d.proizvod] += d.spend;
  if (stanja.length || jucerPotrosnja.kuverta || jucerPotrosnja.cestitka) {
    const m = sastaviMail({ stanja, jucer: jucerPotrosnja, p, prijedlozi, domena, datumJucer: jucer.split("-").reverse().join(". ") + "." });
    await posaljiMail(m.naslov, m.tekst);
  }
  return dani.length + " dnevnih redaka, " + stanja.length + " aktivnih oglasa, " + (prijedlozi || []).length + " prijedloga";
}

// Pauza jednog oglasa (nakon Brunina klika). Vraća novi status iz Mete.
export async function pauziraj(env, adId) {
  if (!/^\d+$/.test(String(adId))) throw new Error("Neispravan ID oglasa.");
  await graf(env, String(adId), { status: "PAUSED" }, "POST");
  const j = await graf(env, String(adId), { fields: "effective_status" });
  return j.effective_status;
}

// ---------- Ekran Oglasi: kampanje → oglasni skupovi → oglasi ----------

const PLACENI = ["paid", "paid_social", "cpc"];
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const baza = (t) => String(t || "").split(/\s+[-–—|]\s+/)[0].trim();

// Naše oznake (utm) spoji s oglasima: po ID-u oglasa (utm_content={{ad.id}}), a ručne oznake (oglas1) po imenu oglasa
// bez verzije i znakova (oglas1 = "Oglas 1 - Paket"), kao poOglasu na stranici. Vraća { ad_id: {posjete, registracije, kupnje, prihod} }.
export function spojiNase(oglasi, oznake) {
  const po = {}, ids = new Set(oglasi.map((a) => a.id));
  const prazno = () => ({ posjete: 0, registracije: 0, kupnje: 0, prihod: 0 });
  const dodaj = (id, x) => { const p = po[id] || (po[id] = prazno()); for (const k of ["posjete", "registracije", "kupnje", "prihod"]) p[k] += Number(x[k] || 0); };
  const bez = [];
  for (const x of oznake || []) {
    if (!PLACENI.includes(x.medij) || !x.oglas) continue;
    if (ids.has(String(x.oglas))) dodaj(String(x.oglas), x); else bez.push(x);
  }
  for (const x of bez) {
    const kl = norm(x.oglas);
    // Ručnu oznaku dobije najnoviji oglas tog imena (najveći ID), da se ne broji dvaput.
    const kandidati = oglasi.filter((a) => norm(baza(a.ime)) === kl).sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
    if (kandidati.length) dodaj(kandidati[0].id, x);
  }
  return po;
}

const metrike = (x) => x ? {
  potrosnja: broj(x.spend), prikazi: broj(x.impressions), doseg: broj(x.reach), klikovi: broj(x.inline_link_clicks || x.clicks),
  cpm: broj(x.cpm), ctr: broj(x.inline_link_click_ctr || x.ctr), frekvencija: broj(x.frequency),
  meta_registracije: akcija(x, REG), meta_kupnje: akcija(x, KUP),
} : null;

// Dnevni budžet u eurima: kampanja s budžetom na razini kampanje (CBO) ili zbroj aktivnih skupova aktivne kampanje.
// prom: { id: "ACTIVE"|"PAUSED" } simulira promjenu prije provjere granice.
export function dnevniBudzet(kampanje, skupovi, proizvod, prom = {}) {
  const st = (x) => prom[x.id] || x.status;
  let c = 0;
  for (const k of kampanje) {
    if (k.proizvod !== proizvod || st(k) !== "ACTIVE") continue;
    if (Number(k.daily_budget)) { c += Number(k.daily_budget); continue; }
    for (const s of skupovi) if (s.campaign_id === k.id && st(s) === "ACTIVE") c += Number(s.daily_budget || 0);
  }
  return c / 100;
}

async function struktura(env) {
  const [kampanje, skupovi, oglasi] = await Promise.all([
    sve(env, racun(env) + "/campaigns", { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,objective", limit: "200" }),
    sve(env, racun(env) + "/adsets", { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget", limit: "500" }),
    sve(env, racun(env) + "/ads", { fields: "id,name,adset_id,campaign_id,status,effective_status,creative{thumbnail_url}", limit: "500" }),
  ]);
  const proizvodK = Object.fromEntries(kampanje.map((k) => [k.id, jeCestitka(env, k.name) ? "cestitka" : "kuverta"]));
  for (const k of kampanje) k.proizvod = proizvodK[k.id];
  for (const s of skupovi) s.proizvod = proizvodK[s.campaign_id] || "kuverta";
  return { kampanje, skupovi, oglasi };
}

export async function oglasiPregled(env, { dana, oznakeKuverta, oznakeCestitka, stanjaOglasa }) {
  if (!env.META_ADS_TOKEN || !env.META_OGLASNI_RACUN) return { postavljeno: false };
  const p = postavke(env);
  const danas = zg(Date.now()), od = zg(Date.now() - (dana - 1) * 864e5);
  const tr = JSON.stringify({ since: od, until: danas });
  const polja = "impressions,reach,clicks,inline_link_clicks,inline_link_click_ctr,spend,cpm,ctr,frequency,actions";
  const [s, insK, insS, insO, dnevno, nK, nC, stanja] = await Promise.all([
    struktura(env),
    sve(env, racun(env) + "/insights", { level: "campaign", fields: "campaign_id," + polja, time_range: tr, limit: "500" }),
    sve(env, racun(env) + "/insights", { level: "adset", fields: "adset_id," + polja, time_range: tr, limit: "500" }),
    sve(env, racun(env) + "/insights", { level: "ad", fields: "ad_id," + polja, time_range: tr, limit: "500" }),
    sve(env, racun(env) + "/insights", { level: "campaign", fields: "campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions", time_increment: "1", time_range: tr, limit: "500" }),
    oznakeKuverta().catch(() => []),
    oznakeCestitka().catch(() => []),
    stanjaOglasa().catch(() => []),
  ]);
  const mK = Object.fromEntries(insK.map((x) => [x.campaign_id, x]));
  const mS = Object.fromEntries(insS.map((x) => [x.adset_id, x]));
  const mO = Object.fromEntries(insO.map((x) => [x.ad_id, x]));
  const ocjena = Object.fromEntries((stanja || []).map((x) => [x.ad_id, x]));
  const oglasi = s.oglasi.map((a) => ({ id: a.id, ime: a.name, adset_id: a.adset_id, campaign_id: a.campaign_id, status: a.status, ef: a.effective_status,
    slika: (a.creative && a.creative.thumbnail_url) || "" }));
  const proizvodK = Object.fromEntries(s.kampanje.map((k) => [k.id, k.proizvod]));
  const nase = { ...spojiNase(oglasi.filter((a) => proizvodK[a.campaign_id] === "kuverta"), nK), ...spojiNase(oglasi.filter((a) => proizvodK[a.campaign_id] === "cestitka"), nC) };
  const zbrojN = (lista) => lista.reduce((a, x) => { for (const k in a) a[k] += x.n[k]; return a; }, { posjete: 0, registracije: 0, kupnje: 0, prihod: 0 });
  // Bez prometa u razdoblju i bez aktivnog stanja nema smisla prikazivati (stare arhivirane kampanje).
  const vazno = (x) => x.m || x.status === "ACTIVE";
  const kampanje = s.kampanje.map((k) => {
    const skupovi = s.skupovi.filter((x) => x.campaign_id === k.id).map((x) => {
      const og = oglasi.filter((a) => a.adset_id === x.id).map((a) => {
        const o = ocjena[a.id];
        return { ...a, m: metrike(mO[a.id]), n: nase[a.id] || { posjete: 0, registracije: 0, kupnje: 0, prihod: 0 },
          ocjena: o ? { stanje: o.stanje, razlog: o.razlog, datum: o.datum, id: o.stanje === "prijedlog_pauza" && o.odobreno == null ? o.id : null } : null };
      }).filter(vazno);
      return { id: x.id, ime: x.name, status: x.status, ef: x.effective_status, dnevni_budzet: Number(x.daily_budget || 0) / 100, m: metrike(mS[x.id]), n: zbrojN(og), oglasi: og };
    }).filter((x) => vazno(x) || x.oglasi.length);
    return { id: k.id, ime: k.name, status: k.status, ef: k.effective_status, proizvod: k.proizvod, cilj: k.objective,
      dnevni_budzet: Number(k.daily_budget || 0) / 100, m: metrike(mK[k.id]), n: zbrojN(skupovi), skupovi };
  }).filter((k) => vazno(k) || k.skupovi.length);
  kampanje.sort((a, b) => (b.status === "ACTIVE") - (a.status === "ACTIVE") || ((b.m && b.m.potrosnja) || 0) - ((a.m && a.m.potrosnja) || 0));
  const dani = {};
  for (const x of dnevno) {
    const d = dani[x.date_start] || (dani[x.date_start] = { datum: x.date_start, kuverta: { potrosnja: 0, klikovi: 0, meta_registracije: 0 }, cestitka: { potrosnja: 0, klikovi: 0, meta_registracije: 0 } });
    const g = d[proizvodK[x.campaign_id] || (jeCestitka(env, x.campaign_name) ? "cestitka" : "kuverta")];
    g.potrosnja += broj(x.spend); g.klikovi += broj(x.inline_link_clicks); g.meta_registracije += akcija(x, REG);
  }
  return {
    postavljeno: true, od, do: danas, dana, granice: { kuverta: p.budzetKuverta, cestitka: p.budzetCestitka },
    budzet: { kuverta: dnevniBudzet(s.kampanje, s.skupovi, "kuverta"), cestitka: dnevniBudzet(s.kampanje, s.skupovi, "cestitka") },
    kampanje, dani: Object.values(dani).sort((a, b) => (a.datum < b.datum ? -1 : 1)),
  };
}

// Paljenje i gašenje kampanje, skupa ili oglasa. Gašenje je uvijek dopušteno. Paljenje kampanje ili skupa se odbije
// ako bi zbroj dnevnih budžeta aktivnih kampanja tog proizvoda prešao granicu (META_BUDZET_*).
export async function promijeniStatus(env, { id, razina, ukljuci }) {
  if (!/^\d+$/.test(String(id || ""))) throw new Error("Neispravan ID.");
  if (!["kampanja", "skup", "oglas"].includes(razina)) throw new Error("Neispravna razina.");
  const status = ukljuci ? "ACTIVE" : "PAUSED";
  if (ukljuci && razina !== "oglas") {
    const s = await struktura(env);
    const x = (razina === "kampanja" ? s.kampanje : s.skupovi).find((y) => y.id === String(id));
    if (!x) throw new Error("Nema ga na oglasnom računu.");
    const p = postavke(env), proizvod = x.proizvod, granica = proizvod === "cestitka" ? p.budzetCestitka : p.budzetKuverta;
    const prije = dnevniBudzet(s.kampanje, s.skupovi, proizvod), poslije = dnevniBudzet(s.kampanje, s.skupovi, proizvod, { [id]: "ACTIVE" });
    if (poslije > granica + 0.001 && poslije > prije) {
      const e = new Error("Ne palim: dnevni budžet " + (proizvod === "cestitka" ? "Čestitke" : "Kuverte") + " bio bi " + poslije.toLocaleString("hr-HR") + " €, a granica je " + granica + " €. Smanji budžet u Ads Manageru ili ugasi nešto drugo.");
      e.status = 409;
      throw e;
    }
  }
  await graf(env, String(id), { status }, "POST");
  const j = await graf(env, String(id), { fields: "status,effective_status" });
  return { id: String(id), status: j.status, ef: j.effective_status };
}
