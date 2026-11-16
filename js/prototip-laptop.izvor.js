// PROTOTIP: hero s 3D laptopom (WebGL) koji se otvara na skrol.
// Ovo je IZVOR. Stranica učitava js/prototip-laptop.js, koji nastaje pakiranjem ove datoteke zajedno s bibliotekom three.js:
//   npx esbuild js/prototip-laptop.izvor.js --bundle --minify --format=esm --outfile=js/prototip-laptop.js
//
// Kako radi:
//   - Mjerne jedinice scene su CSS pikseli, a kamera je postavljena tako da ravnina z=0 odgovara ekranu 1:1.
//     Zato se HTML elementi (leteći logo i sadržaj zaslona) mogu točno poklopiti s 3D modelom i s pravom stranicom.
//   - Skrol kroz .lh daje napredak p (0 do 1). Pokret ga prati s malim zakašnjenjem da laptop djeluje kao da ima masu.
//   - Sadržaj zaslona je kopija pravog heroja stranice. Na kraju se zaslon približi dok se kopija ne poklopi
//     s pravim herojem ispod, pa se scena ugasi i ostaje prava stranica.
//   - Bez WebGL-a ili uz "smanjeno kretanje" ništa od ovoga se ne pokreće i stranica izgleda kao obična naslovnica.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const root = document.documentElement;
const lh = document.querySelector('.lh');
const hero = document.querySelector('.b-hero');
const nav = document.querySelector('nav');

function odustani() { root.classList.remove('lh-anim'); }

try {
  if (!lh || !hero || !root.classList.contains('lh-anim')) throw 0;
  pokreni();
} catch (e) {
  odustani();
  if (e) console.error(e);
}

function pokreni() {
  const scena = lh.querySelector('.lh-scena');
  const DEG = Math.PI / 180;
  const clamp = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const mix = (a, b, t) => a + (b - a) * t;

  // ---------- Mjere laptopa (širina = 1) ----------
  const D = 1 / 1.46, T = 0.0165, TL = 0.0075, R = 0.03;
  const ZAS_W = 0.955, ZAS_OMJER = 1.5, ZAS_H = ZAS_W / ZAS_OMJER;
  const ZAS_Z = D - 0.012 - ZAS_H / 2;          // sredina zaslona, mjereno od šarke
  const NAGIB0 = 46 * DEG, ZAKRET0 = -11 * DEG; // početak: oslonjen na prednji rub, blago zakrenut
  const STOL = 10 * DEG;                        // pogled na stol odozgo
  const OTV = 106 * DEG;                        // otvoren poklopac
  const STOL_Z = OTV - 90 * DEG;                // nagib pri kojem zaslon gleda ravno u kameru

  // ---------- Renderer, kamera, scena ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.domElement.className = 'lh-platno';
  scena.appendChild(renderer.domElement);

  const css = new CSS3DRenderer();
  css.domElement.className = 'lh-html';
  scena.appendChild(css.domElement);

  const scene = new THREE.Scene();
  const FOV = 30;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  // Stol: sve što stoji na podlozi. Naginje se prema kameri umjesto da se kamera spušta,
  // tako ravnina z=0 ostaje poravnata s ekranom.
  const stol = new THREE.Group();
  scene.add(stol);

  const sunce = new THREE.DirectionalLight(0xfff6ea, 2.2);
  sunce.position.set(-0.75, 1.9, 1.05);
  sunce.castShadow = true;
  sunce.shadow.mapSize.set(2048, 2048);
  sunce.shadow.radius = 7;
  sunce.shadow.blurSamples = 16;
  stol.add(sunce, sunce.target);
  const dopuna = new THREE.DirectionalLight(0xdfeee9, 0.5);
  dopuna.position.set(1.2, 0.8, 0.9);
  stol.add(dopuna);

  const pod = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.3 }));
  pod.rotation.x = -90 * DEG;
  pod.receiveShadow = true;
  stol.add(pod);

  // ---------- Materijali ----------
  function platno(w, h, crtaj) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    crtaj(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  // Brušeni aluminij: vodoravne crtice u hrapavosti daju razvučen odsjaj
  const brus = platno(512, 512, (g, w, h) => {
    g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 110 + Math.random() * 90 | 0;
      g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',.35)';
      const x = Math.random() * w, y = Math.random() * h | 0, d = 40 + Math.random() * 220;
      g.fillRect(x, y, d, 1); g.fillRect(x - w, y, d, 1);   // drugi potez spaja rubove uzorka
    }
  });
  brus.colorSpace = THREE.NoColorSpace;
  brus.wrapS = brus.wrapT = THREE.RepeatWrapping;
  brus.repeat.set(1.6, 4);
  const alu = new THREE.MeshStandardMaterial({ color: 0xb9b6af, metalness: 1, roughness: 0.6, roughnessMap: brus });
  const aluRub = new THREE.MeshStandardMaterial({ color: 0xdedbd4, metalness: 1, roughness: 0.14 });   // polirani skošeni rub
  const crno = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.1, roughness: 0.75 });
  const tipka = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, metalness: 0.05, roughness: 0.5 });
  const staklo = new THREE.MeshPhysicalMaterial({ color: 0x040404, metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 });

  function zaobljeno(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
    s.lineTo(x + w, y + d - r); s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2);
    s.lineTo(x + r, y + d); s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    return s;
  }
  // Ploča zaobljenih uglova sa skošenim rubom; leži u ravnini xz, debljina ide po y od 0 do t
  function ploca(w, d, t, r, skos) {
    const g = new THREE.ExtrudeGeometry(zaobljeno(w - 2 * skos, d - 2 * skos, r - skos), {
      depth: t - 2 * skos, bevelEnabled: true, bevelThickness: skos, bevelSize: skos, bevelSegments: 4, curveSegments: 20
    });
    g.translate(0, 0, skos);
    g.rotateX(-90 * DEG);
    // Skupine materijala: 0 = gornja i donja ploha, 1 = bočne plohe i skošenje
    return g;
  }
  function sjenaDa(m) { m.castShadow = true; m.receiveShadow = true; return m; }

  // ---------- Model ----------
  const zakret = new THREE.Group();        // okret oko okomite osi
  const nagib = new THREE.Group();         // nagib oko prednjeg donjeg ruba
  const tijelo = new THREE.Group();
  stol.add(zakret); zakret.add(nagib); nagib.add(tijelo);
  nagib.position.set(0, 0, D / 2);
  tijelo.position.set(0, 0, -D / 2);

  const baza = sjenaDa(new THREE.Mesh(ploca(1, D, T, R, 0.0022), [alu, aluRub]));
  tijelo.add(baza);

  // Udubljenje tipkovnice i tipke
  const TK_W = 0.8, TK_D = 0.292, TK_Z = -D / 2 + 0.058 + TK_D / 2;
  const udub = new THREE.Mesh(new THREE.ShapeGeometry(zaobljeno(TK_W + 0.012, TK_D + 0.012, 0.008), 8), crno);
  udub.rotation.x = -90 * DEG; udub.position.set(0, T + 0.0002, TK_Z); udub.receiveShadow = true;
  tijelo.add(udub);
  const redovi = [
    [0.55, [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    [1, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5]],
    [1, [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    [1, [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75]],
    [1, [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25]],
    [1, [1, 1, 1, 1.25, 5, 1.25, 1, 1, 1, 1]]
  ];
  const brojTipki = redovi.reduce((n, r) => n + r[1].length, 0);
  const tipke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), tipka, brojTipki);
  tipke.receiveShadow = true;
  {
    const u = TK_W / 14.5, raz = u * 0.09, visU = TK_D / 5.55, m = new THREE.Matrix4();
    let z = TK_Z - TK_D / 2, k = 0;
    for (const [vis, sir] of redovi) {
      let x = -TK_W / 2;
      for (const s of sir) {
        m.makeScale(s * u - raz, 0.0022, vis * visU - raz);
        m.setPosition(x + s * u / 2, T + 0.0012, z + vis * visU / 2);
        tipke.setMatrixAt(k++, m);
        x += s * u;
      }
      z += vis * visU;
    }
  }
  tijelo.add(tipke);

  // Dodirna ploha: malo glađa od kućišta, s tankim tamnijim rubom
  const TP_W = 0.4, TP_D = 0.238, TP_Z = D / 2 - 0.018 - TP_D / 2;
  const tpRub = new THREE.Mesh(new THREE.ShapeGeometry(zaobljeno(TP_W + 0.003, TP_D + 0.003, 0.0095), 8),
    new THREE.MeshStandardMaterial({ color: 0x85827c, metalness: 1, roughness: 0.4 }));
  tpRub.rotation.x = -90 * DEG; tpRub.position.set(0, T + 0.00015, TP_Z);
  const tp = new THREE.Mesh(new THREE.ShapeGeometry(zaobljeno(TP_W, TP_D, 0.008), 8),
    new THREE.MeshStandardMaterial({ color: 0xbfbcb5, metalness: 1, roughness: 0.3 }));
  tp.rotation.x = -90 * DEG; tp.position.set(0, T + 0.0003, TP_Z); tp.receiveShadow = true;
  tijelo.add(tpRub, tp);

  // Zvučnici: mreža rupica lijevo i desno od tipkovnice
  const rupice = platno(64, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#0b0b0c';
    for (let y = 6; y < h; y += 10) for (let x = 6; x < w; x += 10) { g.beginPath(); g.arc(x + (y / 10 % 2 ? 5 : 0), y, 2.6, 0, 7); g.fill(); }
  });
  for (const strana of [-1, 1]) {
    const z = new THREE.Mesh(new THREE.PlaneGeometry(0.03, TK_D * 0.86), new THREE.MeshBasicMaterial({ map: rupice, transparent: true, opacity: 0.75 }));
    z.rotation.x = -90 * DEG; z.position.set(strana * (TK_W / 2 + 0.047), T + 0.0003, TK_Z);
    tijelo.add(z);
  }
  // Šarka
  const sarka = new THREE.Mesh(new THREE.CylinderGeometry(T * 0.42, T * 0.42, 0.74, 20), crno);
  sarka.rotation.z = 90 * DEG; sarka.position.set(0, T * 0.62, -D / 2 + T * 0.2);
  tijelo.add(sarka);
  // Utor za prst na prednjem rubu
  const utor = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.0035, 0.004), new THREE.MeshStandardMaterial({ color: 0x8c8983, metalness: 0.9, roughness: 0.4 }));
  utor.position.set(0, T - 0.0016, D / 2 - 0.001);
  tijelo.add(utor);

  // Meka kontaktna sjena ispod kućišta (vidi se tek kad laptop legne)
  const kontaktTex = platno(256, 256, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(0,0,0,.9)'); r.addColorStop(0.75, 'rgba(0,0,0,.28)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  const kontakt = new THREE.Mesh(new THREE.PlaneGeometry(1.2, D * 1.28), new THREE.MeshBasicMaterial({ map: kontaktTex, transparent: true, depthWrite: false, opacity: 0 }));
  kontakt.rotation.x = -90 * DEG; kontakt.position.y = 0.0006;
  zakret.add(kontakt);

  // Poklopac: okreće se oko stražnjeg ruba
  const poklopac = new THREE.Group();
  poklopac.position.set(0, T + 0.0006, -D / 2);
  tijelo.add(poklopac);
  const lidGeo = ploca(1, D, TL, R, 0.0018); lidGeo.translate(0, 0, D / 2);
  const lidMesh = new THREE.Mesh(lidGeo, [alu, aluRub]);
  lidMesh.castShadow = true;      // poklopac baca sjenu, ali je ne prima: na njega ionako ništa ne pada
  poklopac.add(lidMesh);
  // Glatka ploha preko sredine poklopca: mreža trokuta izvučene ploče zna pustiti sitne rupice između uskih trokuta
  {
    const w = 1 - 2 * R, d = D - 0.012, pg = new THREE.PlaneGeometry(w, d);
    const uv = pg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * w, (uv.getY(i) - 0.5) * d);
    const m = new THREE.Mesh(pg, alu.clone());
    m.material.polygonOffset = true; m.material.polygonOffsetFactor = -2; m.material.polygonOffsetUnits = -4;
    m.rotation.x = -90 * DEG; m.position.set(0, TL + 0.00008, D / 2);
    poklopac.add(m);
  }
  const okvir = new THREE.Mesh(new THREE.ShapeGeometry(zaobljeno(0.99, D - 0.01, R - 0.005), 16), staklo);
  okvir.rotation.x = 90 * DEG; okvir.position.set(0, -0.0002, D / 2);
  poklopac.add(okvir);
  const kamera = new THREE.Mesh(new THREE.CircleGeometry(0.0022, 16), new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.2 }));
  kamera.rotation.x = 90 * DEG; kamera.position.set(0, -0.0004, D - 0.0055);
  poklopac.add(kamera);
  // Sidra: mjesta na poklopcu na koja se naslanjaju HTML elementi
  const sidroZaslon = new THREE.Object3D();
  sidroZaslon.rotation.x = 90 * DEG; sidroZaslon.position.set(0, -0.0006, ZAS_Z);
  const sidroLogo = new THREE.Object3D();
  sidroLogo.rotation.x = -90 * DEG; sidroLogo.position.set(0, TL + 0.0006, D / 2);
  poklopac.add(sidroZaslon, sidroLogo);
  // Svjetlo zaslona koje pada na tipke i stol
  const sjaj = new THREE.PointLight(0xf4efe4, 0, 0, 2);
  sjaj.position.set(0, -0.2, ZAS_Z - 0.05);
  poklopac.add(sjaj);

  // ---------- Logo na poklopcu ----------
  // Raspored je isti kao kod letećeg HTML logotipa: mjere su zadane za laptop širok REF piksela.
  const REF = 1000, LOGO_W = 0.5 * REF, ZNAK_Y = -0.125 * D * REF, RIJEC_Y = 0.12 * D * REF;
  const DEC_W = 0.7, DEC_H = 0.46, DEC_PX = 2048 / (DEC_W * REF);
  function crtajLogo(g, w, h, nacin) {
    const sans = '"Manrope",system-ui,sans-serif';
    g.clearRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.scale(DEC_PX, DEC_PX);
    const fs = LOGO_W / mjere.rijecEm;              // veličina slova natpisa
    const znak = LOGO_W * 0.25, zf = znak / 2.1;    // znak je kvadrat stranice 2,1 em
    const boja = nacin === 'otisak' ? 'rgba(20,24,22,.16)' : '#0F3B33';
    function znakPut(pomak) {
      const r = zf * 0.46, x = -znak / 2, y = ZNAK_Y - znak / 2 + pomak;
      g.beginPath(); g.roundRect(x, y, znak, znak, r);
    }
    if (nacin === 'otisak') {           // plitko udubljenje: svijetli donji rub, tamna ploha
      g.fillStyle = 'rgba(255,255,255,.5)'; znakPut(1.6); g.fill();
      g.fillStyle = '#b3b0a9'; znakPut(0); g.fill();
      g.fillStyle = boja; znakPut(0); g.fill();
    } else {
      g.fillStyle = boja; znakPut(0); g.fill();
      g.lineWidth = znak * 0.022; g.strokeStyle = '#C6A15B'; znakPut(0); g.stroke();   // tanka zlatna linija
    }
    g.textBaseline = 'alphabetic';
    if (nacin !== 'otisak') {
      g.fillStyle = '#E7E4DE'; g.font = '700 ' + zf + 'px ' + sans; g.letterSpacing = (-0.02 * zf) + 'px';
      const m = g.measureText('dp');
      g.fillText('dp', -m.width / 2, ZNAK_Y - zf * 0.05 + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2);
    }
    g.letterSpacing = (0.005 * fs) + 'px';
    g.font = '700 ' + fs + 'px ' + sans; const a = g.measureText('digitalni').width;
    g.font = '400 ' + fs + 'px ' + sans; const b = g.measureText('partner').width;
    const fm = g.measureText('dp');
    const x0 = -(a + b) / 2, yb = RIJEC_Y + (fm.fontBoundingBoxAscent - fm.fontBoundingBoxDescent) / 2;
    for (const [dy, f] of nacin === 'otisak' ? [[1.4, 'rgba(255,255,255,.5)'], [0, boja]] : [[0, boja]]) {
      g.fillStyle = f;
      g.font = '700 ' + fs + 'px ' + sans; g.fillText('digitalni', x0, yb + dy);
      g.font = '400 ' + fs + 'px ' + sans; g.fillText('partner', x0 + a, yb + dy);
    }
    g.restore();
  }
  const mjere = { rijecEm: 8.3 };
  function decal(nacin, y) {
    const tex = platno(2048, Math.round(2048 * DEC_H / DEC_W), (g, w, h) => crtajLogo(g, w, h, nacin));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(DEC_W, DEC_H),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: nacin === 'otisak' ? 1 : 0.05, roughness: nacin === 'otisak' ? 0.6 : 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    m.rotation.x = -90 * DEG; m.position.set(0, TL + y, D / 2);
    m.userData.crtaj = () => { crtajLogo(tex.image.getContext('2d'), tex.image.width, tex.image.height, nacin); tex.needsUpdate = true; };
    poklopac.add(m);
    return m;
  }
  const otisak = decal('otisak', 0.0003), gravura = decal('boja', 0.0005);
  gravura.renderOrder = 2; otisak.renderOrder = 1;

  // ---------- HTML dijelovi ----------
  // Leteći logo
  const letEl = document.createElement('div');
  letEl.className = 'lh-let';
  letEl.innerHTML = '<span class="mono">dp</span><span class="word"><b>digitalni</b>partner</span>';
  const lMono = letEl.firstChild, lWord = letEl.lastChild;
  const letObj = new CSS3DObject(letEl);
  scene.add(letObj);
  const nMono = nav.querySelector('.brand .mono'), nWord = nav.querySelector('.brand .word');

  // Zaslon: prozor u kojem je kopija pravog heroja
  const prozor = document.createElement('div');
  prozor.className = 'lh-zaslon';
  const klonOmot = document.createElement('div');
  klonOmot.className = 'lh-klon';
  const klon = hero.cloneNode(true);
  klon.removeAttribute('id');
  klon.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  klon.querySelectorAll('h1').forEach(h => { const p = document.createElement('p'); p.className = h.className; p.innerHTML = h.innerHTML; h.replaceWith(p); });
  klon.querySelectorAll('img').forEach(i => { i.loading = 'eager'; });
  klon.setAttribute('inert', '');
  klonOmot.appendChild(klon);
  const mrak = document.createElement('div'); mrak.className = 'lh-mrak';
  const odsjaj = document.createElement('div'); odsjaj.className = 'lh-odsjaj';
  prozor.append(klonOmot, odsjaj, mrak);
  const zasObj = new CSS3DObject(prozor);
  scene.add(zasObj);
  const otkrij = [...klon.querySelectorAll('.b-copy > *, .b-desno')];
  const klonLabel = klon.querySelector('.label');

  // ---------- Mjere prozora i ključni kadrovi ----------
  const g = { vw: 0, vh: 0 };
  const K0 = { s: 1, pos: new THREE.Vector3() }, K1 = { s: 1, pos: new THREE.Vector3() };
  const A1 = new THREE.Vector3();        // položaj sredine zaslona u kadru K1
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), jed = new THREE.Quaternion();
  const tocke = [];
  for (const x of [-0.5, 0.5]) for (const z of [-D / 2, D / 2]) for (const y of [0, T]) tocke.push([tijelo, new THREE.Vector3(x, y, z)]);
  for (const x of [-0.5, 0.5]) for (const z of [0, D]) tocke.push([poklopac, new THREE.Vector3(x, TL, z)]);

  function postavi(nag, zak, otv, st, s, pos) {
    nagib.rotation.x = nag; zakret.rotation.y = zak; poklopac.rotation.x = -otv;
    stol.rotation.x = st; stol.scale.setScalar(s); stol.position.copy(pos);
    stol.updateMatrixWorld(true);
  }
  function okvirNaEkranu() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [obj, t] of tocke) {
      v.copy(t).applyMatrix4(obj.matrixWorld).project(camera);
      const x = (v.x + 1) / 2 * g.vw, y = (1 - v.y) / 2 * g.vh;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  }
  // Nađi veličinu i položaj uz koje laptop u zadanoj pozi stane u zadani pravokutnik ekrana
  function uklopi(K, nag, zak, otv, st, cilj, najvise) {
    K.s = 600; K.pos.set(0, 0, 0);
    for (let i = 0; i < 6; i++) {
      postavi(nag, zak, otv, st, K.s, K.pos);
      const b = okvirNaEkranu();
      const k = Math.min((cilj.x1 - cilj.x0) / (b.x1 - b.x0), (cilj.y1 - cilj.y0) / (b.y1 - b.y0));
      K.s = Math.min(K.s * k, najvise);
      postavi(nag, zak, otv, st, K.s, K.pos);
      const c = okvirNaEkranu();
      K.pos.x += (cilj.x0 + cilj.x1) / 2 - (c.x0 + c.x1) / 2;
      K.pos.y -= (cilj.y0 + cilj.y1) / 2 - (c.y0 + c.y1) / 2;
    }
  }

  function izmjeri() {
    g.vw = scena.clientWidth; g.vh = scena.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(g.vw, g.vh, false);
    css.setSize(g.vw, g.vh);
    camera.aspect = g.vw / g.vh;
    camera.position.set(0, 0, g.vh / 2 / Math.tan(FOV / 2 * DEG));
    camera.near = camera.position.z * 0.15; camera.far = camera.position.z * 8;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();

    const uzak = g.vw < 860, navH = 72;
    uklopi(K0, NAGIB0, ZAKRET0, 0, STOL,
      { x0: g.vw * (uzak ? 0.1 : 0.24), x1: g.vw * (uzak ? 0.9 : 0.76), y0: g.vh * 0.16, y1: g.vh * 0.8 }, 900);
    uklopi(K1, 0, 0, OTV, STOL,
      { x0: g.vw * 0.04, x1: g.vw * 0.96, y0: navH + Math.max(18, g.vh * 0.035), y1: g.vh - Math.max(22, g.vh * 0.05) }, 1150);
    postavi(0, 0, OTV, STOL, K1.s, K1.pos);
    sidroZaslon.getWorldPosition(A1);

    // Zaslon i kopija heroja
    g.heroW = hero.offsetWidth; g.heroH = hero.offsetHeight;
    g.zasH = g.heroW / ZAS_OMJER;
    prozor.style.width = g.heroW + 'px';
    klonOmot.style.width = g.heroW + 'px';
    const copy = hero.querySelector('.b-copy');
    const copyTop = copy ? copy.getBoundingClientRect().top - hero.getBoundingClientRect().top : 0;
    g.oy = g.zasH >= g.heroH ? (g.zasH - g.heroH) / 2 : Math.min(0, g.zasH * 0.09 - copyTop);

    // Leteći logo: odredišta u izborniku (od sredine ekrana) i polazne veličine
    const navTop = nav.getBoundingClientRect().top;
    const m = nMono.getBoundingClientRect(), w = nWord.getBoundingClientRect();
    g.mono1 = { x: m.left + m.width / 2 - g.vw / 2, y: m.top - navTop + m.height / 2 - g.vh / 2 };
    g.word1 = { x: w.left + w.width / 2 - g.vw / 2, y: w.top - navTop + w.height / 2 - g.vh / 2 };
    g.kWord = LOGO_W / w.width; g.kMono = LOGO_W * 0.25 / m.width;
    const fw = parseFloat(getComputedStyle(nWord).fontSize);
    lMono.style.fontSize = parseFloat(getComputedStyle(nMono).fontSize) * g.kMono + 'px';
    lWord.style.fontSize = fw * g.kWord + 'px';
    const em = w.width / fw;
    if (Math.abs(em - mjere.rijecEm) > 0.01) { mjere.rijecEm = em; otisak.userData.crtaj(); gravura.userData.crtaj(); }
  }

  function smjesti(el, x0, y0, to, k, t) {
    el.style.transform = 'translate(-50%,-50%) translate(' + mix(x0, to.x, t).toFixed(2) + 'px,' + mix(y0, to.y, t).toFixed(2) + 'px) scale(' + mix(1, 1 / k, t).toFixed(4) + ')';
  }

  // ---------- Kadar ----------
  let cilj = 0, p = 0, zadnje = 0, prljavo = true, ugaseno = null;
  const pos = new THREE.Vector3(), cil = new THREE.Vector3();

  function citajSkrol() {
    const r = lh.getBoundingClientRect(), put = r.height - g.vh;
    cilj = put > 0 ? clamp(-r.top / put) : 1;
  }

  function crtaj() {
    const st = scena.style;
    const kraj = p >= 0.972;
    if (kraj !== ugaseno) { ugaseno = kraj; scena.classList.toggle('lh-kraj', kraj); }

    const tA = ease(seg(p, 0.05, 0.52));
    const tB = ease(seg(p, 0.22, 0.72));
    const tZ = ease(seg(p, 0.8, 0.97));
    const s = mix(K0.s, K1.s, tA) * Math.pow(g.heroW / ZAS_W / K1.s, tZ);
    const stolKut = mix(STOL, STOL_Z, tZ);
    pos.lerpVectors(K0.pos, K1.pos, tA);
    postavi(mix(NAGIB0, 0, tA), mix(ZAKRET0, 0, tA), OTV * tB, stolKut, s, tZ > 0 ? pos.set(0, 0, 0) : pos);
    let hr = null;
    if (tZ > 0) {
      // Približavanje: sredina zaslona putuje prema sredini pravog heroja na stranici
      hr = hero.getBoundingClientRect();
      const sr = scena.getBoundingClientRect();
      cil.set(hr.left - sr.left + hr.width / 2 - g.vw / 2, g.vh / 2 - (hr.top - sr.top + hr.height / 2), 0);
      sidroZaslon.getWorldPosition(v);
      pos.lerpVectors(A1, cil, tZ).sub(v);
      postavi(0, 0, OTV, stolKut, s, pos);
    }

    // Svjetla i sjene prate veličinu scene
    const c = sunce.shadow.camera;
    c.left = c.bottom = -1.15 * s; c.right = c.top = 1.15 * s; c.near = 0.5 * s; c.far = 4.5 * s;
    c.updateProjectionMatrix();
    sunce.shadow.normalBias = 0.005 * s; sunce.shadow.bias = -0.0006;
    const on = ease(seg(p, 0.5, 0.72));
    const d = 0.26 * s;
    sjaj.intensity = on * (1 - tZ) * 1.6 * d * d;
    tipke.visible = tB > 0.004;      // ispod zatvorenog poklopca tipke se ne crtaju
    kontakt.material.opacity = tA * 0.55;
    pod.material.opacity = mix(0.42, 0.26, tA);

    // Podloga: iz tamnog smaragda u kamen
    const bg = ease(seg(p, 0.03, 0.27));
    scene.environmentIntensity = mix(0.55, 1, bg);
    sunce.intensity = mix(3.2, 2.4, bg);
    st.setProperty('--bg', bg.toFixed(3));
    st.setProperty('--hint', (1 - seg(p, 0.005, 0.04)).toFixed(3));
    st.setProperty('--platno', (1 - seg(p, 0.9, 0.965)).toFixed(3));

    // Logo: gravura na poklopcu -> HTML logo koji leti u izbornik
    const tlSir = seg(p, 0.13, 0.47), tl = ease(tlSir);
    const prijelaz = seg(tlSir, 0, 0.07);
    gravura.material.opacity = 1 - prijelaz;
    sidroLogo.matrixWorld.decompose(v, q, sc);
    letObj.position.copy(v).multiplyScalar(1 - tl);
    letObj.quaternion.copy(q).slerp(jed, tl);
    letObj.scale.setScalar(mix(sc.x / REF, 1, tl));
    smjesti(lMono, 0, ZNAK_Y, g.mono1, g.kMono, tl);
    smjesti(lWord, 0, RIJEC_Y, g.word1, g.kWord, tl);
    const sletio = tl >= 1;
    letEl.style.opacity = sletio ? 0 : prijelaz;
    nav.classList.toggle('lh-gotov', sletio);

    // Izbornik
    const izb = seg(p, 0.36, 0.52);
    nav.style.setProperty('--lh-izb', izb.toFixed(3));
    nav.classList.toggle('lh-skriven', izb < 0.5);

    // Zaslon
    sidroZaslon.matrixWorld.decompose(v, q, sc);
    zasObj.position.copy(v); zasObj.quaternion.copy(q);
    zasObj.scale.setScalar(sc.x * ZAS_W / g.heroW);
    prozor.style.height = mix(g.zasH, g.heroH, tZ).toFixed(1) + 'px';
    klonOmot.style.transform = 'translateY(' + (g.oy * (1 - tZ)).toFixed(1) + 'px)';
    prozor.style.borderRadius = (g.heroW * 0.007 * (1 - tZ)).toFixed(1) + 'px';
    prozor.style.visibility = tB > 0.02 ? '' : 'hidden';
    mrak.style.opacity = (1 - on).toFixed(3);
    odsjaj.style.opacity = (on * (1 - seg(p, 0.8, 0.88))).toFixed(3);
    const r = seg(p, 0.56, 0.78);
    otkrij.forEach((el, i) => {
      const t = ease(clamp((r - i * 0.13) / 0.42));
      el.style.opacity = t.toFixed(3);
      el.style.transform = t < 1 ? 'translateY(' + ((1 - t) * 22).toFixed(1) + 'px)' : '';
    });
    if (klonLabel) klonLabel.style.setProperty('--lh-crta', ease(clamp(r / 0.3)).toFixed(3));

    if (!kraj) {
      renderer.render(scene, camera);
      css.render(scene, camera);
    }
  }

  function petlja(sad) {
    const dt = Math.min(0.05, (sad - zadnje) / 1000 || 0.016); zadnje = sad;
    const razlika = cilj - p;
    if (Math.abs(razlika) > 0.0002) { p += razlika * (1 - Math.exp(-dt * 7.5)); prljavo = true; }
    else if (p !== cilj) { p = cilj; prljavo = true; }
    if (prljavo) { prljavo = false; crtaj(); }
    requestAnimationFrame(petlja);
  }

  function sve() { izmjeri(); citajSkrol(); prljavo = true; }
  izmjeri(); citajSkrol(); p = cilj; crtaj();
  root.classList.add('lh-spreman');
  window.addEventListener('scroll', () => { citajSkrol(); if (p >= 0.8) prljavo = true; }, { passive: true });
  window.addEventListener('resize', sve);
  window.addEventListener('load', sve);
  if (document.fonts && document.fonts.ready) {
    Promise.all([document.fonts.load('700 40px Manrope'), document.fonts.load('400 40px Manrope')]).then(() => {
      otisak.userData.crtaj(); gravura.userData.crtaj(); sve();
    });
  }
  requestAnimationFrame(petlja);
}
