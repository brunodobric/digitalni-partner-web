// Obrazac za upit.
// FORM_ENDPOINT: upit ide u Worker dashboarda (dp-nadzor), koji ga sprema u bazu i prikazuje u lijevku prodaje.
// Nakon uspješnog slanja otvara se /hvala. Ako slanje ne uspije, posjetitelj vidi adresu na koju može pisati izravno. Prazna adresa vraća stari način
// (upit se šalje preko programa za e-poštu).
(function(){
  var FORM_ENDPOINT = "https://dp-nadzor.bruno-dobric32.workers.dev/upit";
  var CONTACT_EMAIL = "info@digitalnipartner.hr";
  var f = document.getElementById("cform"), msg = document.getElementById("msg");
  var plan = new URLSearchParams(location.search).get("plan");
  if(plan && !f.poruka.value.trim()) f.poruka.value = "Zanima me: " + plan + ".";
  // Gumbi "Odaberite D ..." na naslovnici vode na obrazac na istoj stranici: upisuju paket bez ponovnog učitavanja
  document.querySelectorAll('a[href^="/?plan="]').forEach(function(a){
    a.addEventListener("click", function(ev){
      if(location.pathname !== "/") return;
      ev.preventDefault();
      f.poruka.value = "Zanima me: " + new URLSearchParams(a.search).get("plan") + ".";
      document.getElementById("kontakt").scrollIntoView();
      f.ime.focus({preventScroll:true});
    });
  });

  // Provjera po polju: poruka o grešci stoji ispod polja koje nije ispravno
  var PRAVILA = {
    ime: function(v){ return v.trim() ? "" : "Upišite ime i prezime."; },
    email: function(v){ return !v.trim() ? "Upišite e-mail adresu." : (/^\S+@\S+\.\S+$/.test(v) ? "" : "Provjerite e-mail adresu, npr. ime@primjer.hr."); },
    poruka: function(v){ return v.trim() ? "" : "Napišite nam ukratko što Vam treba."; }
  };
  function check(name){
    var greska = PRAVILA[name](f[name].value);
    document.getElementById(name + "-err").textContent = greska;
    if(greska) f[name].setAttribute("aria-invalid", "true"); else f[name].removeAttribute("aria-invalid");
    return !greska;
  }
  function validate(){
    var prvo = null;
    Object.keys(PRAVILA).forEach(function(n){ if(!check(n) && !prvo) prvo = f[n]; });
    if(prvo) prvo.focus();
    return !prvo;
  }
  Object.keys(PRAVILA).forEach(function(n){
    f[n].addEventListener("input", function(){ if(f[n].hasAttribute("aria-invalid")) check(n); });
  });

  function fallback(){
    msg.textContent = "Ako se program za e-poštu nije otvorio, pošaljite upit izravno na ";
    var a = document.createElement("a");
    a.href = "mailto:" + CONTACT_EMAIL; a.textContent = CONTACT_EMAIL;
    msg.appendChild(a); msg.appendChild(document.createTextNode("."));
  }

  f.addEventListener("submit", function(ev){
    ev.preventDefault();
    if(!validate()){ msg.textContent = ""; return; }
    if(FORM_ENDPOINT){
      msg.textContent = "Šaljemo upit…";
      fetch(FORM_ENDPOINT, {method:"POST", body:new FormData(f), headers:{Accept:"application/json"}})
        .then(function(r){
          if(!r.ok) throw r;
          // Uspjeh: otvara se stranica zahvale /hvala (noindex, nije u izborniku). Upisanu adresu prikazuje samo ona,
          // a iz sessionStorage je briše čim je pročita. Posjeti na /hvala u Web Analytics = broj poslanih upita.
          try { sessionStorage.setItem("dp-upit-email", f.email.value.trim()); } catch(x){}
          msg.textContent = "Hvala, upit je poslan.";
          window.location.href = "/hvala";
        })
        .catch(fallback);
      return;
    }
    var body = "Ime: " + f.ime.value + "\nE-mail: " + f.email.value + "\nTelefon: " + f.tel.value + "\n\n" + f.poruka.value;
    window.location.href = "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent("Upit s web stranice: " + f.ime.value) + "&body=" + encodeURIComponent(body);
    setTimeout(fallback, 800);
  });
})();
