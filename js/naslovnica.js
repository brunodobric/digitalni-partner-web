// Naslovnica: tanka zlatna traka pokazuje koliko je stranice pročitano, a linija ispod izbornika pojavi se tek pri skrolanju.
(function(){
  var bar = document.getElementById("bar"), navEl = document.querySelector("nav");
  function update(){
    var y = window.pageYOffset || 0, h = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (h > 0 ? y / h * 100 : 0) + "%";
    navEl.style.setProperty("--p", Math.min(1, y / 120).toFixed(3));
  }
  update();
  window.addEventListener("scroll", update, {passive:true});
  window.addEventListener("resize", update);
})();

// Karusel u heru: svaki slajd je druga vrsta posla (salon, kozmetika, trener, kafić, apartman).
// Svaki element s atributom data-i (fotografija, mobitel s profilom, naziv vrste posla) dobiva
// klasu is-active kad je njegov slajd na redu; prethodni dobiva was-active dok se novi ne pojavi.
// Slajd stoji --slide-ms (u stil.css) i vrti se u krug. Staje na gumb, dok je hero izvan ekrana,
// dok je kartica u pozadini i dok je fokus tipkovnicom u heru. Uz "smanjeno kretanje" ne vrti se sam, ali se može listati.
(function () {
  const hero = document.querySelector('.b-hero');
  if (!hero) return;
  // Skriveni elementi (atribut hidden, vidi SKRIVENE-USLUGE.md) ne ulaze u karusel
  const items = [...hero.querySelectorAll('[data-i]:not([hidden])')];
  const n = Math.max(...items.map(el => +el.dataset.i)) + 1;
  const dotsWrap = hero.querySelector('.pk-dots');
  const countNow = hero.querySelector('.pk-now');
  const countAll = hero.querySelector('.pk-all');
  const scena    = hero.querySelector('.b-scena');
  const DURATION = parseInt(getComputedStyle(hero).getPropertyValue('--slide-ms'), 10) || 7000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (countAll) countAll.textContent = String(n).padStart(2, '0');

  let current = -1, timer = null, startedAt = 0, remaining = DURATION;

  // Crtice napretka (ujedno gumbi za odabir slajda)
  const dots = Array.from({ length: n }, (_, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Prikaži slajd ' + (i + 1));
    b.innerHTML = '<i></i>';
    b.addEventListener('click', () => { goTo(i); if (reasons.size) remaining = DURATION; else schedule(DURATION); });
    li.appendChild(b); dotsWrap.appendChild(li);
    return b;
  });

  function goTo(i) {
    const prev = current;
    current = (i + n) % n;
    items.forEach(el => {
      const k = +el.dataset.i;
      el.classList.toggle('is-active', k === current);
      el.classList.toggle('was-active', k === prev && k !== current);
    });
    dots.forEach((d, k) => {
      d.classList.toggle('is-done', k < current);
      d.classList.remove('is-active');
      d.setAttribute('aria-current', k === current ? 'true' : 'false');
    });
    void dots[current].offsetWidth;   // ponovno pokreni animaciju crtice
    dots[current].classList.add('is-active');
    if (countNow) countNow.textContent = String(current + 1).padStart(2, '0');
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (reduceMotion) return;
    startedAt = performance.now();
    remaining = ms;
    timer = setTimeout(() => { goTo(current + 1); schedule(DURATION); }, ms);
  }

  // Karusel stoji iz više razloga odjednom; vrti se tek kad nijedan ne vrijedi.
  // Prelazak mišem namjerno NE zaustavlja karusel: scena zauzima pola ekrana i miš je često na njoj.
  const reasons = new Set();
  function setReason(name, on, freshSlide) {
    const was = reasons.size > 0;
    if (on) reasons.add(name); else reasons.delete(name);
    const now = reasons.size > 0;
    if (!was && now) {
      clearTimeout(timer);
      remaining -= performance.now() - startedAt;
      hero.classList.add('is-paused');
    } else if (was && !now) {
      hero.classList.remove('is-paused');
      if (freshSlide || remaining < 400) { goTo(current); schedule(DURATION); }  // crtica kreće ispočetka
      else schedule(remaining);
    }
  }

  // Gumb za zaustavljanje (pristupačnost: sadržaj koji se sam mijenja mora se moći zaustaviti)
  const pauseBtn = hero.querySelector('.pk-pause');
  if (pauseBtn) {
    if (reduceMotion) pauseBtn.hidden = true;
    pauseBtn.addEventListener('click', () => {
      const stop = !reasons.has('user');
      setReason('user', stop, true);
      pauseBtn.setAttribute('aria-pressed', stop);
      pauseBtn.setAttribute('aria-label', stop ? 'Pokreni karusel' : 'Zaustavi karusel');
    });
  }

  document.addEventListener('visibilitychange', () => setReason('hidden', document.hidden));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(e => setReason('offscreen', !e[0].isIntersecting, true), { threshold: 0.2 }).observe(hero);
  }

  // Fokus tipkovnicom (Tab) unutar hera; klik mišem na crticu ne zaustavlja karusel
  hero.addEventListener('focusin', e => {
    let kb = false; try { kb = e.target.matches(':focus-visible'); } catch (_) {}
    setReason('focus', kb);
  });
  hero.addEventListener('focusout', e => { if (!hero.contains(e.relatedTarget)) setReason('focus', false); });

  // Tipkovnica: strelice lijevo/desno kad je fokus u heru
  hero.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { goTo(current + 1); remaining = DURATION; }
    if (e.key === 'ArrowLeft')  { goTo(current - 1); remaining = DURATION; }
  });

  // Povlačenje prstom po sceni na mobitelu
  let touchX = null;
  scena.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  scena.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) { goTo(current + (dx < 0 ? 1 : -1)); if (reasons.size) remaining = DURATION; else schedule(DURATION); }
    touchX = null;
  });

  // Prvi slajd se prikaže odmah, bez prijelaza
  hero.classList.add('pk-init');
  goTo(0);
  schedule(DURATION);
  requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.remove('pk-init')));
})();

// Traka fotografija "Za koga radimo": popis se udvostruči da putuje bez prekida (uz smanjeno kretanje stoji i može se listati)
(function () {
  const red = document.querySelector('.b-film__red');
  if (!red || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  [...red.children].forEach(li => { const k = li.cloneNode(true); k.setAttribute('aria-hidden', 'true'); red.appendChild(k); });
})();
