// PRIJEDLOG naslovnice: skrol kroz sekciju pretvara se u napredak p (0 do 1).
// Element s data-a="od,do" pojavljuje se dok p ide od "od" do "do"; data-o="od,do" ga skriva.
// Kadrovi teksta (data-k) imaju svoje raspone niže. Mijenja se samo varijabla --t, a CSS radi ostalo.
(function(){
  var sec = document.querySelector(".skrol");
  if(!sec || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  sec.classList.add("radi");

  var KADROVI = [[-1, 0, .09, .12], [.12, .16, .36, .40], [.41, .45, .64, .68], [.69, .73, .88, .91], [.92, .96, 2, 2]];
  var KORACI = {1: [.12, .40], 2: [.41, .68], 3: [.69, .91]};

  function seg(p, a, b){ return p <= a ? 0 : p >= b ? 1 : (p - a) / (b - a); }
  function ease(x){ return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function raspon(el, ime){ var r = el.getAttribute(ime); return r && r.split(",").map(parseFloat); }

  var anim = [].map.call(sec.querySelectorAll("[data-a],[data-o]"), function(el){
    return {el: el, a: raspon(el, "data-a"), o: raspon(el, "data-o")};
  });
  var kadrovi = [].slice.call(sec.querySelectorAll(".kadar"));
  var koraci = [].slice.call(sec.querySelectorAll("[data-c]"));
  var pisanje = sec.querySelector(".tr-tekst");

  var zadnji = -1, ceka = false;
  function crtaj(){
    ceka = false;
    var r = sec.getBoundingClientRect(), dug = sec.offsetHeight - innerHeight;
    var p = dug > 0 ? Math.min(1, Math.max(0, -r.top / dug)) : 1;
    if(Math.abs(p - zadnji) < .0005) return;
    zadnji = p;

    anim.forEach(function(x){
      var t = x.a ? ease(seg(p, x.a[0], x.a[1])) : 1;
      if(x.o) t *= 1 - ease(seg(p, x.o[0], x.o[1]));
      x.el.style.setProperty("--t", t.toFixed(3));
    });
    kadrovi.forEach(function(el, i){
      var k = KADROVI[i], t = Math.min(seg(p, k[0], k[1]), 1 - seg(p, k[2], k[3]));
      el.style.setProperty("--t", ease(t).toFixed(3));
      el.classList.toggle("vidljiv", t > .5);
      el.toggleAttribute("inert", t <= .5);
    });
    koraci.forEach(function(el){
      var k = KORACI[el.getAttribute("data-c")];
      el.style.setProperty("--t", seg(p, k[0], k[1]).toFixed(3));
    });
    pisanje.style.setProperty("--pis", seg(p, .03, .12).toFixed(3));
  }
  function zakazi(){ if(!ceka){ ceka = true; requestAnimationFrame(crtaj); } }
  crtaj();
  addEventListener("scroll", zakazi, {passive: true});
  addEventListener("resize", function(){ zadnji = -1; zakazi(); });
})();
