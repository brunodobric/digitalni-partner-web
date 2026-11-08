// Prijedlog B: karusel u heru; traka fotografija se udvostruči da putuje bez prekida
pkKarusel(document.querySelector('.b-hero'));
(function () {
  var red = document.querySelector('.b-film__red');
  if (!red || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  [].slice.call(red.children).forEach(function (li) { var k = li.cloneNode(true); k.setAttribute('aria-hidden', 'true'); red.appendChild(k); });
})();
