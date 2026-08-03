/**
 * Compile a TeXPage project and report the result.
 *
 * Sends the compile request directly over the socket.io channel
 * (get:/api/project/compile) — no TeXPage editor page needs to be open.
 * LaTeX errors still yield a PDF (nonstopmode); this command parses the log
 * and reports error/warning counts and excerpts.
 *
 * Usage:
 *   opencli texpage compile "My Paper"
 *   opencli texpage compile "My Paper" --main-file thesis.tex
 *   opencli texpage compile "My Paper" --log ./build.log --pdf ./paper.pdf
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { writeFileSync } from 'node:fs';
import { SITE, DOMAIN, resolveProject, compileViaSocket, parseLog, texGet } from './utils.js';

cli({
  site: SITE,
  name: 'compile',
  access: 'write',
  description: '编译 TeXPage 项目并返回错误/警告摘要',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'project', positional: true, required: true, help: 'Project key or exact name' },
    { name: 'main-file', help: 'Main .tex file (default: main.tex, else first .tex in tree)' },
    { name: 'log', help: 'Save full compile log to this file' },
    { name: 'pdf', help: 'Save compiled PDF to this file' },
    { name: 'timeout', type: 'int', default: 90, help: 'Compile timeout in seconds' },
  ],
  columns: ['project', 'status', 'errors', 'warnings', 'pdfSize'],
  func: async (page: IPage, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));

    // Resolve main file
    const tree = await texGet(
      page,
      `/api/project/fileTree?ownerKey=${ref.ownerKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`,
    );
    const files: any[] = (tree?.treeData || []).filter((f: any) => !f.isDir);
    let main = kwargs['main-file']
      ? files.find((f) => f.filePath === String(kwargs['main-file']))
      : files.find((f) => f.filePath === 'main.tex') || files.find((f) => f.filePath.endsWith('.tex'));
    if (!main) throw new Error('No .tex file found in project');
    if (kwargs['main-file'] && !main) throw new Error(`Main file not found: ${kwargs['main-file']}`);

    const outcome = await compileViaSocket(
      page,
      ref,
      { fileKey: main.fileKey, filePath: main.filePath },
      Number(kwargs.timeout) * 1000,
    );

    let logText = '';
    if (outcome.logUrl) {
      const r = await fetch(outcome.logUrl);
      if (r.ok) logText = await r.text();
    }
    const { errors, warnings } = parseLog(logText);

    let status: string;
    if (!outcome.ok) status = `failed:${outcome.errorType}`;
    else status = errors.length ? 'success-with-errors' : 'success';

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
      errorDetail: errors.slice(0, 5).join(' | ') || outcome.message || '',
    }];
  },
  footerExtra: (kwargs) => {
    const parts: string[] = [];
    if (kwargs.log) parts.push(`log saved to ${kwargs.log}`);
    if (kwargs.pdf) parts.push(`pdf saved to ${kwargs.pdf}`);
    return parts.length ? parts.join(', ') : undefined;
  },
});
