/**
 * Overwrite a file's entire content in a TeXPage project (CRDT channel).
 *
 * Usage:
 *   opencli texpage write "My Paper" main.tex --file ./main.tex
 *   opencli texpage write "My Paper" main.tex --content "\\documentclass{article}..."
 *
 * Note: full-content replace. The file must already exist (create it in the
 * TeXPage UI first, or upload a project zip).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { readFileSync } from 'node:fs';
import { SITE, DOMAIN, resolveProject, resolveFile, replaceDocContent, texFetch } from './utils.js';

cli({
  site: SITE,
  name: 'write',
  access: 'write',
  description: '覆盖写入 TeXPage 项目中文件的全部内容',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'project', positional: true, required: true, help: 'Project key or exact name' },
    { name: 'path', positional: true, required: true, help: 'File path in project, e.g. main.tex' },
    { name: 'file', help: 'Read content from this local file' },
    { name: 'content', help: 'Inline content (ignored if --file given)' },
  ],
  columns: ['path', 'size', 'chunks', 'verified'],
  validateArgs: (kwargs) => {
    if (!kwargs.file && kwargs.content === undefined) {
      throw new Error('Provide --file <local path> or --content <text>');
    }
  },
  func: async (page: IPage, kwargs) => {
    const text = kwargs.file ? readFileSync(String(kwargs.file), 'utf8') : String(kwargs.content);
    const ref = await resolveProject(page, String(kwargs.project));
    const fileKey = await resolveFile(page, ref, String(kwargs.path));
    const { chunks } = await replaceDocContent(page, ref, fileKey, text);

    // Verify: re-read via HTTP and compare
    const content = await texFetch(
      page,
      `const r = await fetch('/api/project/file?fileKey=${fileKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}', { credentials: 'include' });
       return await r.text();`,
    );
    return [{
      path: String(kwargs.path),
      size: text.length,
      chunks,
      verified: content === text,
    }];
  },
});
