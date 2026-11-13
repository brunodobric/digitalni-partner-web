// Privici iz e-maila (MIME) i XML datoteke iz ZIP-a, za automatski uvoz izvoda.
// Bez vanjskih paketa: Worker se objavljuje bez instalacije ovisnosti.
//
// privitci(bajtovi) -> [{ naziv, vrsta, bajtovi }]  (svi listovi poruke koji imaju ime datoteke)
// xmlIzZipa(bajtovi) -> Promise<[{ naziv, bajtovi }]>  (samo datoteke koje završavaju na .xml)

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

function dio(tekst, izlaz, dubina) {
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
      dio(komadi[i].replace(/^[ \t]*\r?\n/, "").replace(/\r?\n$/, ""), izlaz, dubina + 1);
    }
    return;
  }
  if (ct.vrijednost === "message/rfc822") return dio(tijelo, izlaz, dubina + 1);
  const cd = parametri(z["content-disposition"] || "");
  const naziv = cd.filename || ct.name;
  if (!naziv) return;
  const kod = (z["content-transfer-encoding"] || "").toLowerCase();
  const bajtovi = kod === "base64" ? base64(tijelo) : kod === "quoted-printable" ? quotedPrintable(tijelo) : uBajtove(tijelo);
  izlaz.push({ naziv, vrsta: ct.vrijednost, bajtovi });
}

export function privitci(bajtovi) {
  const izlaz = [];
  dio(uTekst(bajtovi), izlaz, 0);
  return izlaz;
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
