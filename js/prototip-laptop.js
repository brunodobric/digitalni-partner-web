// PROTOTIP: hero s laptopom koji se otvara na skrol.
// Skrol kroz sekciju .lh daje napredak p od 0 do 1. Iz njega se računa:
//   nagib laptopa (zatvoren i nagnut prema gledatelju -> položen na stol), otvaranje poklopca,
//   let logotipa s poklopca na mjesto u izborniku, pojavljivanje izbornika, paljenje zaslona i sjena.
// Uz "smanjeno kretanje" skripta ne radi ništa: ostaje završno stanje iz prototip-laptop.css.
(function () {
  var root = document.documentElement;
  var lh = document.querySelector('.lh');
  if (!lh || !window.CSS || !CSS.supports('transform-style', 'preserve-3d')) return;
  if (/[?&]boja=smaragd/.test(location.search)) root.classList.add('lh-smaragd');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var scena = lh.querySelector('.lh-scena');
  var ploha = lh.querySelector('.lh-let');
  var lMono = ploha.querySelector('.mono'), lWord = ploha.querySelector('.word');
  var nav = document.querySelector('nav');
  var nMono = nav.querySelector('.brand .mono'), nWord = nav.querySelector('.brand .word');
  root.classList.add('lh-anim');

  // Početno i završno stanje laptopa
  var A0 = 36, A1 = 82;        // nagib postolja: 36° od ravnine ekrana = laptop nagnut oko 54° prema gledatelju
  var B1 = 104;                // kut otvorenog poklopca
  var S0 = 0.86, S1 = 1, TY1 = 0;

  var g = {};                  // mjere koje ovise o veličini prozora
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function seg(p, a, b) { return clamp((p - a) / (b - a)); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function mix(a, b, t) { return a + (b - a) * t; }

  function measure() {
    var cs = getComputedStyle(scena);
    var lp = scena.querySelector('.lp');
    g.W = lp.offsetWidth; g.D = lp.offsetHeight;
    g.TL = g.W * 0.007;
    g.vw = scena.clientWidth; g.vh = scena.clientHeight;
    // Odredišta: sredina znaka i natpisa u izborniku, u koordinatama od sredine scene
    var sr = { x: g.vw / 2, y: g.vh / 2 };
    var navTop = nav.getBoundingClientRect().top;      // izbornik je fiksiran, scena je pribodena na vrh
    var m = nMono.getBoundingClientRect(), w = nWord.getBoundingClientRect();
    g.mono1 = { x: m.left + m.width / 2 - sr.x, y: m.top - navTop + m.height / 2 - sr.y, w: m.width };
    g.word1 = { x: w.left + w.width / 2 - sr.x, y: w.top - navTop + w.height / 2 - sr.y, w: w.width };
    // Polazišta na poklopcu: znak iznad natpisa, natpis širok oko polovice poklopca
    var wordW = g.W * 0.5, monoW = wordW * 0.25;
    g.kWord = wordW / w.width; g.kMono = monoW / m.width;
    g.mono0 = { x: 0, y: -g.D * 0.13 };
    g.word0 = { x: 0, y: g.D * 0.115 };
    lMono.style.fontSize = parseFloat(getComputedStyle(nMono).fontSize) * g.kMono + 'px';
    lWord.style.fontSize = parseFloat(getComputedStyle(nWord).fontSize) * g.kWord + 'px';
    g.navH = 72;
    void cs;
    fit();
  }

  // Završno stanje: otvoren laptop treba stati između izbornika i dna ekrana. Postavi završne kutove,
  // izmjeri koliko mjesta laptop zauzima na ekranu i iz toga izračunaj završnu veličinu i pomak.
  function fit() {
    var st = scena.style, lp = scena.querySelector('.lp');
    var gore = g.navH + Math.max(16, g.vh * 0.03), dolje = g.vh - Math.max(20, g.vh * 0.045);
    st.setProperty('--A', A1 + 'deg'); st.setProperty('--B', B1 + 'deg');
    S1 = 1; TY1 = 0;
    for (var i = 0; i < 3; i++) {
      st.setProperty('--s', S1); st.setProperty('--ty', TY1 + 'px');
      var o = scena.getBoundingClientRect();
      var a = lp.querySelector('.lp-unutra').getBoundingClientRect(), b = lp.querySelector('.lp-celo').getBoundingClientRect();
      var top = a.top - o.top, bot = b.bottom - o.top, sir = Math.max(a.width, b.width);
      var k = Math.min((dolje - gore) / (bot - top), (g.vw * 0.94) / sir, 1.25);
      S1 *= k;
      TY1 += (gore + dolje) / 2 - (top + bot) / 2;
    }
  }

  function place(el, from, to, k, t) {
    var x = mix(from.x, to.x, t), y = mix(from.y, to.y, t);
    var s = mix(1, 1 / k, t);
    el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
  }

  var raf = 0;
  function render() {
    raf = 0;
    var r = lh.getBoundingClientRect();
    var put = r.height - innerHeight;
    var p = put > 0 ? clamp(-r.top / put) : 1;
    var st = scena.style;

    // Laptop
    var tA = ease(seg(p, 0.04, 0.62));
    var tB = ease(seg(p, 0.16, 0.9));
    var A = mix(A0, A1, tA), B = mix(0, B1, tB), s = mix(S0, S1, tA);
    var ty0 = g.navH * 0.1, ty1 = TY1;
    var ty = mix(ty0, ty1, tA);
    st.setProperty('--A', A.toFixed(2) + 'deg');
    st.setProperty('--B', B.toFixed(2) + 'deg');
    st.setProperty('--s', s.toFixed(4));
    st.setProperty('--ty', ty.toFixed(1) + 'px');
    st.setProperty('--rub', B < 14 ? 1 : 0);
    st.setProperty('--on', ease(seg(p, 0.42, 0.8)).toFixed(3));
    st.setProperty('--pod', seg(p, 0.45, 0.7).toFixed(3));

    // Sjena na podlozi: dok laptop "lebdi" nagnut, meka je i odmaknuta; kad legne na stol, zamijeni je sjena ispod postolja
    var rad = A * Math.PI / 180;
    var dno = ty + s * (g.D / 2) * Math.cos(rad) * 1.12;
    st.setProperty('--sj-y', (dno + mix(g.W * 0.085, g.W * 0.01, tA)).toFixed(1) + 'px');
    st.setProperty('--sj-sx', mix(0.8, 1.02, tA).toFixed(3));
    st.setProperty('--sj-sy', mix(1, 0.5, tA).toFixed(3));
    st.setProperty('--sj-o', mix(0.75, 0, seg(p, 0.4, 0.75)).toFixed(3));

    // Logo: s poklopca u izbornik
    var tl = ease(seg(p, 0.02, 0.46));
    st.setProperty('--l-ty', (ty0 * (1 - tl)).toFixed(2) + 'px');
    st.setProperty('--l-s', mix(S0, 1, tl).toFixed(4));
    st.setProperty('--l-A', (A0 * (1 - tl)).toFixed(2) + 'deg');
    st.setProperty('--l-tz', (g.TL * (1 - tl)).toFixed(2) + 'px');
    st.setProperty('--lt', seg(p, 0.2, 0.3).toFixed(3));
    place(lMono, g.mono0, g.mono1, g.kMono, tl);
    place(lWord, g.word0, g.word1, g.kWord, tl);
    var sletio = tl >= 1;
    ploha.style.visibility = sletio ? 'hidden' : '';
    nav.classList.toggle('lh-gotov', sletio);

    // Izbornik
    var izb = seg(p, 0.3, 0.52);
    nav.style.setProperty('--lh-izb', izb.toFixed(3));
    nav.classList.toggle('lh-skriven', izb < 0.5);
  }
  function tick() { if (!raf) raf = requestAnimationFrame(render); }

  function init() { measure(); render(); }
  init();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init);
  window.addEventListener('load', init);
  window.addEventListener('scroll', tick, { passive: true });
  window.addEventListener('resize', function () { measure(); tick(); });
})();
