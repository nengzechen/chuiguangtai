/**
 * 把站点的绝对地址盖进所有页面。
 *
 *   SITE=https://xxx.pages.dev node scripts/site-url.js
 *
 * 为什么需要这一步：og:image / og:url 必须是绝对地址 —— 相对路径在
 * Twitter、Discord、微信里一律展不开。开发时它们指向 127.0.0.1，
 * 那个地址在任何别人的机器上都是死链，所以上线前必须换掉。
 *
 * 这个脚本是幂等的：不管现在写的是哪个域名，都会被换成 SITE。
 */
const fs = require("fs");
const path = require("path");

const SITE = (process.env.SITE || "").replace(/\/$/, "");
if (!SITE) {
  console.error("要先给 SITE。例：SITE=https://dome.pages.dev npm run site");
  process.exit(1);
}
if (!/^https?:\/\/[^/]+$/.test(SITE)) {
  console.error(`SITE 得是干净的站点根地址，不带路径：${SITE}`);
  process.exit(1);
}
if (SITE.startsWith("http://") && !SITE.includes("127.0.0.1") && !SITE.includes("localhost")) {
  console.error(`线上必须是 https —— 钱包在非安全上下文里不会注入：${SITE}`);
  process.exit(1);
}

const WEB = path.join(__dirname, "..", "web");
const OG_IMAGE = "/metadata/images/constellation/60.svg";

/** 页面 → 它自己的规范地址 */
const PAGES = {
  "index.html": "/",
  "observatory.html": "/observatory.html",
};

let touched = 0;
for (const [file, route] of Object.entries(PAGES)) {
  const p = path.join(WEB, file);
  let s = fs.readFileSync(p, "utf8");
  const before = s;

  // 已经有的绝对地址一律换掉，不管原来是哪个 host
  s = s.replace(
    /<meta property="og:image" content="https?:\/\/[^"]*" \/>/,
    `<meta property="og:image" content="${SITE}${OG_IMAGE}" />`
  );

  // og:url / twitter:image / canonical 原来没有，缺就补上
  const need = [
    [`og:url`, `<meta property="og:url" content="${SITE}${route}" />`],
    [`twitter:image`, `<meta name="twitter:image" content="${SITE}${OG_IMAGE}" />`],
  ];
  for (const [key, tag] of need) {
    if (s.includes(key)) {
      s = s.replace(
        new RegExp(`<meta (?:property|name)="${key}" content="[^"]*" \\/>`),
        tag
      );
    } else {
      s = s.replace(
        /<meta name="twitter:card"[^>]*\/>/,
        (m) => `${tag}\n${m}`
      );
    }
  }

  if (s.includes('rel="canonical"')) {
    s = s.replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${SITE}${route}" />`
    );
  } else {
    s = s.replace(
      /<link rel="icon" href="favicon.svg"[^>]*\/>/,
      (m) => `<link rel="canonical" href="${SITE}${route}" />\n${m}`
    );
  }

  if (s !== before) touched++;
  fs.writeFileSync(p, s);
  console.log(`  ${file} → ${SITE}${route}`);
}

// robots.txt / sitemap.xml：让 88 张分享页能被收录
const urls = ["/", "/observatory.html"].concat(
  Array.from({ length: 88 }, (_, i) => `/s/${i + 1}.html`)
);
fs.writeFileSync(
  path.join(WEB, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`
);
fs.writeFileSync(
  path.join(WEB, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`
);

console.log(`  sitemap.xml（${urls.length} 条）· robots.txt`);
console.log(`\n站点地址已盖成 ${SITE}`);
console.log("别忘了元数据也要用同一个地址重跑：");
console.log(`  SITE=${SITE} npm run metadata`);
