/**
 * Shared helpers for the TeXPage plugin.
 *
 * TeXPage has two channels (both cookie-authenticated):
 * - HTTP JSON API on https://www.texpage.com/api/...
 * - socket.io (EIO=4) on wss://socket.texpage.com/socket.io/ for compile
 *   and other realtime actions: emit "request" {requestId, action, data},
 *   responses arrive as "response" events matched by requestId; compile
 *   results are pushed as unsolicited "response" events with pdfUrl/logUrl.
 */

import type { IPage } from '@jackwener/opencli/types';

export const SITE = 'texpage';
export const DOMAIN = 'www.texpage.com';

export interface ProjectRef {
  ownerKey: string;
  projectKey: string;
  versionNo: string;
  projectName: string;
}

/** Run a fetch inside the logged-in browser page (carries cookies). */
export async function texFetch(page: IPage, js: string): Promise<any> {
  return page.evaluate(`(async () => { ${js} })()`);
}

/** GET a JSON API endpoint inside the page context. */
export async function texGet(page: IPage, path: string): Promise<any> {
  const d = await texFetch(
    page,
    `const r = await fetch(${JSON.stringify(path)}, { credentials: 'include' });
     return await r.json();`,
  );
  const code = d?.status?.code;
  if (code !== 1) {
    throw new Error(`TeXPage API ${path} failed: ${d?.status?.message || JSON.stringify(d).slice(0, 200)}`);
  }
  return d.result;
}

/**
 * Resolve a project by key or (exact) name against the user's project list.
 * Returns ownerKey/projectKey/versionNo (selected version) for API calls.
 */
export async function resolveProject(page: IPage, input: string): Promise<ProjectRef> {
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const result = await texGet(
      page,
      `/api/project?page=${pageNo}&projectName=&sortBy=updateAt&getType=all`,
    );
    const list: any[] = result?.list || [];
    const hit = list.find((p) => p.projectKey === input || p.projectName === input);
    if (hit) {
      const versionNo = hit.selectedVersion?.versionNo || hit.versionNos?.[0]?.versionNo;
      if (!versionNo) throw new Error(`Project "${input}" has no version info`);
      return {
        ownerKey: hit.ownerKey,
        projectKey: hit.projectKey,
        versionNo,
        projectName: hit.projectName,
      };
    }
    if (list.length === 0) break;
  }
  throw new Error(`Project not found: "${input}" (pass a projectKey or exact project name from \`opencli texpage list\`)`);
}

/** Read cookies from the page for out-of-browser (Node-side) requests. */
export async function cookieHeader(page: IPage): Promise<string> {
  const cookies = await page.getCookies({ domain: '.texpage.com' });
  return cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Compile via the socket.io channel by sending the worker compile request
 * directly (get:/api/project/compile) — no app page needed.
 *
 * The server replies with a "response" event matching our requestId:
 * - status.code 1:    result = {pdfUrl, pdfSize, logUrl, ...}
 * - status.code 2001: result = {errorType, message, ...} (hard failure:
 *                     timeout, stopCompile, replacedByNewRequest, ...)
 * Note: LaTeX errors still produce code 1 + a PDF (nonstopmode); detect
 * them by parsing the log.
 */
export interface CompileOutcome {
  ok: boolean;
  errorType?: string;
  message?: string;
  pdfUrl?: string;
  pdfSize?: number;
  logUrl?: string;
  raw: any;
}

export async function compileViaSocket(
  page: IPage,
  ref: ProjectRef,
  main: { fileKey: string; filePath: string },
  timeoutMs = 90000,
): Promise<CompileOutcome> {
  const result = await page.evaluate(
    `(async () => {
      const P = ${JSON.stringify({ ...ref, main })};
      return await new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://socket.texpage.com/socket.io/?EIO=4&transport=websocket');
        let phase = 0;
        const reqId = 'compile-' + Math.random().toString(36).slice(2);
        const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('compile timeout')); }, ${timeoutMs});
        const send = (action, data, id) => ws.send('42' + JSON.stringify(['request', {
          request: { requestId: id || Math.random().toString(36).slice(2), action }, data,
        }]));
        ws.onopen = () => ws.send('40');
        ws.onmessage = (ev) => {
          const d = String(ev.data);
          if (d === '2') { ws.send('3'); return; }
          if (d.startsWith('40') && phase === 0) {
            phase = 1;
            send('post:/api/project/joinRoom', { projectKey: P.projectKey, versionNo: P.versionNo }, 'join');
            return;
          }
          if (!d.startsWith('42')) return;
          let msg;
          try { msg = JSON.parse(d.slice(2)); } catch (e) { return; }
          const payload = msg[1] || {};
          if (phase === 1 && payload.requestId === 'join') {
            phase = 2;
            if (payload.status && payload.status.code !== 1) {
              clearTimeout(timer); try { ws.close(); } catch (e) {}
              reject(new Error('joinRoom failed: ' + (payload.status.message || 'unknown')));
              return;
            }
            send('get:/api/project/compile', {
              ownerKey: P.ownerKey, projectKey: P.projectKey, versionNo: P.versionNo,
              filePath: P.main.filePath, fileKey: P.main.fileKey,
              line: 1, column: 1, mainFile: P.main.filePath,
            }, reqId);
            return;
          }
          if (phase === 2 && payload.requestId === reqId) {
            clearTimeout(timer); try { ws.close(); } catch (e) {}
            const code = payload.status && payload.status.code;
            const r = payload.result || {};
            if (code === 1) {
              resolve({ ok: true, pdfUrl: r.pdfUrl, pdfSize: r.pdfSize, logUrl: r.logUrl, raw: r });
            } else {
              resolve({ ok: false, errorType: r.errorType || 'code_' + code,
                message: (payload.status && payload.status.message) || r.message, raw: r });
            }
          }
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('socket error')); };
      });
    })()`,
  );
  return result as CompileOutcome;
}

/** Look up a file's fileKey by path within a project. */
export async function resolveFile(page: IPage, ref: ProjectRef, path: string): Promise<string> {
  const tree = await texGet(
    page,
    `/api/project/fileTree?ownerKey=${ref.ownerKey}&projectKey=${ref.projectKey}&versionNo=${ref.versionNo}`,
  );
  const file = (tree?.treeData || []).find((f: any) => f.filePath === path && !f.isDir);
  if (!file) throw new Error(`File not found: ${path} (see \`opencli texpage files "${ref.projectName}"\`)`);
  return file.fileKey;
}

/**
 * Replace a document's entire content via the CRDT channel.
 *
 * Protocol (reverse-engineered from the app bundle and wire captures):
 * - joinDoc(fileKey, ..., v:'chunk') returns the full op history; each op is
 *   a "splice" {spliceId:{site,seq}, insertion?, deletion?}.
 * - A whole-doc replace is ONE splice carrying both:
 *     deletion: covers root sentinel {0,0}..end sentinel {0,1} with
 *               maxSeqsBySite = max seq per site over existing ops
 *     insertion: first ≤200-char chunk anchored at the root sentinel
 * - Extra chunks follow as insertion-only splices, each left-anchored to the
 *   previous chunk with offsetInLeftDependency = that chunk's {row,column} extent.
 * - Ops go out as emit("operations", {syncType:'sync', operations:[{fileKey, versionNo, operation}]}).
 * - Server acks with a "mergedOperations" event listing accepted splice ids.
 */
export async function replaceDocContent(
  page: IPage,
  ref: ProjectRef,
  fileKey: string,
  text: string,
  timeoutMs = 30000,
): Promise<{ chunks: number; acked: string[] }> {
  return page.evaluate(
    `(async () => {
      const P = ${JSON.stringify({ ...ref, fileKey, text })};
      const CHUNK = 200;
      const extent = (s) => {
        const parts = s.split('\\n');
        return { row: parts.length - 1, column: parts[parts.length - 1].length };
      };
      return await new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://socket.texpage.com/socket.io/?EIO=4&transport=websocket');
        let phase = 0;
        const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('write timeout')); }, ${timeoutMs});
        const send = (arr) => ws.send('42' + JSON.stringify(arr));
        const expected = [];
        let acked = [];
        ws.onopen = () => ws.send('40');
        ws.onmessage = (ev) => {
          const d = String(ev.data);
          if (d === '2') { ws.send('3'); return; }
          if (d.startsWith('40') && phase === 0) {
            phase = 1;
            send(['request', { request: { requestId: 'j1', action: 'post:/api/project/joinRoom' },
              data: { projectKey: P.projectKey, versionNo: P.versionNo } }]);
            return;
          }
          if (phase === 1 && d.includes('"j1"')) {
            phase = 2;
            send(['joinDoc', { fileKey: P.fileKey, ownerKey: P.ownerKey,
              projectKey: P.projectKey, versionNo: P.versionNo, v: 'chunk' }]);
            return;
          }
          if (phase === 2 && d.includes('joinedDoc')) {
            phase = 3;
            const ops = JSON.parse(d.slice(2))[1].data.operations || [];
            const maxSeqs = {};
            for (const o of ops) {
              if (o.spliceId) maxSeqs[o.spliceId.site] = Math.max(maxSeqs[o.spliceId.site] || 0, o.spliceId.seq);
            }
            const base = (maxSeqs[P.ownerKey] || 0) + 1;
            const chunks = [];
            for (let i = 0; i < P.text.length; i += CHUNK) chunks.push(P.text.slice(i, i + CHUNK));
            const outOps = [];
            chunks.forEach((chunk, i) => {
              const spliceId = { site: P.ownerKey, seq: base + i };
              const op = { type: 'splice', spliceId };
              if (i === 0) {
                op.deletion = {
                  spliceId,
                  leftDependencyId: { site: 0, seq: 0 },
                  offsetInLeftDependency: { row: 0, column: 0 },
                  rightDependencyId: { site: 0, seq: 1 },
                  offsetInRightDependency: { row: 0, column: 0 },
                  maxSeqsBySite: maxSeqs,
                };
                op.insertion = {
                  text: chunk,
                  leftDependencyId: { site: 0, seq: 0 },
                  offsetInLeftDependency: { row: 0, column: 0 },
                  rightDependencyId: { site: 0, seq: 1 },
                  offsetInRightDependency: { row: 0, column: 0 },
                };
              } else {
                op.insertion = {
                  text: chunk,
                  leftDependencyId: { site: P.ownerKey, seq: base + i - 1 },
                  offsetInLeftDependency: extent(chunks[i - 1]),
                  rightDependencyId: { site: 0, seq: 1 },
                  offsetInRightDependency: { row: 0, column: 0 },
                };
              }
              expected.push(P.fileKey + '.' + spliceId.seq + '.splice');
              outOps.push({ fileKey: P.fileKey, versionNo: P.versionNo, operation: op });
            });
            if (outOps.length === 0) {
              // Empty replacement content: single deletion-only splice
              const spliceId = { site: P.ownerKey, seq: base };
              expected.push(P.fileKey + '.' + spliceId.seq + '.splice');
              outOps.push({ fileKey: P.fileKey, versionNo: P.versionNo, operation: {
                type: 'splice', spliceId,
                deletion: { spliceId, leftDependencyId: { site: 0, seq: 0 },
                  offsetInLeftDependency: { row: 0, column: 0 },
                  rightDependencyId: { site: 0, seq: 1 },
                  offsetInRightDependency: { row: 0, column: 0 }, maxSeqsBySite: maxSeqs },
              }});
            }
            send(['operations', { syncType: 'sync', operations: outOps }]);
            return;
          }
          if (phase === 3 && d.startsWith('42') && d.includes('mergedOperations')) {
            try {
              const ids = JSON.parse(d.slice(2))[1] || [];
              acked = acked.concat(ids);
              if (expected.every((x) => acked.includes(x))) {
                clearTimeout(timer); try { ws.close(); } catch (e) {}
                resolve({ chunks: expected.length, acked });
              }
            } catch (e) {}
          }
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('socket error')); };
      });
    })()`,
  );
}

/** Extract error/warning lines from a LaTeX compile log. */
export function parseLog(log: string): { errors: string[]; warnings: string[] } {
  const lines = log.split('\n');
  const errors: string[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Classic "!" errors, or file:line:error style (which TeXPage enables)
    if (l.startsWith('!')) {
      errors.push([l, lines[i + 1] || '', lines[i + 2] || ''].join(' ').trim().slice(0, 300));
    } else if (/^(?:\.?\/|\w)[^\s()]*\.\w+:\d+: /.test(l)) {
      errors.push(l.trim().slice(0, 300));
    } else if (/LaTeX Warning|Package \w+ Warning/.test(l)) {
      warnings.push(l.trim().slice(0, 200));
    }
  }
  return { errors, warnings };
}
