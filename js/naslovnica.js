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

// Karusel u heru: slajd se mijenja svakih 5 s (--slide-ms u CSS-u) i vrti se u krug.
// Naslov, podnaslov, vizual i traka usluga mijenjaju se zajedno. Staje na gumb, dok je hero izvan ekrana,
// dok je kartica u pozadini i dok je fokus tipkovnicom u heru. Uz "smanjeno kretanje" ne vrti se sam, ali se može listati.
(function () {
  const hero     = document.querySelector('.kar');
  if (!hero) return;
  const slides   = [...hero.querySelectorAll('.slide')];
  const titles   = [...hero.querySelectorAll('.kar__title')];
  const leads    = [...hero.querySelectorAll('.kar__lead')];
  const services = [...hero.querySelectorAll('.services li[data-for]')];
  const dotsWrap = document.getElementById('dots');
  const countNow = document.getElementById('countNow');
  const stage    = document.getElementById('stage');

  const DURATION = parseInt(getComputedStyle(hero).getPropertyValue('--slide-ms'), 10) || 5000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let current = 0, timer = null, startedAt = 0, remaining = DURATION, paused = false;

  // Crtice napretka (ujedno gumbi za odabir slajda)
  const dots = slides.map((_, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'kar__dot';
    b.type = 'button';
    b.setAttribute('aria-label', 'Prikaži slajd ' + (i + 1));
    b.innerHTML = '<i></i>';
    b.addEventListener('click', () => { goTo(i); if (paused) remaining = DURATION; else restart(); });
    li.appendChild(b); dotsWrap.appendChild(li);
    return b;
  });

  function setActive(list, i) { list.forEach((el, n) => el.classList.toggle('is-active', n === i)); }

  function goTo(i) {
    current = (i + slides.length) % slides.length;
    setActive(slides, current);
    setActive(titles, current);
    setActive(leads, current);
    services.forEach(li => li.classList.toggle('is-active', +li.dataset.for === current));
    dots.forEach((d, n) => {
      d.classList.toggle('is-done', n < current);
      d.classList.remove('is-active');
      d.setAttribute('aria-current', n === current ? 'true' : 'false');
    });
    // ponovno pokreni animaciju crtice na aktivnom slajdu
    void dots[current].offsetWidth;
    dots[current].classList.add('is-active');
    countNow.textContent = String(current + 1).padStart(2, '0');
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (reduceMotion) return;
    startedAt = performance.now();
    remaining = ms;
    timer = setTimeout(() => { goTo(current + 1); schedule(DURATION); }, ms);
  }
  function restart() { schedule(DURATION); }

  // Karusel stoji iz više razloga odjednom (gumb, kartica u pozadini, hero izvan ekrana, fokus tipkovnicom).
  // Vrti se tek kad nijedan razlog ne vrijedi, pa ga nijedan događaj ne može ostaviti zaglavljenog.
  // Prelazak mišem namjerno NE zaustavlja karusel: vizual zauzima pola ekrana i miš je često na njemu.
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
    paused = now;
  }

  // Gumb za zaustavljanje (pristupačnost: sadržaj koji se sam mijenja mora se moći zaustaviti)
  const pauseBtn = hero.querySelector('.kar__pause');
  if (pauseBtn) {
    if (reduceMotion) pauseBtn.hidden = true;
    pauseBtn.addEventListener('click', () => {
      const stop = !reasons.has('user');
      setReason('user', stop, true);
      pauseBtn.setAttribute('aria-pressed', stop);
      pauseBtn.setAttribute('aria-label', stop ? 'Pokreni karusel' : 'Zaustavi karusel');
    });
  }

  // Kartica u pozadini
  document.addEventListener('visibilitychange', () => setReason('hidden', document.hidden));

  // Hero izvan ekrana: kad se vrati, trenutni slajd dobiva punih 5 sekundi
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

  // Povlačenje prstom na mobitelu
  let touchX = null;
  stage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) { goTo(current + (dx < 0 ? 1 : -1)); if (paused) remaining = DURATION; else restart(); }
    touchX = null;
  });

  goTo(0);
  schedule(DURATION);
})();
