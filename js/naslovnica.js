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

// Mobitel u heru sam polako odvrti put klijenta (pretraga, Google profil, web, AI asistent) i krene ispočetka.
// Element s data-a="od,do" pojavljuje se dok napredak p ide od "od" do "do", data-o ga skriva; CSS čita --t (0 do 1).
// Vrijeme teče samo dok je mobitel na ekranu i kartica otvorena. Uz "smanjeno kretanje" mobitel stoji na zadnjem kadru.
(function(){
  var hero = document.querySelector(".mob-hero");
  if(!hero || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  hero.classList.add("vrti");

  var TRAJE = 18000, STOJI = 3000, GASI = 600, KRAJ = .92;   // ms: priča, zadržavanje na kraju, prijelaz na početak

  function seg(p, a, b){ return p <= a ? 0 : p >= b ? 1 : (p - a) / (b - a); }
  function ease(x){ return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function raspon(el, ime){ var r = el.getAttribute(ime); return r && r.split(",").map(parseFloat); }

  var anim = [].map.call(hero.querySelectorAll("[data-a],[data-o]"), function(el){
    return {el: el, a: raspon(el, "data-a"), o: raspon(el, "data-o")};
  });
  var pisanje = hero.querySelector(".tr-tekst"), ekran = hero.querySelector(".mob-ekran");

  function crtaj(p){
    anim.forEach(function(x){
      var t = x.a ? ease(seg(p, x.a[0], x.a[1])) : 1;
      if(x.o) t *= 1 - ease(seg(p, x.o[0], x.o[1]));
      x.el.style.setProperty("--t", t.toFixed(3));
    });
    pisanje.style.setProperty("--pis", seg(p, .03, .12).toFixed(3));
  }

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
    new IntersectionObserver(function(e){ vidljiv = e[0].isIntersecting; }).observe(hero.querySelector(".mob"));
  }
  crtaj(0);
  requestAnimationFrame(korak);
})();
