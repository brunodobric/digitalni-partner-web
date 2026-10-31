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
// Naslov, podnaslov, vizual i traka usluga mijenjaju se zajedno. Staje dok je miš iznad ili je fokus u heru,
// i dok je kartica u pozadini. Uz "smanjeno kretanje" ne vrti se sam, ali se može listati.
(function () {
  const hero     = document.querySelector('.kar');
  if (!hero) return;
  const slides   = [...hero.querySelectorAll('.slide')];
  const titles   = [...hero.querySelectorAll('.kar__title')];
  const leads    = [...hero.querySelectorAll('.kar__lead')];
  const services = [...hero.querySelectorAll('.services li[data-for]')];
  const dotsWrap = document.getElementById('dots');
  const countNow = document.getElementById('countNow');
  const copy     = hero.querySelector('.kar__copy');
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
    b.addEventListener('click', () => { goTo(i); restart(); });
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

  function pause() {
    if (paused || reduceMotion) return;
    paused = true;
    clearTimeout(timer);
    remaining -= performance.now() - startedAt;
    hero.classList.add('is-paused');
  }
  function resume() {
    if (!paused) return;
    paused = false;
    hero.classList.remove('is-paused');
    schedule(Math.max(remaining, 400));
  }

  // Pauza dok korisnik čita ili klikće
  [copy, stage].forEach(el => {
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', resume);
  });
  hero.addEventListener('focusin', pause);
  hero.addEventListener('focusout', resume);
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());

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
    if (Math.abs(dx) > 40) { goTo(current + (dx < 0 ? 1 : -1)); restart(); }
    touchX = null;
  });

  goTo(0);
  schedule(DURATION);
})();
