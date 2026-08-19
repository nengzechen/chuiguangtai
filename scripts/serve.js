/**
 * 开发用静态服务器。和 python3 -m http.server 的区别只有一条：
 * 全部响应 no-store —— 改完 app.js 刷新就能看到，不用跟浏览器缓存斗。
 *
 *   node scripts/serve.js [port]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "web");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);

    /*
     * Chrome 135 起，DevTools 一打开就会探这个文件（自动工作区）。
     * 不给它就是每加载一次页面报一次 404 —— 而这条 404 只在开着控制台时出现，
     * 于是"我这边看不到、你那边一直有"。给它一个真实的响应：
     * 报错没了，顺带 DevTools 里可以直接改本地文件。
     */
    /*
     * 允许跨源读取。
     * 合约里的 baseURI 是部署时写死的绝对地址（127.0.0.1:8080），
     * 而这台服务器换个端口就成了另一个源 —— 不给这个头，
     * 所有 tokenURI 的 fetch 都会被浏览器挡掉，页面上全是空图。
     */
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (url === "/.well-known/appspecific/com.chrome.devtools.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        workspace: { root: ROOT, // DevTools 用它认这个工作区，必须是稳定的 UUID，不能每次启动都换
        uuid: "a7f3c1e0-6b2d-4c88-9e51-0b3d9c6a41f2" },
      }));
    }

    let file = path.join(ROOT, url === "/" ? "/index.html" : url);

    // 别让 ../ 跑出 web/
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    fs.readFile(file, (err, buf) => {
      if (err) {
        /*
         * 404 一定要打出来，而且要带 referer。
         * 浏览器控制台里的「Failed to load resource: 404」不告诉你少了哪个文件，
         * 更不告诉你是哪一页在要它 —— 于是一个陈旧的 <link preload> 可以
         * 在每次进页面时报一次，而你翻遍源码都找不到。
         * 服务器自己知道答案，让它说出来。
         */
        console.warn(
          `404  ${url}` + (req.headers.referer ? `   ← 来自 ${req.headers.referer}` : "")
        );
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found: " + url);
        return;
      }
      // 元数据文件没有扩展名（tokenURI = base + tokenId），按 JSON 发
      const ext = path.extname(file);
      res.writeHead(200, {
        "Content-Type": TYPES[ext] || (ext ? "application/octet-stream" : TYPES[".json"]),
        "Cache-Control": "no-store, must-revalidate",
      });
      res.end(buf);
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`垂光台 → http://127.0.0.1:${PORT}`);
    console.log(`(no-store：改完文件直接刷新即可)`);
  });
