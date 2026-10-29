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
