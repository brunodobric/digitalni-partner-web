#!/usr/bin/env python3
"""Slaže tri probne naslovnice (prijedlog-a/b/c.html) iz zajedničkih dijelova i fragmenata pojedinog prijedloga."""
import pathlib, re, sys

HERE = pathlib.Path(__file__).parent  # fragmenti a/, b/, c/
OUT = HERE.parent.parent  # korijen repozitorija

# Fotografije s Unsplasha (besplatna licenca, dopušteno izravno povezivanje na images.unsplash.com)
FOTO = {
    "salon-fen":     ("photo-1580618672591-eb180b1a973f", "Frizerka fenira klijentici kosu okruglom četkom"),
    "salon-skare":   ("photo-1700760934268-8aa0ef52ce0a", "Frizerka šiša mokru kosu škarama"),
    "salon-boja":    ("photo-1712213396688-c6f2d536671f", "Frizer nanosi boju na pramenove u foliji"),
    "kozm-maska":    ("photo-1570172619644-dfd03ed5d881", "Kozmetičarka nanosi masku za lice klijentici"),
    "kozm-nokti":    ("photo-1632345031435-8727f6897d53", "Manikura u salonu za nokte"),
    "masaza":        ("photo-1745327883508-b6cd32e5dde5", "Terapeutkinja masira leđa klijentu"),
    "trener":        ("photo-1758875569256-f37c438cac65", "Osobni trener prati klijenticu dok diže uteg"),
    "trener-plan":   ("photo-1758875569399-99a7d80ace43", "Trener i klijentica dogovaraju plan treninga"),
    "kafic":         ("photo-1507914372368-b2b085b925a1", "Vlasnica kafića za aparatom za kavu"),
    "kuhinja":       ("photo-1775403834271-619d9a264f0e", "Kuhar priprema jelo u kuhinji restorana"),
    "apartman":      ("photo-1760204741315-abfc98ce3bf5", "Soba apartmana s pogledom na more u sumrak"),
    "apartman-soba": ("photo-1512918580421-b2feee3b85a6", "Svijetla spavaća soba apartmana"),
    "mobitel":       ("photo-1785053370851-e64cbb6343bc", "Mlada žena gleda mobitel uz prozor s pogledom na grad"),
    "mobitel-kafic": ("photo-1790749871520-25b238a7ce94", "Žena razgovara na mobitel u kafiću"),
}

def src(key, w=1600, h=None, q=72):
    pid = FOTO[key][0]
    s = f"https://images.unsplash.com/{pid}?auto=format&fit=crop&w={w}&q={q}"
    if h: s += f"&h={h}"
    return s

def img(key, cls="", sizes="100vw", widths=(640, 960, 1400, 2000), eager=False, alt=None, ratio=None):
    """<img> sa srcsetom. ratio='3:2' reže fotografiju na taj omjer."""
    def u(w):
        h = None
        if ratio:
            a, b = map(int, ratio.split(":")); h = round(w * b / a)
        return src(key, w, h)
    srcset = ", ".join(f"{u(w)} {w}w" for w in widths)
    a = FOTO[key][1] if alt is None else alt
    load = 'fetchpriority="high"' if eager else 'loading="lazy"'
    c = f' class="{cls}"' if cls else ""
    return f'<img{c} src="{u(widths[-2])}" srcset="{srcset}" sizes="{sizes}" alt="{a}" {load} decoding="async">'

MAPA = '''<svg class="gp__map" viewBox="0 0 300 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="300" height="120" fill="#ECEAE4"/><rect x="190" y="10" width="80" height="45" rx="6" fill="#D9E3D6"/><rect x="20" y="14" width="60" height="36" rx="4" fill="#E1DED7"/><rect x="96" y="14" width="74" height="36" rx="4" fill="#E1DED7"/><rect x="20" y="74" width="80" height="36" rx="4" fill="#E1DED7"/><rect x="200" y="74" width="80" height="36" rx="4" fill="#E1DED7"/><path d="M-5 62 C 80 58, 160 68, 305 60" stroke="#fff" stroke-width="9" fill="none"/><path d="M180 -5 C 176 40, 184 80, 178 125" stroke="#fff" stroke-width="7" fill="none"/><path d="M110 -5 L 110 125" stroke="#fff" stroke-width="4" fill="none"/><g transform="translate(140 32)"><path d="M10 26s9-9.3 9-16.3C19 4.4 15 0 10 0S1 4.4 1 9.7C1 16.7 10 26 10 26z" fill="#0F3B33"/><circle cx="10" cy="10" r="3.4" fill="#C6A15B"/></g></svg>'''

SITES = {
    "salon":   dict(ime="Vaš salon", domena="vas-salon.hr", vrsta="Frizerski salon", naslov="Šišanje, bojanje i njega kose u Vašem kvartu",
                    hero="salon-fen", galerija=["salon-skare", "salon-boja", "kozm-nokti"], usluge=["Šišanje", "Bojanje", "Fen i styling", "Njega kose"],
                    cta="Rezervirajte termin", upit="frizer Trešnjevka", vrijeme="Otvoreno · zatvara u 20:00"),
    "kozmetika": dict(ime="Vaš studio", domena="vas-studio.hr", vrsta="Kozmetički salon", naslov="Njega lica, manikura i masaža na jednom mjestu",
                    hero="kozm-maska", galerija=["kozm-nokti", "masaza", "salon-fen"], usluge=["Tretmani lica", "Manikura", "Pedikura", "Masaža"],
                    cta="Rezervirajte tretman", upit="kozmetički salon blizu mene", vrijeme="Otvoreno · zatvara u 19:00"),
    "trener":  dict(ime="Vaš trening", domena="vas-trening.hr", vrsta="Osobni trener", naslov="Osobni treninzi jedan na jedan, uz plan koji pratimo zajedno",
                    hero="trener", galerija=["trener-plan", "trener", "masaza"], usluge=["Osobni trening", "Trening u paru", "Prvi razgovor", "Termini"],
                    cta="Dogovorite prvi trening", upit="osobni trener Zagreb", vrijeme="Otvoreno · zatvara u 21:00"),
    "kafic":   dict(ime="Vaš kafić", domena="vas-kafic.hr", vrsta="Kafić", naslov="Kava, doručak i kolači iz naše kuhinje",
                    hero="kafic", galerija=["kuhinja", "kafic", "mobitel-kafic"], usluge=["Jelovnik", "Doručak", "Rezervacija stola", "Kontakt"],
                    cta="Rezervirajte stol", upit="kafić s doručkom", vrijeme="Otvoreno · zatvara u 23:00"),
    "apartman": dict(ime="Vaš apartman", domena="vas-apartman.hr", vrsta="Apartman", naslov="Apartman s pogledom na more, dvije minute od plaže",
                    hero="apartman", galerija=["apartman-soba", "apartman", "kafic"], usluge=["Smještaj", "Slobodni datumi", "Kako doći", "Kontakt"],
                    cta="Provjerite slobodne datume", upit="apartmani Makarska", vrijeme="Prijava od 14:00"),
}

def site(key, cls=""):
    """Primjer web stranice za tu vrstu posla (ime i domena su opći, nisu stvarni klijent)."""
    s = SITES[key]
    links = "".join(f"<span>{u}</span>" for u in s["usluge"][:3])
    gal = "".join(img(g, "", "20vw", widths=(320, 480, 720), ratio="4:3", alt="") for g in s["galerija"])
    usl = "".join(f"<li>{u}</li>" for u in s["usluge"])
    return f'''<div class="bw {cls}" data-site="{key}">
  <div class="bw__top"><i></i><i></i><i></i><span class="bw__url">{s["domena"]}</span></div>
  <div class="bw__view"><div class="ss">
    <div class="ss__nav"><b>{s["ime"]}</b><span class="ss__links">{links}</span><span class="ss__btn">{s["cta"].split()[0]}</span></div>
    <div class="ss__hero">{img(s["hero"], "", "(max-width: 900px) 90vw, 50vw", widths=(640, 960, 1400), alt="")}
      <div class="ss__copy"><span class="ss__kick">{s["vrsta"]}</span><strong>{s["naslov"]}</strong><span class="ss__cta">{s["cta"]}</span></div></div>
    <div class="ss__body">
      <div class="ss__col"><span class="ss__h">Usluge</span><ul>{usl}</ul></div>
      <div class="ss__gal">{gal}</div>
    </div>
    <div class="ss__info"><div><span class="ss__h">Gdje smo</span>{MAPA}</div><div><span class="ss__h">Kontakt</span><p>{s["vrijeme"]}</p><p>Nazovite nas ili pošaljite poruku</p><span class="ss__cta ss__cta--tam">{s["cta"]}</span></div></div>
    <div class="ss__foot"><span>{s["ime"]}</span><span>{s["domena"]}</span></div>
  </div></div>
</div>'''

def phone(key, cls=""):
    """Mobitel s Google pretragom i poslovnim profilom za tu vrstu posla."""
    s = SITES[key]
    fotke = img(s["hero"], "", "30vw", widths=(320, 480, 720), ratio="1:1", alt="") + img(s["galerija"][0], "", "20vw", widths=(240, 360, 480), ratio="1:1", alt="")
    return f'''<div class="ph {cls}" data-site="{key}">
  <div class="ph__screen">
    <div class="ph__status"><span>9:41</span><span class="ph__isl"></span><span>5G</span></div>
    <div class="gp__q"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg><span>{s["upit"]}</span></div>
    {MAPA}
    <div class="gp__card">
      <div class="gp__fotke">{fotke}</div>
      <b class="gp__ime">{s["ime"]}</b>
      <span class="gp__vrsta">{s["vrsta"]}</span>
      <span class="gp__open">{s["vrijeme"]}</span>
      <div class="gp__akcije"><span>Nazovi</span><span>Upute</span><span>Web</span></div>
      <div class="gp__usl"><span class="gp__h">Usluge</span>{"".join(f"<i>{u}</i>" for u in s["usluge"])}</div>
      <div class="gp__web"><span class="gp__h">Web stranica</span>{s["domena"]}</div>
    </div>
  </div>
</div>'''

def expand(text):
    """{{img:kljuc|cls|sizes|eager|ratio|alt}} i {{src:kljuc|w|h}} u fragmentima."""
    def r_img(m):
        p = m.group(1).split("|")
        key = p[0]; cls = p[1] if len(p) > 1 else ""; sizes = p[2] if len(p) > 2 and p[2] else "100vw"
        eager = len(p) > 3 and p[3] == "eager"; ratio = p[4] if len(p) > 4 and p[4] else None
        alt = p[5] if len(p) > 5 else None
        return img(key, cls, sizes, eager=eager, ratio=ratio, alt=alt)
    def r_src(m):
        p = m.group(1).split("|")
        return src(p[0], int(p[1]) if len(p) > 1 else 1600, int(p[2]) if len(p) > 2 and p[2] else None)
    text = re.sub(r"\{\{site:([^}|]+)\|?([^}]*)\}\}", lambda m: site(m.group(1), m.group(2)), text)
    text = re.sub(r"\{\{phone:([^}|]+)\|?([^}]*)\}\}", lambda m: phone(m.group(1), m.group(2)), text)
    text = re.sub(r"\{\{img:([^}]+)\}\}", r_img, text)
    return re.sub(r"\{\{src:([^}]+)\}\}", r_src, text)

HEAD = """<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<meta name="robots" content="noindex">
<meta name="description" content="Probna verzija naslovnice Digitalnog partnera: {title}.">
<meta name="theme-color" content="#E7E4DE">
<link rel="icon" href="slike/favicon.svg" type="image/svg+xml">
<link rel="icon" href="slike/favicon-32.png" sizes="32x32" type="image/png">
<link rel="preconnect" href="https://images.unsplash.com">
<link rel="preload" href="fontovi/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="stil.css">
<link rel="stylesheet" href="prijedlozi/zajednicko.css">
<style>
{css}
</style>
<script>document.documentElement.classList.add("js-menu");</script>
</head>
<body class="home {body}">
<a class="skip" href="#sadrzaj">Preskoči na sadržaj</a>
<nav>
  <div class="wrap">
    <a class="brand" href="index.html" aria-label="Digitalni partner, naslovna"><span class="mono">dp</span><span class="word"><b>digitalni</b>partner</span></a>
    <button class="menu-btn" type="button" aria-label="Izbornik" aria-expanded="false" aria-controls="izbornik"><span></span><span></span><span></span></button>
    <div class="links" id="izbornik"><a class="home-link on" aria-current="page" href="index.html">Naslovna</a><a href="o-nama.html">O nama</a><a href="usluge.html">Usluge</a><a href="cjenik.html">Cjenik</a><a class="cta" href="kontakt.html">Kontakt</a></div>
  </div>
</nav>
<main id="sadrzaj" tabindex="-1">
"""

BOTTOM = """
<section class="svj" id="kako">
  <div class="wrap">
    <div class="head"><span class="label">Kako radimo</span><h2>Od upitnika do objavljene stranice za dva tjedna.</h2></div>
    <div class="steps">
      <div class="step"><h3>Upitnik</h3><p>Kratkim upitnikom upoznajemo Vaš posao, ciljeve i želje.</p></div>
      <div class="step"><h3>Izrada</h3><p>Dizajniramo i razvijamo rješenje uz Vaše povratne informacije.</p></div>
      <div class="step"><h3>Podrška</h3><p>Objavljujemo, educiramo i ostajemo uz Vas.</p></div>
    </div>
  </div>
</section>

<section class="green" id="cijene">
  <div class="wrap">
    <div class="head"><span class="label">Paketi</span><h2>Stranica, Google profil i vidljivost u jednom paketu.</h2><p class="note-min">Mjesečno · ugovor najmanje 3 mjeseca</p></div>
    <div class="plans" data-paketa="2">
      <article class="plan">
        <h3>D start</h3>
        <div class="price">249 €<small>mjesečno</small></div>
        <p class="from">Web stranica i Google profil</p>
        <ul>
          <li>Web stranica do 5 podstranica</li>
          <li>Održavanje web stranice, domena i hosting</li>
          <li>Google poslovni profil, postavljanje i održavanje</li>
        </ul>
        <a class="btn line" href="kontakt.html?plan=paket%20D%20start">Odaberite D start</a>
      </article>
      <article class="plan hot">
        <span class="tag">Preporučeno</span>
        <h3>D plus</h3>
        <div class="price">499 €<small>mjesečno</small></div>
        <p class="from">Sve iz D start, uz bolju vidljivost na tražilicama</p>
        <ul>
          <li>Dvije dodatne podstranice</li>
          <li>SEO optimizacija</li>
          <li>GEO optimizacija za AI tražilice</li>
        </ul>
        <a class="btn primary" href="kontakt.html?plan=paket%20D%20plus">Odaberite D plus</a>
      </article>
    </div>
    <p class="once">Samo web stranicu možete naručiti od 399 €, jednokratno.</p><div class="once-btn"><a class="btn line" href="cjenik.html">Pogledajte potpuni cjenik</a></div>
  </div>
</section>

<section class="final svj" id="kontakt">
  <div class="wrap">
    <div>
      <span class="label">Kontakt</span>
      <h2>Recite nam nešto o svom poslu.</h2>
      <p class="lead">Pošaljite nam poruku i javit ćemo Vam se. Upit Vas ni na što ne obvezuje.</p>
    </div>
    <div class="cta-box"><a class="btn primary" href="kontakt.html">Pošaljite upit</a></div>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <div class="f-brand"><span class="mono">dp</span><span>© <span id="y"></span> Digitalni partner</span></div>
    <a class="f-link" href="pravne-informacije.html">Pravne informacije</a>
    <span class="f-sl">Digitalno. Po mjeri.</span>
  </div>
</footer>

<aside class="probna" aria-label="Probne verzije naslovnice">
  <a href="prijedlozi.html">Prijedlozi</a>
  {switch}
</aside>

<script>
document.getElementById("y").textContent = new Date().getFullYear();
(function(){
  var nav = document.querySelector("nav"), btn = nav.querySelector(".menu-btn");
  function set(open){ nav.classList.toggle("open", open); btn.setAttribute("aria-expanded", open); }
  btn.addEventListener("click", function(){ set(!nav.classList.contains("open")); });
  nav.querySelectorAll(".links a").forEach(function(a){ a.addEventListener("click", function(){ set(false); }); });
  addEventListener("keydown", function(e){ if(e.key === "Escape") set(false); });
  addEventListener("resize", function(){ if(innerWidth > 860) set(false); });
  // Linija ispod izbornika tek pri skrolanju
  function line(){ nav.style.setProperty("--p", Math.min(1, (window.pageYOffset||0) / 120).toFixed(3)); }
  line(); addEventListener("scroll", line, {passive:true});
})();
</script>
<script src="prijedlozi/karusel.js"></script>
<script>
{js}
</script>
</body>
</html>
"""

PRIJEDLOZI = [("a", "Kadar"), ("b", "Izlog"), ("c", "Kolaž")]

def build(slug, name):
    d = HERE / slug
    css = (d / "stil.css").read_text()
    body = expand((d / "tijelo.html").read_text())
    js = (d / "skripta.js").read_text()
    sw = "".join(
        f'<a href="prijedlog-{s}.html"{" aria-current=\"page\"" if s == slug else ""}>{s.upper()}<span> · {n}</span></a>'
        for s, n in PRIJEDLOZI)
    html = HEAD.format(title=f"Prijedlog {slug.upper()}: {name} · Digitalni partner", css=css, body=f"p-{slug}") \
        + body + BOTTOM.replace("{switch}", sw).replace("{js}", js)
    (OUT / f"prijedlog-{slug}.html").write_text(html)
    print("prijedlog", slug, len(html))

for s, n in PRIJEDLOZI:
    if len(sys.argv) == 1 or s in sys.argv[1:]:
        if (HERE / s / "tijelo.html").exists():
            build(s, n)
