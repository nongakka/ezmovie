const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const simpleGit = require("simple-git");

const git = simpleGit();


// ================= CONFIG =================
const BASE = "https://ezmovie.movie";

const CATEGORIES = [
  "/movies/หนังมาใหม่",
  "/movies/หนังไทย",
  "/movies/หนังฝรั่ง",
  "/movies/หนังเกาหลี",
  "/movies/หนังญี่ปุ่น",
  "/movies/หนังเอเชีย",
  "/movies/หนังแอคชั่นบู๊-action",
  "/movies/หนังดราม่า-drama",
  "/movies/หนังผจญภัย-adventure",
  "/movies/หนังผู้ใหญ่-18-adult",
];

const TEST_MODE = false;   //false//true;
const MAX_PAGES = TEST_MODE ? 1 : 5;

const SAVE_EVERY = 30;
const COMMIT_EVERY = 50;

const RESUME_FILE = "resume.json";

// ================= FETCH =================
async function fetchHTML(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": BASE
      }
    });
    return data;
  } catch {
    console.log("❌ FETCH ERROR:", url);
    return null;
  }
}

// ================= RESUME =================
function loadResume() {
  if (fs.existsSync(RESUME_FILE)) {
    return JSON.parse(fs.readFileSync(RESUME_FILE));
  }
  return { done: [] };
}

function saveResume(data) {
  fs.writeFileSync(RESUME_FILE, JSON.stringify(data, null, 2));
}

// ================= LIST =================
async function getMovies(categoryPath, page = 1) {
  const url = `${BASE}${categoryPath}?page=${page}`;
  console.log(`📄 ${url}`);

  const html = await fetchHTML(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  const movies = [];

  $("a[data-url]").each((i, el) => {
    const title = $(el).find("h2.-title").text().trim();

    let image =
      $(el).find("img").attr("data-src") ||
      $(el).find("img").attr("src");

    if (image && image.startsWith("data:")) {
      image = $(el).find("source").attr("srcset");
    }

    const ajaxPath = $(el).attr("data-url");

    const movieUrl =
      BASE + ajaxPath.replace("/_ajax/movie/", "/movie/");

    movies.push({ title, image, movieUrl, category: categoryPath });
  });

  return movies;
}

// ================= PLAYER =================
async function extractFromPlayer(url) {
  const html = await fetchHTML(url);
  if (!html) return [];

  const matches = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/g);
  if (!matches) return [];

  return matches
    .filter(m => !m.includes("intro") && !m.includes("ads"))
    .map(m => ({
      name: "M3U8",
      url: m
    }));
}

// ================= DETAIL =================
async function getMoviePage(url) {
  const html = await fetchHTML(url);
  if (!html) return [];

  const $ = cheerio.load(html);
  let servers = [];

  for (const el of $("iframe").toArray()) {
    const src = $(el).attr("src");
    if (!src || src.includes("youtube")) continue;

    const inner = await extractFromPlayer(src);
    servers = servers.concat(inner);
  }

  return servers;
}

// ================= SAVE =================
function saveCategory(group, list) {
  const safe = group.replace(/[^\wก-๙]/g, "_");

  fs.writeFileSync(
    `playlist_${safe}.json`,
    JSON.stringify(list, null, 2)
  );

  let m3u = "#EXTM3U\n";

  list.forEach(item => {
    item.servers.forEach(s => {
      m3u += `#EXTINF:-1 tvg-logo="${item.logo}" group-title="${item.group}",${item.title}\n`;
      m3u += `${s.url}\n`;
    });
  });

  fs.writeFileSync(`playlist_${safe}.m3u`, m3u);
}

// ================= GIT =================
async function gitCommit(count) {
  try {
    await git.add(".");

    const status = await git.status();
    if (status.files.length === 0) {
      console.log("⚠️ no changes");
      return;
    }

    await git.addConfig("user.name", "github-actions");
    await git.addConfig("user.email", "actions@github.com");

    await git.commit(`update ${count} movies`);

    // 🔥 เพิ่มตรงนี้
    await git.pull("origin", "main", { "--rebase": "true" });

    await git.push("origin", "HEAD:main");

    console.log("🚀 pushed:", count);
  } catch (e) {
    console.log("⚠️ git error:", e.message);
  }
}

// ================= MAIN =================
(async () => {
  const resume = loadResume();
  let total = 0;

  for (const cat of CATEGORIES) {
  console.log(`\n===== 📁 ${cat} =====`);

  let categoryList = [];
  let lastFirstMovie = "";

  for (let page = 1; page <= MAX_PAGES; page++) {
    const movies = await getMovies(cat, page);
   console.log(`📄 page ${page} → ${movies.length} เรื่อง`);
    // ❗ ไม่มีหนัง
    if (!movies.length) {
      console.log(`🛑 หน้า ${page} ว่าง → จบหมวด`);
      break;
    }

    // ❗ หน้าเริ่มซ้ำ
    if (movies[0].movieUrl === lastFirstMovie) {
      console.log(`🛑 หน้า ${page} ซ้ำ → จบหมวด`);
      break;
    }

    lastFirstMovie = movies[0].movieUrl;

    const list = TEST_MODE ? movies.slice(0, 3) : movies;

    for (const m of list) {
      if (resume.done.includes(m.movieUrl)) continue;

      console.log(`🎬 ${m.title}`);

        const servers = await getMoviePage(m.movieUrl);
        if (!servers.length) continue;
        await new Promise(r => setTimeout(r, 300));
        
	const item = {
          title: m.title,
          group: cat.replace("/movies/", ""),
          logo: m.image,
          servers
        };

        categoryList.push(item);
        resume.done.push(m.movieUrl);
        total++;

              if (total % SAVE_EVERY === 0) {
          saveResume(resume);
          saveCategory(item.group, categoryList);
          console.log("💾 auto save...");
        }

        // 🔥 commit ทุก 50
        if (!TEST_MODE && total % COMMIT_EVERY === 0) {
  await gitCommit(total);
}
      }
    }

    // 💾 save ตอนจบหมวด
    saveResume(resume);
    saveCategory(cat.replace("/movies/", ""), categoryList);
  }

  // 🚀 commit รอบสุดท้าย
  if (!TEST_MODE) {
  await gitCommit(total);
}

  console.log("✅ DONE:", total);
})();
