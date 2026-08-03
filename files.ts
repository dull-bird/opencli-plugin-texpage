/**
 * List files in a TeXPage project.
 *
 * Usage:
 *   opencli texpage files "My Paper"
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { SITE, DOMAIN, texGet, resolveProject } from './utils.js';

cli({
  site: SITE,
  name: 'files',
  access: 'read',
  description: '列出 TeXPage 项目的文件树',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [{ name: 'project', positional: true, required: true, help: 'Project key or exact name' }],
  columns: ['path', 'type', 'fileKey', 'updated'],
  func: async (page: IPage, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));
    const result = await texGet(
      page,
      `/api/project/fileTree?ownerKey=${ref.ownerKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`,
    );
    const tree: any[] = result?.treeData || [];
    return tree
      .map((f) => ({
        path: f.filePath + (f.isDir ? '/' : ''),
        type: f.isDir ? 'dir' : f.fileType || 'file',
        fileKey: f.fileKey,
        updated: f.updateAt,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});
