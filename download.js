import { cli, Strategy } from "@jackwener/opencli/registry";
import { writeFileSync } from "node:fs";
import { SITE, DOMAIN, resolveProject, texGet, cookieHeader } from "./utils.js";
cli({
  site: SITE,
  name: "download",
  access: "read",
  description: "\u4E0B\u8F7D TeXPage \u9879\u76EE\u7684\u7F16\u8BD1 PDF \u6216\u6E90\u7801 zip",
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: "project", positional: true, required: true, help: "Project key or exact name" },
    { name: "type", default: "pdf", choices: ["pdf", "source"], help: "What to download" },
    { name: "output", help: "Output file path (default: ./<projectName>.pdf|.zip)" }
  ],
  columns: ["project", "type", "file", "size"],
  func: async (page, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));
    const type = String(kwargs.type);
    let url;
    let ext;
    let needsCookie = false;
    if (type === "source") {
      url = `https://${DOMAIN}/api/project/download?projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`;
      ext = "zip";
      needsCookie = true;
    } else {
      const result = await texGet(
        page,
        `/api/project/compileResult/pdf?projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`
      );
      if (!result?.pdfUrl) throw new Error("No compiled PDF found \u2014 run `opencli texpage compile` first");
      url = result.pdfUrl;
      ext = "pdf";
    }
    const headers = {};
    if (needsCookie) headers.Cookie = await cookieHeader(page);
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const file = String(kwargs.output || `./${ref.projectName}.${ext}`);
    writeFileSync(file, buf);
    return [{ project: ref.projectName, type, file, size: buf.length }];
  }
});
