// Prijedlog C: karusel s upisivanjem pretrage i put klijenta koji prati skrolanje
(function () {
  var hero = document.querySelector('.c-hero');
  var upiti = [].slice.call(document.getElementById('c-upiti').content.querySelectorAll('i')).map(function (i) { return i.textContent; });
  var tip = hero.querySelector('.c-tip'), rez = [].slice.call(hero.querySelectorAll('.c-rez'));
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, t = null;
  function upisi(i) {
    clearTimeout(t);
    rez.forEach(function (r) { r.classList.remove('is-shown'); });
    var txt = upiti[i] || '', k = 0;
    if (reduce) { tip.textContent = txt; rez[i].classList.add('is-shown'); return; }
    tip.textContent = '';
    (function korak() {
      tip.textContent = txt.slice(0, ++k);
      if (k < txt.length) t = setTimeout(korak, 55 + Math.random() * 60);
      else t = setTimeout(function () { rez[i].classList.add('is-shown'); }, 350);
    })();
  }
  pkKarusel(hero, { onChange: function (i) { setTimeout(function () { upisi(i); }, 500); } });
})();

(function () {
  var koraci = [].slice.call(document.querySelectorAll('.c-korak')), ekrani = [].slice.call(document.querySelectorAll('.c-ekr'));
  function set(k) {
    koraci.forEach(function (e) { e.classList.toggle('is-on', +e.dataset.k === k); });
    ekrani.forEach(function (e) { e.classList.toggle('is-on', +e.dataset.k === k); });
  }
  set(0);
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) set(+e.target.dataset.k); });
  }, { rootMargin: '-52% 0px -38% 0px' });
  koraci.forEach(function (e) { io.observe(e); });
})();
