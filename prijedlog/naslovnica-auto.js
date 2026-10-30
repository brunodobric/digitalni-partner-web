// PRIJEDLOG naslovnice, varijanta bez skrola: tekst stoji, a mobitel sam polako odvrti priču i krene ispočetka.
// Koristi iste oznake kao skrol varijanta (data-a, data-o, --t), samo napredak p ne dolazi od skrola nego od vremena.
(function(){
  var sec = document.querySelector(".skrol");
  if(!sec || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  sec.classList.add("vrti");

  var TRAJE = 18000, STOJI = 3000, GASI = 600;   // ms: priča, zadržavanje na kraju, prijelaz na početak
  var KRAJ = .92;

  function seg(p, a, b){ return p <= a ? 0 : p >= b ? 1 : (p - a) / (b - a); }
  function ease(x){ return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function raspon(el, ime){ var r = el.getAttribute(ime); return r && r.split(",").map(parseFloat); }

  var anim = [].map.call(sec.querySelectorAll("[data-a],[data-o]"), function(el){
    return {el: el, a: raspon(el, "data-a"), o: raspon(el, "data-o")};
  });
  var pisanje = sec.querySelector(".tr-tekst");
  var ekran = sec.querySelector(".mob-ekran");

  function crtaj(p){
    anim.forEach(function(x){
      var t = x.a ? ease(seg(p, x.a[0], x.a[1])) : 1;
      if(x.o) t *= 1 - ease(seg(p, x.o[0], x.o[1]));
      x.el.style.setProperty("--t", t.toFixed(3));
    });
    pisanje.style.setProperty("--pis", seg(p, .03, .12).toFixed(3));
  }

  // Vrijeme teče samo dok je mobitel na ekranu i kartica otvorena.
  var vidljiv = true, proteklo = 0, zadnji = null;
  function korak(sad){
    if(zadnji !== null && vidljiv && !document.hidden) proteklo += Math.min(100, sad - zadnji);
    zadnji = sad;
    var krug = proteklo % (TRAJE + STOJI + GASI);
    crtaj(Math.min(1, krug / TRAJE) * KRAJ);
    ekran.style.opacity = krug > TRAJE + STOJI ? Math.max(0, 1 - (krug - TRAJE - STOJI) / (GASI / 2)) : Math.min(1, krug / (GASI / 2) || 1);
    requestAnimationFrame(korak);
  }
  if("IntersectionObserver" in window){
    new IntersectionObserver(function(e){ vidljiv = e[0].isIntersecting; }).observe(sec.querySelector(".mob"));
  }
  crtaj(0);
  requestAnimationFrame(korak);
})();
