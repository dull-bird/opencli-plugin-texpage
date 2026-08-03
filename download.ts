/**
 * Download a TeXPage project's compiled PDF or full source zip.
 *
 * Usage:
 *   opencli texpage download "My Paper"                  # PDF of last compile
 *   opencli texpage download "My Paper" --type source    # source zip
 *   opencli texpage download "My Paper" --output ./paper.pdf
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { writeFileSync } from 'node:fs';
import { SITE, DOMAIN, resolveProject, texGet, cookieHeader } from './utils.js';

cli({
  site: SITE,
  name: 'download',
  access: 'read',
  description: '下载 TeXPage 项目的编译 PDF 或源码 zip',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'project', positional: true, required: true, help: 'Project key or exact name' },
    { name: 'type', default: 'pdf', choices: ['pdf', 'source'], help: 'What to download' },
    { name: 'output', help: 'Output file path (default: ./<projectName>.pdf|.zip)' },
  ],
  columns: ['project', 'type', 'file', 'size'],
  func: async (page: IPage, kwargs) => {
    const ref = await resolveProject(page, String(kwargs.project));
    const type = String(kwargs.type);

    let url: string;
    let ext: string;
    let needsCookie = false;
    if (type === 'source') {
      url = `https://${DOMAIN}/api/project/download?projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`;
      ext = 'zip';
      needsCookie = true;
    } else {
      const result = await texGet(
        page,
        `/api/project/compileResult/pdf?projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`,
      );
      if (!result?.pdfUrl) throw new Error('No compiled PDF found — run `opencli texpage compile` first');
      url = result.pdfUrl;
      ext = 'pdf';
    }

    const headers: Record<string, string> = {};
    if (needsCookie) headers.Cookie = await cookieHeader(page);
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());

    const file = String(kwargs.output || `./${ref.projectName}.${ext}`);
    writeFileSync(file, buf);
    return [{ project: ref.projectName, type, file, size: buf.length }];
  },
});
