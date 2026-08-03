import { cli, Strategy } from "@jackwener/opencli/registry";
import { writeFileSync } from "node:fs";
import { SITE, DOMAIN, texFetch, texGet, resolveProject } from "./utils.js";
cli({
  site: SITE,
  name: "read",
  access: "read",
  description: "\u8BFB\u53D6 TeXPage \u9879\u76EE\u4E2D\u6587\u4EF6\u7684\u5185\u5BB9",
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: "project", positional: true, required: true, help: "Project key or exact name" },
    { name: "path", positional: true, required: true, help: "File path in project, e.g. main.tex" },
    { name: "save", help: "Also save content to a local file" }
  ],
  columns: ["path", "size", "content"],
  func: async (page, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));
    const tree = await texGet(
      page,
      `/api/project/fileTree?ownerKey=${ref.ownerKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`
    );
    const file = (tree?.treeData || []).find((f) => f.filePath === String(kwargs.path) && !f.isDir);
    if (!file) throw new Error(`File not found: ${kwargs.path} (see \`opencli texpage files "${kwargs.project}"\`)`);
    const content = await texFetch(
      page,
      `const r = await fetch('/api/project/file?fileKey=${file.fileKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}', { credentials: 'include' });
       if (!r.ok) throw new Error('HTTP ' + r.status);
       return await r.text();`
    );
    if (kwargs.save) writeFileSync(String(kwargs.save), content);
    return [{ path: file.filePath, size: content.length, content }];
  }
});
