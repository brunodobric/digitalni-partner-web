// Izvor posjeta za obrazac za upit: odakle je posjetitelj došao kad je u ovoj kartici prvi put otvorio web.
// Redom: UTM oznake iz poveznice (npr. ?utm_source=instagram&utm_medium=bio), pa domena stranice s koje je kliknuo
// (npr. google.com), pa "izravno". Dodaje se i prva otvorena stranica, npr. "instagram · bio (ulaz: /cjenik)".
// Sprema se samo u sessionStorage ove kartice (briše se kad se kartica zatvori), bez kolačića, i šalje se jedino
// uz poslan upit (js/kontakt.js). Učitava se na svim stranicama jer posjetitelj može ući na bilo koju.
(function(){
  var K = "dp-izvor";
  function cisti(v){ return (v || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60); }
  function izracunaj(){
    var q = new URLSearchParams(location.search), dijelovi = [];
    ["utm_source", "utm_medium", "utm_campaign"].forEach(function(k){ var v = cisti(q.get(k)); if(v) dijelovi.push(v); });
    var izvor = "";
    if(cisti(q.get("utm_source"))) izvor = dijelovi.join(" · ");
    else if(document.referrer){
      var host = "";
      try { host = new URL(document.referrer).hostname.toLowerCase(); } catch(x){}
      host = host.replace(/^(www|m|l|lm)\./, "");
      // Prijelaz s jedne naše stranice na drugu znači da prvi dolazak nije zapamćen (npr. preglednik ne dopušta sessionStorage).
      if(host === location.hostname.replace(/^www\./, "")) return "nepoznato";
      izvor = host || "nepoznato";
    } else izvor = "izravno";
    return izvor + " (ulaz: " + location.pathname.slice(0, 60) + ")";
  }
  var izvor = "";
  try { izvor = sessionStorage.getItem(K) || ""; } catch(x){}
  if(!izvor){
    izvor = izracunaj();
    try { sessionStorage.setItem(K, izvor); } catch(x){}
  }
  window.dpIzvor = izvor;
})();
