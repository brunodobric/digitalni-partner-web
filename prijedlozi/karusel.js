// Probne naslovnice: jednostavan karusel. Svaki element s atributom data-i unutar korijena dobiva klasu is-active
// kad je njegov slajd na redu (fotografije, naslovi, natpisi, uređaji). Vrti se u krug svakih --slide-ms,
// staje na gumb, kad je izvan ekrana i kad je kartica u pozadini. Uz "smanjeno kretanje" ne vrti se sam.
window.pkKarusel = function (root, opts) {
  opts = opts || {};
  var items = [].slice.call(root.querySelectorAll('[data-i]'));
  var n = 0; items.forEach(function (el) { n = Math.max(n, +el.dataset.i + 1); });
  var ms = parseInt(getComputedStyle(root).getPropertyValue('--slide-ms'), 10) || 6000;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dotsWrap = root.querySelector('.pk-dots'), pauseBtn = root.querySelector('.pk-pause'), countNow = root.querySelector('.pk-now');
  var cur = -1, timer = null, userPaused = false, hidden = false, offscreen = false;

  var dots = [];
  if (dotsWrap) for (var i = 0; i < n; i++) (function (i) {
    var li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', 'Prikaži slajd ' + (i + 1)); b.innerHTML = '<i></i>';
    b.addEventListener('click', function () { go(i); plan(); });
    li.appendChild(b); dotsWrap.appendChild(li); dots.push(b);
  })(i);

  function go(i) {
    var prev = cur; cur = (i + n) % n;
    items.forEach(function (el) {
      var on = +el.dataset.i === cur;
      el.classList.toggle('is-active', on);
      el.classList.toggle('was-active', +el.dataset.i === prev && !on);
      if (el.matches('[aria-hidden-when-off]')) el.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    dots.forEach(function (d, k) {
      d.classList.toggle('is-done', k < cur); d.classList.remove('is-active');
      d.setAttribute('aria-current', k === cur ? 'true' : 'false');
    });
    if (dots[cur]) { void dots[cur].offsetWidth; dots[cur].classList.add('is-active'); }
    if (countNow) countNow.textContent = String(cur + 1).padStart(2, '0');
    if (opts.onChange) opts.onChange(cur, prev);
  }
  function stopped() { return reduce || userPaused || hidden || offscreen; }
  function plan() {
    clearTimeout(timer);
    root.classList.toggle('is-paused', stopped());
    if (stopped()) return;
    timer = setTimeout(function () { go(cur + 1); plan(); }, ms);
  }
  if (pauseBtn) pauseBtn.addEventListener('click', function () {
    userPaused = !userPaused;
    pauseBtn.setAttribute('aria-pressed', userPaused); pauseBtn.setAttribute('aria-label', userPaused ? 'Pokreni karusel' : 'Zaustavi karusel');
    if (!userPaused) go(cur + 1);
    plan();
  });
  document.addEventListener('visibilitychange', function () { hidden = document.hidden; plan(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { offscreen = !e[0].isIntersecting; plan(); }).observe(root);
  root.classList.add('pk-ready');
  go(0); plan();
  return { go: go };
};
