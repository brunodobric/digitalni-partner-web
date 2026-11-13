// Čitač bankovnih izvoda u formatu CAMT.053 (ISO 20022, BkToCstmrStmt), verzije .001.02 do .001.13.
// Workers nemaju DOMParser, pa je ovdje mali XML parser: elementi, atributi, tekst, CDATA,
// komentari i znakovni entiteti. DOCTYPE se odbija (izvodi ga nemaju, a s njim dolaze
// vanjski entiteti). Prefiksi imenskih prostora se zanemaruju jer su nazivi u CAMT-u jedinstveni.
//
// citajCamt053(xml) vraća niz izvoda (jedna datoteka može imati više računa ili dana):
// { oznaka, redniBroj, izraden, od, do, iban, valuta, vlasnik, banka,
//   pocetno: {centi, datum} | null, zavrsno: {centi, datum}, raspolozivo: {centi, datum} | null,
//   uskladeno, stavke: [{ rb, iznosCenti, knjizeno, datumValute, status, storno, protustrana,
//   protustranaIban, opis, pozivNaBroj, referenca, e2e, brojTransakcija }] }
// Iznosi su cijeli centi s predznakom: priljev pozitivan, odljev negativan.

const ENTITETI = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function dekodiraj(s) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (cijeli, k) => {
    if (k[0] === "#") {
      const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : cijeli;
    }
    return Object.prototype.hasOwnProperty.call(ENTITETI, k) ? ENTITETI[k] : cijeli;
  });
}

function lokalno(ime) {
  const i = ime.indexOf(":");
  return i < 0 ? ime : ime.slice(i + 1);
}

// Vraća korijenski čvor {n, a, c, t}: ime bez prefiksa, atributi, djeca, tekst.
export function parsirajXml(xml) {
  const korijen = { n: "#", a: {}, c: [], t: "" };
  const stog = [korijen];
  let i = 0;
  const L = xml.length;
  if (xml.charCodeAt(0) === 0xfeff) i = 1;
  while (i < L) {
    const lt = xml.indexOf("<", i);
    const vrh = stog[stog.length - 1];
    if (lt < 0) {
      if (xml.slice(i).trim()) throw new Error("Tekst izvan elementa na kraju datoteke.");
      break;
    }
    if (lt > i) vrh.t += dekodiraj(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const k = xml.indexOf("-->", lt + 4);
      if (k < 0) throw new Error("Nezatvoren komentar.");
      i = k + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const k = xml.indexOf("]]>", lt + 9);
      if (k < 0) throw new Error("Nezatvoren CDATA.");
      vrh.t += xml.slice(lt + 9, k);
      i = k + 3;
    } else if (xml.startsWith("<?", lt)) {
      const k = xml.indexOf("?>", lt + 2);
      if (k < 0) throw new Error("Nezatvorena XML deklaracija.");
      i = k + 2;
    } else if (xml.startsWith("<!", lt)) {
      throw new Error("DOCTYPE i deklaracije nisu dopušteni u izvodu.");
    } else if (xml[lt + 1] === "/") {
      const k = xml.indexOf(">", lt);
      if (k < 0) throw new Error("Nezatvorena oznaka.");
      const ime = lokalno(xml.slice(lt + 2, k).trim());
      if (stog.length < 2 || vrh.n !== ime) {
        throw new Error("Neispravan XML: zatvara se </" + ime + ">, a otvoren je <" + vrh.n + ">.");
      }
      stog.pop();
      i = k + 1;
    } else {
      // Otvaranje elementa; kraj traži ">" izvan navodnika.
      let k = lt + 1, navod = "";
      while (k < L) {
        const ch = xml[k];
        if (navod) {
          if (ch === navod) navod = "";
        } else if (ch === '"' || ch === "'") navod = ch;
        else if (ch === ">") break;
        k++;
      }
      if (k >= L) throw new Error("Nezatvorena oznaka.");
      let tijelo = xml.slice(lt + 1, k);
      const prazan = tijelo.endsWith("/");
      if (prazan) tijelo = tijelo.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(tijelo);
      if (!m) throw new Error("Element bez imena.");
      const cvor = { n: lokalno(m[1]), a: {}, c: [], t: "" };
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = re.exec(tijelo.slice(m[1].length)))) {
        cvor.a[lokalno(a[1])] = dekodiraj(a[3] !== undefined ? a[3] : a[4]);
      }
      if (stog.length === 1 && korijen.c.length) throw new Error("XML ima više korijenskih elemenata.");
      vrh.c.push(cvor);
      if (!prazan) stog.push(cvor);
      i = k + 1;
    }
  }
  if (stog.length !== 1) throw new Error("Neispravan XML: <" + stog[stog.length - 1].n + "> nije zatvoren.");
  if (!korijen.c.length) throw new Error("Datoteka nema XML sadržaja.");
  return korijen.c[0];
}

// Pomoćnici za kretanje po stablu: put je niz imena odvojen kosom crtom.
function sva(cvor, put) {
  let razina = cvor ? [cvor] : [];
  for (const ime of put.split("/")) {
    const sljedeca = [];
    for (const c of razina) for (const d of c.c) if (d.n === ime) sljedeca.push(d);
    razina = sljedeca;
  }
  return razina;
}
function jedan(cvor, put) {
  return sva(cvor, put)[0] || null;
}
function tekst(cvor, put) {
  const c = put ? jedan(cvor, put) : cvor;
  if (!c) return null;
  const t = c.t.trim();
  return t === "" ? null : t;
}
function prvi(cvor, putevi) {
  for (const p of putevi) {
    const t = tekst(cvor, p);
    if (t !== null) return t;
  }
  return null;
}

// "1234.5" -> 123450; iznos u CAMT-u ima najviše 5 decimala, a za valute s centima 2.
export function uCente(s) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
  if (!m) throw new Error("Neispravan iznos: " + s);
  const dec = (m[2] || "").padEnd(2, "0");
  if (/[1-9]/.test(dec.slice(2))) throw new Error("Iznos ima više od dvije decimale: " + s);
  const centi = Number(m[1]) * 100 + Number(dec.slice(0, 2));
  if (!Number.isSafeInteger(centi)) throw new Error("Iznos je prevelik: " + s);
  return centi;
}

function iznosSPredznakom(cvor) {
  const amt = jedan(cvor, "Amt");
  if (!amt) throw new Error("Nedostaje iznos (Amt).");
  const centi = uCente(amt.t);
  const ind = tekst(cvor, "CdtDbtInd");
  if (ind !== "CRDT" && ind !== "DBIT") throw new Error("Nepoznat smjer iznosa: " + ind);
  return { centi: ind === "DBIT" ? -centi : centi, valuta: amt.a.Ccy || null };
}

function datum(cvor, put) {
  const d = prvi(cvor, [put + "/Dt", put + "/DtTm"]);
  return d ? d.slice(0, 10) : null;
}

function salda(stmt) {
  const po = {};
  for (const b of sva(stmt, "Bal")) {
    const tip = prvi(b, ["Tp/CdOrPrtry/Cd", "Tp/CdOrPrtry/Prtry"]);
    if (!tip || po[tip]) continue;
    po[tip] = { centi: iznosSPredznakom(b).centi, datum: datum(b, "Dt") };
  }
  return po;
}

function stavka(ntry, rb) {
  const { centi } = iznosSPredznakom(ntry);
  const priljev = centi > 0;
  const tx = sva(ntry, "NtryDtls/TxDtls");
  const t = tx[0] || null;
  // Kod priljeva je druga strana platitelj (Dbtr), kod odljeva primatelj (Cdtr).
  // Do .001.07 ime je u Dbtr/Nm, od .001.08 u Dbtr/Pty/Nm.
  const strana = priljev ? "Dbtr" : "Cdtr";
  const protustrana = t
    ? prvi(t, ["RltdPties/" + strana + "/Nm", "RltdPties/" + strana + "/Pty/Nm", "RltdPties/Ultmt" + strana + "/Nm", "RltdPties/Ultmt" + strana + "/Pty/Nm"])
    : null;
  const protustranaIban = t ? prvi(t, ["RltdPties/" + strana + "Acct/Id/IBAN", "RltdPties/" + strana + "Acct/Id/Othr/Id"]) : null;
  const ustrd = t ? sva(t, "RmtInf/Ustrd").map((u) => tekst(u)).filter(Boolean).join(" ") : "";
  const opis = ustrd || (t && tekst(t, "AddtlTxInf")) || tekst(ntry, "AddtlNtryInf") || null;
  const sts = prvi(ntry, ["Sts/Cd", "Sts/Prtry", "Sts"]);
  return {
    rb,
    iznosCenti: centi,
    knjizeno: datum(ntry, "BookgDt"),
    datumValute: datum(ntry, "ValDt"),
    status: sts || "BOOK",
    storno: tekst(ntry, "RvslInd") === "true",
    protustrana,
    protustranaIban,
    opis,
    pozivNaBroj: t ? prvi(t, ["RmtInf/Strd/CdtrRefInf/Ref"]) : null,
    referenca: prvi(ntry, ["AcctSvcrRef", "NtryRef"]) || (t && prvi(t, ["Refs/AcctSvcrRef", "Refs/TxId"])),
    e2e: t ? tekst(t, "Refs/EndToEndId") : null,
    brojTransakcija: Math.max(1, tx.length),
  };
}

export function citajCamt053(xml) {
  const doc = parsirajXml(xml);
  const bk = doc.n === "BkToCstmrStmt" ? doc : jedan(doc, "BkToCstmrStmt");
  if (!bk) {
    const vrsta = doc.c[0] ? doc.c[0].n : doc.n;
    if (vrsta === "BkToCstmrAcctRpt") throw new Error("Ovo je CAMT.052 (dnevni izvještaj), a treba izvod CAMT.053.");
    if (vrsta === "BkToCstmrDbtCdtNtfctn") throw new Error("Ovo je CAMT.054 (obavijest), a treba izvod CAMT.053.");
    throw new Error("Datoteka nije izvod CAMT.053 (nema BkToCstmrStmt).");
  }
  const izvodi = sva(bk, "Stmt");
  if (!izvodi.length) throw new Error("Izvod nema nijedan račun (Stmt).");
  return izvodi.map((stmt) => {
    const iban = prvi(stmt, ["Acct/Id/IBAN", "Acct/Id/Othr/Id"]);
    if (!iban) throw new Error("Izvod nema IBAN računa.");
    const s = salda(stmt);
    const pocetno = s.OPBD || s.PRCD || null;
    const zavrsno = s.CLBD || null;
    if (!zavrsno) throw new Error("Izvod za " + iban + " nema završno stanje (CLBD).");
    const stavke = sva(stmt, "Ntry").map((n, i) => stavka(n, i + 1));
    const knjizene = stavke.filter((x) => x.status === "BOOK");
    const promet = knjizene.reduce((a, x) => a + x.iznosCenti, 0);
    const valuta = tekst(stmt, "Acct/Ccy") || (jedan(stmt, "Bal/Amt") || { a: {} }).a.Ccy || "EUR";
    const oznaka = tekst(stmt, "Id") || [iban, prvi(stmt, ["ElctrncSeqNb", "LglSeqNb"]), zavrsno.datum].join("/");
    return {
      oznaka,
      redniBroj: prvi(stmt, ["LglSeqNb", "ElctrncSeqNb"]),
      izraden: tekst(stmt, "CreDtTm"),
      od: (tekst(stmt, "FrToDt/FrDtTm") || pocetno?.datum || "").slice(0, 10) || null,
      do: (tekst(stmt, "FrToDt/ToDtTm") || zavrsno.datum || "").slice(0, 10) || null,
      iban: iban.replace(/\s+/g, "").toUpperCase(),
      valuta,
      vlasnik: prvi(stmt, ["Acct/Ownr/Nm", "Acct/Ownr/Pty/Nm"]),
      banka: prvi(stmt, ["Acct/Svcr/FinInstnId/Nm", "Acct/Svcr/FinInstnId/BICFI", "Acct/Svcr/FinInstnId/BIC"]),
      pocetno,
      zavrsno,
      raspolozivo: s.CLAV || null,
      // Početno stanje + knjiženi promet mora dati završno; ako ne daje, izvod je nepotpun.
      uskladeno: pocetno ? pocetno.centi + promet === zavrsno.centi : null,
      stavke,
    };
  });
}
