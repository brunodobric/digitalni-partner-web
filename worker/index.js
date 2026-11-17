// Jedini serverski kod weba. Cloudflare adrese s nastavkom .html preusmjerava na adresu bez nastavka (/hvala.html -> /hvala).
// Google Search Console datoteku za potvrdu vlasništva traži točno na adresi s .html i ne smije dobiti preusmjeravanje,
// pa ovdje tu jednu adresu vraćamo izravno (sadržaj se čita iz datoteke u korijenu). Sve ostalo ide ravno na statične datoteke.
const POTVRDA_GOOGLE = "/googleb1c04fa9c791f150.html";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === POTVRDA_GOOGLE) {
      const datoteka = await env.ASSETS.fetch(new URL(POTVRDA_GOOGLE.replace(/\.html$/, ""), url));
      return new Response(await datoteka.text(), {
        status: datoteka.status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
