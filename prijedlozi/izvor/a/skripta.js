// Prijedlog A: karusel u heru, pojavljivanje redova pri skrolanju i blagi paralaks fotografija
pkKarusel(document.querySelector('.a-hero'));
(function () {
  var rv = [].slice.call(document.querySelectorAll('.rv'));
  if (!('IntersectionObserver' in window)) { rv.forEach(function (e) { e.classList.add('in'); }); return; }
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -12% 0px' });
  rv.forEach(function (e) { io.observe(e); });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var fotke = [].slice.call(document.querySelectorAll('.a-red__foto img')), tick = false;
  function par() {
    tick = false;
    fotke.forEach(function (img) {
      var r = img.parentNode.getBoundingClientRect(), p = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      img.style.setProperty('--par', (-7 - p * 7).toFixed(2) + '%');
    });
  }
  addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(par); } }, { passive: true });
  par();
})();
