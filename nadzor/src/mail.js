// Privici iz e-maila (MIME) i XML datoteke iz ZIP-a, za automatski uvoz izvoda.
// Bez vanjskih paketa: Worker se objavljuje bez instalacije ovisnosti.
//
// privitci(bajtovi) -> [{ naziv, vrsta, bajtovi }]  (svi listovi poruke koji imaju ime datoteke)
// xmlIzZipa(bajtovi) -> Promise<[{ naziv, bajtovi }]>  (samo datoteke koje završavaju na .xml)
// procitajMail(bajtovi) -> { zaglavlja, naslov, od, za, ..., tekst, html, privitci }  (za sandučić, ekran Pošta)

// Bajtovi u "binarni" string (jedan znak = jedan bajt) i natrag, da pomaci ostanu točni.
function uTekst(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return s;
}
function uBajtove(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function base64(s) {
  // Samo znakovi abecede; punjenje (=) se doda koliko treba, a višak na kraju odbaci.
  let cist = s.replace(/[^A-Za-z0-9+/]/g, "");
  if (cist.length % 4 === 1) cist = cist.slice(0, -1);
  return uBajtove(atob(cist + "===".slice(0, (4 - (cist.length % 4)) % 4)));
}
function quotedPrintable(s) {
  return uBajtove(s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
}

// "=?utf-8?B?...?=" i "=?utf-8?Q?...?=" u zaglavljima (RFC 2047).
function dekodirajRijeci(s) {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (cijeli, kod, vrsta, t) => {
    try {
      const b = vrsta.toLowerCase() === "b" ? base64(t) : quotedPrintable(t.replace(/_/g, " "));
      return new TextDecoder(kod.toLowerCase()).decode(b);
    } catch (_) {
      return cijeli;
    }
  });
}

function zaglavlja(tekst) {
  const z = {};
  const redovi = tekst.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  for (const r of redovi) {
    const i = r.indexOf(":");
    if (i > 0) {
      const k = r.slice(0, i).trim().toLowerCase();
      if (!(k in z)) z[k] = r.slice(i + 1).trim();
    }
  }
  return z;
}

// 'attachment; filename="a.xml"' -> {vrijednost: "attachment", filename: "a.xml"}; podržava i filename*=utf-8''...
function parametri(v) {
  const dijelovi = { vrijednost: "" };
  if (!v) return dijelovi;
  const re = /;\s*([^=\s;]+)\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]*)/g;
  dijelovi.vrijednost = v.split(";")[0].trim().toLowerCase();
  const nastavci = {};
  let m;
  while ((m = re.exec(v))) {
    const ime = m[1].toLowerCase();
    let vr = m[3] !== undefined ? m[3].replace(/\\(.)/g, "$1") : m[2].trim();
    const n = /^(.+?)\*(\d+)?(\*)?$/.exec(ime);
    if (n) {
      if (n[3] || (!n[2] && ime.endsWith("*"))) {
        const p = /^([^']*)'[^']*'(.*)$/.exec(vr);
        try {
          vr = p ? new TextDecoder(p[1] || "utf-8").decode(uBajtove(unescape(p[2]))) : decodeURIComponent(vr);
        } catch (_) { /* ostavi kako jest */ }
      }
      (nastavci[n[1]] = nastavci[n[1]] || [])[Number(n[2] || 0)] = vr;
    } else dijelovi[ime] = dekodirajRijeci(vr);
  }
  for (const k in nastavci) dijelovi[k] = nastavci[k].join("");
  return dijelovi;
}

// Svi listovi poruke (dijelovi koji nisu multipart), redom kako su u mailu.
function listovi(tekst, izlaz, dubina) {
  if (dubina > 10) return;
  const kraj = /\r?\n\r?\n/.exec(tekst);
  const glava = kraj ? tekst.slice(0, kraj.index) : tekst;
  const tijelo = kraj ? tekst.slice(kraj.index + kraj[0].length) : "";
  const z = zaglavlja(glava);
  const ct = parametri(z["content-type"] || "text/plain");
  if (ct.vrijednost.startsWith("multipart/") && ct.boundary) {
    const granica = "--" + ct.boundary;
    const komadi = tijelo.split(granica);
    for (let i = 1; i < komadi.length; i++) {
      if (komadi[i].startsWith("--")) break;
      listovi(komadi[i].replace(/^[ \t]*\r?\n/, "").replace(/\r?\n$/, ""), izlaz, dubina + 1);
    }
    return;
  }
  if (ct.vrijednost === "message/rfc822") return listovi(tijelo, izlaz, dubina + 1);
  const cd = parametri(z["content-disposition"] || "");
  const kod = (z["content-transfer-encoding"] || "").toLowerCase();
  const bajtovi = () => kod === "base64" ? base64(tijelo) : kod === "quoted-printable" ? quotedPrintable(tijelo) : uBajtove(tijelo);
  izlaz.push({
    naziv: cd.filename || ct.name || "",
    vrsta: ct.vrijednost || "text/plain",
    charset: ct.charset || "",
    privitak: cd.vrijednost === "attachment",
    cid: (z["content-id"] || "").replace(/^\s*<|>\s*$/g, ""),
    bajtovi,
  });
}

export function privitci(bajtovi) {
  const svi = [];
  listovi(uTekst(bajtovi), svi, 0);
  return svi.filter((l) => l.naziv).map((l) => ({ naziv: l.naziv, vrsta: l.vrsta, bajtovi: l.bajtovi() }));
}

function dekodirajTekst(b, charset) {
  const kod = (charset || "utf-8").toLowerCase();
  try {
    return new TextDecoder(kod).decode(b);
  } catch (_) {
    // Nepoznat charset: probaj UTF-8, a ako ne prođe, latin1 (svaki bajt je znak).
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch (_) {
      return uTekst(b);
    }
  }
}

// Zaglavlja su pročitana bajt po bajt; ako je pošiljatelj u njih upisao UTF-8 bez kodiranja (RFC 6532), vrati ga u prava slova.
function utf8AkoMoze(s) {
  if (!/[\x80-\xff]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(uBajtove(s));
  } catch (_) {
    return s;
  }
}

const ENTITETI = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// Grubi tekst iz HTML-a: za pretraživanje i za mail koji nema tekstualni dio.
export function tekstIzHtmla(html) {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (c, k) => {
      if (k[0] === "#") {
        const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        try { return String.fromCodePoint(n); } catch (_) { return c; }
      }
      return ENTITETI[k.toLowerCase()] ?? c;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n\n")
    .trim();
}

// Adrese iz zaglavlja ("Ime <a@b.hr>, c@d.hr") -> ["a@b.hr", "c@d.hr"].
export function adrese(v) {
  return (String(v || "").match(/[^\s<>",;:()]+@[^\s<>",;:()]+/g) || []).map((a) => a.toLowerCase());
}

// Rezultati SPF, DKIM i DMARC iz zaglavlja Authentication-Results (Cloudflare ga dodaje), npr. "spf=pass dkim=pass dmarc=pass".
function provjeraPosiljatelja(v) {
  const t = String(v || "");
  return ["spf", "dkim", "dmarc"].map((k) => {
    const m = new RegExp("\\b" + k + "=([a-z]+)", "i").exec(t);
    return m ? k + "=" + m[1].toLowerCase() : "";
  }).filter(Boolean).join(" ");
}

// Cijeli mail za sandučić: dekodirana zaglavlja, tekst, HTML i privitci (s bajtovima na zahtjev).
// Dio bez imena datoteke koji je text/plain ili text/html smatra se tijelom poruke (prvi takav),
// a slike u HTML-u (Content-ID) i svi ostali dijelovi su privitci.
export function procitajMail(bajtovi) {
  const tekst = uTekst(bajtovi);
  const kraj = /\r?\n\r?\n/.exec(tekst);
  const z = zaglavlja(kraj ? tekst.slice(0, kraj.index) : tekst);
  const svi = [];
  listovi(tekst, svi, 0);
  let obicni = null, html = null;
  const priv = [];
  for (const l of svi) {
    if (!l.naziv && !l.privitak && l.vrsta === "text/plain" && obicni === null) obicni = dekodirajTekst(l.bajtovi(), l.charset);
    else if (!l.naziv && !l.privitak && l.vrsta === "text/html" && html === null) html = dekodirajTekst(l.bajtovi(), l.charset);
    else priv.push(l);
  }
  const h = (k) => dekodirajRijeci(utf8AkoMoze(z[k] || ""));
  let poslano = null;
  const d = Date.parse(z["date"] || "");
  if (!isNaN(d)) poslano = new Date(d).toISOString();
  return {
    zaglavlja: z,
    od: h("from"),
    za: h("to"),
    kopija: h("cc"),
    odgovor_na: h("reply-to"),
    naslov: h("subject"),
    poslano,
    message_id: (z["message-id"] || "").trim(),
    provjera: provjeraPosiljatelja(z["authentication-results"]),
    tekst: obicni !== null ? obicni.replace(/\r\n/g, "\n") : (html !== null ? tekstIzHtmla(html) : ""),
    html,
    privitci: priv.map((l, i) => ({
      i,
      naziv: l.naziv || (l.cid ? "slika-" + (i + 1) : "dio-" + (i + 1)) + (l.naziv ? "" : nastavak(l.vrsta)),
      vrsta: l.vrsta,
      cid: l.cid,
      bajtovi: l.bajtovi,
    })),
  };
}

function nastavak(vrsta) {
  return { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "text/plain": ".txt", "text/html": ".html", "text/calendar": ".ics", "message/delivery-status": ".txt" }[vrsta] || "";
}

export function jeZip(b) {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

const NAJVISE_RASPAKIRANO = 20 * 1024 * 1024;

async function inflate(b) {
  const tok = new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const r = tok.getReader();
  const dijelovi = [];
  let ukupno = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    ukupno += value.length;
    if (ukupno > NAJVISE_RASPAKIRANO) {
      await r.cancel();
      throw new Error("ZIP je raspakiran veći od 20 MB.");
    }
    dijelovi.push(value);
  }
  const izlaz = new Uint8Array(ukupno);
  let p = 0;
  for (const d of dijelovi) {
    izlaz.set(d, p);
    p += d.length;
  }
  return izlaz;
}

// Čita središnji direktorij ZIP-a; podržava zapise bez sažimanja (0) i deflate (8).
export async function xmlIzZipa(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP je oštećen (nema kraja direktorija).");
  const broj = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const izlaz = [];
  let ukupno = 0;
  for (let n = 0; n < broj; n++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP je oštećen (direktorij).");
    const zastavice = dv.getUint16(p + 8, true);
    const metoda = dv.getUint16(p + 10, true);
    const sazeto = dv.getUint32(p + 20, true);
    const dImena = dv.getUint16(p + 28, true), dDodatka = dv.getUint16(p + 30, true), dKomentara = dv.getUint16(p + 32, true);
    const lokalno = dv.getUint32(p + 42, true);
    const imeB = b.subarray(p + 46, p + 46 + dImena);
    const naziv = (zastavice & 0x800) ? new TextDecoder().decode(imeB) : uTekst(imeB);
    p += 46 + dImena + dDodatka + dKomentara;
    if (!/\.xml$/i.test(naziv) || naziv.endsWith("/")) continue;
    if (zastavice & 1) throw new Error("ZIP je zaključan lozinkom: " + naziv);
    if (dv.getUint32(lokalno, true) !== 0x04034b50) throw new Error("ZIP je oštećen (zapis " + naziv + ").");
    const start = lokalno + 30 + dv.getUint16(lokalno + 26, true) + dv.getUint16(lokalno + 28, true);
    const podaci = b.subarray(start, start + sazeto);
    let sadrzaj;
    if (metoda === 0) sadrzaj = podaci;
    else if (metoda === 8) sadrzaj = await inflate(podaci);
    else throw new Error("ZIP koristi nepodržano sažimanje (" + metoda + "): " + naziv);
    ukupno += sadrzaj.length;
    if (ukupno > NAJVISE_RASPAKIRANO) throw new Error("ZIP je raspakiran veći od 20 MB.");
    izlaz.push({ naziv: naziv.split("/").pop(), bajtovi: sadrzaj });
  }
  return izlaz;
}

// Pošiljatelj s popisa: točna adresa ili domena ("@pbz.hr"). Prazan popis pušta sve.
export function posiljateljDopusten(adresa, dopusteni) {
  const a = String(adresa || "").trim().toLowerCase();
  if (!dopusteni.length) return true;
  return dopusteni.some((d) => {
    d = d.toLowerCase();
    return d.startsWith("@") ? a.endsWith(d) : a === d;
  });
}

// PBZ (i druge banke preko FINA-e) šalje izvod u potpisanoj omotnici .sgn:
// <FileUpload><File compress="zip" encoding="base64"><![CDATA[...]]></File><Signer>...</Signer></FileUpload>.
// Vraća sadržaj datoteke (najčešće ZIP s CAMT.053) ili null ako to nije takva omotnica.
// Potpis banke se ovdje ne provjerava.
export function izOmotnice(b) {
  const pocetak = uTekst(b.subarray(0, 4096));
  if (!/<FileUpload[\s>]/.test(pocetak)) return null;
  const t = uTekst(b);
  const m = /<File\b([^>]*)>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))\s*<\/File>/.exec(t);
  if (!m) throw new Error("Omotnica izvoda (.sgn) nema datoteku.");
  const atributi = m[1];
  const sadrzaj = m[2] !== undefined ? m[2] : m[3];
  if (/encoding\s*=\s*["']base64["']/i.test(atributi)) return base64(sadrzaj);
  return uBajtove(sadrzaj.trim());
}

// Popis id-jeva iz zahtjeva: 1 do 500 pozitivnih cijelih brojeva, inače null.
export function idsIz(x) {
  if (!Array.isArray(x) || !x.length || x.length > 500) return null;
  const ids = x.map(Number);
  return ids.every((n) => Number.isInteger(n) && n > 0) ? [...new Set(ids)] : null;
}

// Vrsta privitka po prvim bajtovima (slike i PDF), za pregled na stranici. SVG se namjerno ne prikazuje (može imati skriptu).
export function vrstaZaPregled(b) {
  const p = (...x) => x.every((v, i) => b[i] === v);
  if (p(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (p(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (p(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (p(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (p(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}
