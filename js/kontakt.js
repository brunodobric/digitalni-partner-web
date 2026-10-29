// Obrazac za upit.
// FORM_ENDPOINT: adresa servisa za obrasce (npr. Formspree ili Web3Forms). Dok je prazna, upit se šalje preko
// programa za e-poštu, a ako se on ne otvori, posjetitelj vidi adresu na koju može pisati izravno.
(function(){
  var FORM_ENDPOINT = "";
  var CONTACT_EMAIL = atob("YnJ1bm8uZG9icmljMzJAZ21haWwuY29t");
  var f = document.getElementById("cform"), msg = document.getElementById("msg");
  var plan = new URLSearchParams(location.search).get("plan");
  if(plan && !f.poruka.value.trim()) f.poruka.value = "Zanima me: " + plan + ".";

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
        .then(function(r){ if(!r.ok) throw r; f.reset(); msg.textContent = "Hvala, upit je poslan. Javit ćemo Vam se na upisanu adresu."; })
        .catch(fallback);
      return;
    }
    var body = "Ime: " + f.ime.value + "\nE-mail: " + f.email.value + "\nTelefon: " + f.tel.value + "\n\n" + f.poruka.value;
    window.location.href = "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent("Upit s web stranice: " + f.ime.value) + "&body=" + encodeURIComponent(body);
    setTimeout(fallback, 800);
  });
})();
