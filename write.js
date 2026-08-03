import { cli, Strategy } from "@jackwener/opencli/registry";
import { readFileSync } from "node:fs";
import { SITE, DOMAIN, resolveProject, resolveFile, replaceDocContent, texFetch } from "./utils.js";
cli({
  site: SITE,
  name: "write",
  access: "write",
  description: "\u8986\u76D6\u5199\u5165 TeXPage \u9879\u76EE\u4E2D\u6587\u4EF6\u7684\u5168\u90E8\u5185\u5BB9",
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: "project", positional: true, required: true, help: "Project key or exact name" },
    { name: "path", positional: true, required: true, help: "File path in project, e.g. main.tex" },
    { name: "file", help: "Read content from this local file" },
    { name: "content", help: "Inline content (ignored if --file given)" }
  ],
  columns: ["path", "size", "chunks", "verified"],
  validateArgs: (kwargs) => {
    if (!kwargs.file && kwargs.content === void 0) {
      throw new Error("Provide --file <local path> or --content <text>");
    }
  },
  func: async (page, kwargs) => {
    const text = kwargs.file ? readFileSync(String(kwargs.file), "utf8") : String(kwargs.content);
    const ref = await resolveProject(page, String(kwargs.project));
    const fileKey = await resolveFile(page, ref, String(kwargs.path));
    const { chunks } = await replaceDocContent(page, ref, fileKey, text);
    const content = await texFetch(
      page,
      `const r = await fetch('/api/project/file?fileKey=${fileKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}', { credentials: 'include' });
       return await r.text();`
    );
    return [{
      path: String(kwargs.path),
      size: text.length,
      chunks,
      verified: content === text
    }];
  }
});
