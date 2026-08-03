import { cli, Strategy } from "@jackwener/opencli/registry";
import { writeFileSync } from "node:fs";
import { SITE, DOMAIN, resolveProject, compileViaSocket, parseLog, texGet } from "./utils.js";
cli({
  site: SITE,
  name: "compile",
  access: "write",
  description: "\u7F16\u8BD1 TeXPage \u9879\u76EE\u5E76\u8FD4\u56DE\u9519\u8BEF/\u8B66\u544A\u6458\u8981",
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: "project", positional: true, required: true, help: "Project key or exact name" },
    { name: "main-file", help: "Main .tex file (default: main.tex, else first .tex in tree)" },
    { name: "log", help: "Save full compile log to this file" },
    { name: "pdf", help: "Save compiled PDF to this file" },
    { name: "timeout", type: "int", default: 90, help: "Compile timeout in seconds" }
  ],
  columns: ["project", "status", "errors", "warnings", "pdfSize"],
  func: async (page, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));
    const tree = await texGet(
      page,
      `/api/project/fileTree?ownerKey=${ref.ownerKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`
    );
    const files = (tree?.treeData || []).filter((f) => !f.isDir);
    let main = kwargs["main-file"] ? files.find((f) => f.filePath === String(kwargs["main-file"])) : files.find((f) => f.filePath === "main.tex") || files.find((f) => f.filePath.endsWith(".tex"));
    if (!main) throw new Error("No .tex file found in project");
    if (kwargs["main-file"] && !main) throw new Error(`Main file not found: ${kwargs["main-file"]}`);
    const outcome = await compileViaSocket(
      page,
      ref,
      { fileKey: main.fileKey, filePath: main.filePath },
      Number(kwargs.timeout) * 1e3
    );
    let logText = "";
    if (outcome.logUrl) {
      const r = await fetch(outcome.logUrl);
      if (r.ok) logText = await r.text();
    }
    const { errors, warnings } = parseLog(logText);
    let status;
    if (!outcome.ok) status = `failed:${outcome.errorType}`;
    else status = errors.length ? "success-with-errors" : "success";
    if (kwargs.log && logText) writeFileSync(String(kwargs.log), logText);
    if (kwargs.pdf && outcome.pdfUrl) {
      const r = await fetch(outcome.pdfUrl);
      if (!r.ok) throw new Error(`PDF download failed: HTTP ${r.status}`);
      writeFileSync(String(kwargs.pdf), Buffer.from(await r.arrayBuffer()));
    }
    return [{
      project: ref.projectName,
      status,
      errors: errors.length,
      warnings: warnings.length,
      pdfSize: outcome.pdfSize || 0,
      errorDetail: errors.slice(0, 5).join(" | ") || outcome.message || ""
    }];
  },
  footerExtra: (kwargs) => {
    const parts = [];
    if (kwargs.log) parts.push(`log saved to ${kwargs.log}`);
    if (kwargs.pdf) parts.push(`pdf saved to ${kwargs.pdf}`);
    return parts.length ? parts.join(", ") : void 0;
  }
});
