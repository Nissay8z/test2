// ============================================================
// Nuvio Provider — Anime-Sama VF/VOSTFR
// Auteur : toi
// ============================================================

const BASE_URL = "https://anime-sama.to";
const TMDB_API_KEY = "5c58981da360006c81aacde445bb204a"; // ← à remplacer

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer": "https://anime-sama.pw/"
};

// ------------------------------------------------------------
// Utilitaire : requête HTTP texte
// ------------------------------------------------------------
function fetchText(url, extra = {}) {
    return fetch(url, { headers: { ...HEADERS, ...extra } })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.text(); });
}

// ------------------------------------------------------------
// Récupère le titre depuis TMDB
// ------------------------------------------------------------
function titreDepuisTMDB(tmdbId, mediaType) {
    const url = mediaType === "tv"
        ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=fr-FR`
        : `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=fr-FR`;
    return fetch(url)
        .then(r => r.json())
        .then(data => data.name || data.title || data.original_name || data.original_title || null);
}

// ------------------------------------------------------------
// Recherche sur Anime-Sama
// ------------------------------------------------------------
function rechercher(q) {
    return fetch(`${BASE_URL}/template-php/defaut/fetch.php`, {
        method: "POST",
        headers: {
            ...HEADERS,
            "Referer": BASE_URL + "/",
            "Origin": BASE_URL,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: `query=${encodeURIComponent(q)}`
    })
    .then(r => r.text())
    .then(html => {
        const resultats = [];
        const regex = /<a\s+href="([^"]+)"\s+class="[^"]*asn-search-result[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = regex.exec(html)) !== null) {
            const url = m[1].startsWith("http") ? m[1] : BASE_URL + m[1];
            const h3 = m[2].match(/<h3[^>]*class="[^"]*asn-search-result-title[^"]*"[^>]*>([^<]+)<\/h3>/i);
            const titre = h3 ? h3[1].trim() : m[2].replace(/<[^>]+>/g, " ").trim().slice(0, 60);
            resultats.push({ url, titre });
        }
        return resultats;
    });
}

// ------------------------------------------------------------
// Saisons + langues
// ------------------------------------------------------------
function listerSaisons(url) {
    return fetchText(url).then(html => {
        const saisons = {};
        const regex = /panneauAnime\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
        let m;
        while ((m = regex.exec(html)) !== null) {
            const num = m[2].match(/saison(\d+)/i);
            if (!num) continue;
            const lang = m[2].match(/\/([a-z0-9]+)$/i);
            const langue = lang ? lang[1].toLowerCase() : "vostfr";
            const urlS = url.replace(/\/$/, "") + "/" + m[2].replace(/\/$/, "") + "/";
            if (!saisons[num[1]]) saisons[num[1]] = { label: m[1], langues: {} };
            saisons[num[1]].langues[langue] = urlS;
        }
        return Object.keys(saisons).sort((a,b)=>a-b).map(n => ({
            numero: parseInt(n), label: saisons[n].label, langues: saisons[n].langues
        }));
    });
}

// ------------------------------------------------------------
// Épisodes depuis episodes.js
// ------------------------------------------------------------
function extraireEpisodes(urlSaison) {
    return fetchText(urlSaison.replace(/\/$/, "") + "/episodes.js", { "Referer": urlSaison })
    .then(js => {
        js = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
        const lecteurs = {};
        const regex = /var\s+eps(\d+)\s*=\s*(\[[\s\S]*?\])\s*;?/g;
        let m;
        while ((m = regex.exec(js)) !== null) {
            try { lecteurs[parseInt(m[1])] = JSON.parse(m[2]); }
            catch (e) {
                const urls = m[2].match(/["'](https?:\/\/[^"']+)["']/g) || [];
                lecteurs[parseInt(m[1])] = urls.map(u => u.replace(/["']/g, ""));
            }
        }
        if (Object.keys(lecteurs).length === 0) return [];
        const nb = Math.max(...Object.values(lecteurs).map(l => l.length));
        const eps = [];
        for (let i = 0; i < nb; i++) {
            const urls = [];
            Object.keys(lecteurs).sort((a,b)=>a-b).forEach(n => {
                if (lecteurs[n][i]) urls.push(lecteurs[n][i]);
            });
            if (!urls.length) continue;
            eps.push({ episode_index: i+1, url_embed: urls[0], lecteurs: urls });
        }
        return eps;
    });
}

// ------------------------------------------------------------
// Résolution flux direct (mp4/hls)
// ------------------------------------------------------------
function resoudreFlux(urlEmbed) {
    const dom = new URL(urlEmbed).hostname.toLowerCase();
    if (dom.includes("sibnet.ru")) return Promise.resolve(null);
    return fetchText(urlEmbed, { "Referer": BASE_URL + "/" }).then(texte => {
        texte = texte.replace(/\\\//g, "/");
        for (const { regex, type } of [
            { regex: /(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/, type: "hls" },
            { regex: /(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/, type: "mp4" }
        ]) {
            const m = texte.match(regex);
            if (m) return { url: m[1], type, referer: urlEmbed };
        }
        return null;
    }).catch(() => null);
}

// ============================================================
// FONCTION PRINCIPALE — Nuvio appelle ça
// ============================================================
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    console.log(`[AnimeSama] getStreams(${tmdbId}, ${mediaType}, S${seasonNum}E${episodeNum})`);
    if (!TMDB_API_KEY || TMDB_API_KEY === "COLLE_TA_CLE_TMDB_ICI") {
        console.error("[AnimeSama] ⚠️ Clé TMDB non configurée !");
        return Promise.resolve([]);
    }

    return titreDepuisTMDB(tmdbId, mediaType)
        .then(titre => {
            if (!titre) throw new Error("Titre introuvable via TMDB");
            console.log(`[AnimeSama] Titre TMDB : ${titre}`);
            return rechercher(titre);
        })
        .then(rs => {
            if (!rs.length) throw new Error("Aucun résultat sur Anime-Sama");
            return rs[0];
        })
        .then(anime => {
            console.log(`[AnimeSama] Cible : ${anime.titre}`);
            return listerSaisons(anime.url).then(saisons => ({ anime, saisons }));
        })
        .then(({ anime, saisons }) => {
            const s = saisons.find(x => x.numero === seasonNum) || saisons[0];
            const langue = s.langues.vostfr ? "vostfr" : (s.langues.vf ? "vf" : Object.keys(s.langues)[0]);
            console.log(`[AnimeSama] Saison : ${s.label} (${langue})`);
            return extraireEpisodes(s.langues[langue]).then(eps => ({ anime, eps, langue }));
        })
        .then(({ anime, eps, langue }) => {
            const ep = eps.find(e => e.episode_index === episodeNum) || eps[0];
            if (!ep) throw new Error("Épisode introuvable");
            console.log(`[AnimeSama] Épisode : ${ep.episode_index} (${ep.lecteurs.length} lecteurs)`);
            return Promise.all(ep.lecteurs.map(resoudreFlux)).then(flux => ({ anime, ep, flux, langue }));
        })
        .then(({ anime, ep, flux, langue }) => {
            const streams = [];
            flux.forEach(f => {
                if (!f || !f.url) return;
                streams.push({
                    name: `Anime-Sama ${langue.toUpperCase()}`,
                    title: `${anime.titre} - Ép. ${ep.episode_index} [${f.type.toUpperCase()}]`,
                    url: f.url,
                    quality: "auto",
                    headers: { "Referer": f.referer || BASE_URL + "/" }
                });
            });
            console.log(`[AnimeSama] ${streams.length} flux retourné(s)`);
            return streams;
        })
        .catch(err => {
            console.error("[AnimeSama] Erreur :", err.message);
            return [];
        });
}

// ============================================================
// EXPORT
// ============================================================
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
}