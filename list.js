import { cli, Strategy } from "@jackwener/opencli/registry";
import { SITE, DOMAIN, texGet } from "./utils.js";
cli({
  site: SITE,
  name: "list",
  access: "read",
  description: "\u5217\u51FA TeXPage \u9879\u76EE",
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: "get-type", default: "all", help: "Project set: all | shared | archived | trashed" },
    { name: "limit", type: "int", default: 50, help: "Max projects to return" }
  ],
  columns: ["name", "projectKey", "version", "owner", "privilege", "updated"],
  func: async (page, kwargs) => {
    const rows = [];
    const limit = Math.min(Number(kwargs.limit) || 50, 200);
    for (let pageNo = 1; pageNo <= 20 && rows.length < limit; pageNo++) {
      const result = await texGet(
        page,
        `/api/project?page=${pageNo}&projectName=&sortBy=updateAt&getType=${kwargs["get-type"]}`
      );
      const list = result?.list || [];
      for (const p of list) {
        rows.push({
          name: p.projectName,
          projectKey: p.projectKey,
          version: p.selectedVersion?.versionName || "main",
          owner: p.ownerName,
          privilege: p.privilege,
          updated: p.updateAt
        });
      }
      if (list.length === 0) break;
    }
    return rows.slice(0, limit);
  }
});
