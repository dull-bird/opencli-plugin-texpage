/**
 * Read a file's content from a TeXPage project.
 *
 * Usage:
 *   opencli texpage read "My Paper" main.tex
 *   opencli texpage read "My Paper" main.tex --save ./main.tex
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { writeFileSync } from 'node:fs';
import { SITE, DOMAIN, texFetch, texGet, resolveProject } from './utils.js';

cli({
  site: SITE,
  name: 'read',
  access: 'read',
  description: '读取 TeXPage 项目中文件的内容',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'project', positional: true, required: true, help: 'Project key or exact name' },
    { name: 'path', positional: true, required: true, help: 'File path in project, e.g. main.tex' },
    { name: 'save', help: 'Also save content to a local file' },
  ],
  columns: ['path', 'size', 'content'],
  func: async (page: IPage, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));
    const tree = await texGet(
      page,
      `/api/project/fileTree?ownerKey=${ref.ownerKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`,
    );
    const file = (tree?.treeData || []).find((f: any) => f.filePath === String(kwargs.path) && !f.isDir);
    if (!file) throw new Error(`File not found: ${kwargs.path} (see \`opencli texpage files "${kwargs.project}"\`)`);
    const content = await texFetch(
      page,
      `const r = await fetch('/api/project/file?fileKey=${file.fileKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}', { credentials: 'include' });
       if (!r.ok) throw new Error('HTTP ' + r.status);
       return await r.text();`,
    );
    if (kwargs.save) writeFileSync(String(kwargs.save), content);
    return [{ path: file.filePath, size: content.length, content }];
  },
});
