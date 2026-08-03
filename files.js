import { cli, Strategy } from "@jackwener/opencli/registry";
import { SITE, DOMAIN, texGet, resolveProject } from "./utils.js";
cli({
  site: SITE,
  name: "files",
  access: "read",
  description: "\u5217\u51FA TeXPage \u9879\u76EE\u7684\u6587\u4EF6\u6811",
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [{ name: "project", positional: true, required: true, help: "Project key or exact name" }],
  columns: ["path", "type", "fileKey", "updated"],
  func: async (page, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));
    const result = await texGet(
      page,
      `/api/project/fileTree?ownerKey=${ref.ownerKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`
    );
    const tree = result?.treeData || [];
    return tree.map((f) => ({
      path: f.filePath + (f.isDir ? "/" : ""),
      type: f.isDir ? "dir" : f.fileType || "file",
      fileKey: f.fileKey,
      updated: f.updateAt
    })).sort((a, b) => a.path.localeCompare(b.path));
  }
});
