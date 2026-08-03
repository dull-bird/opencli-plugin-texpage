# opencli-plugin-texpage

TeXPage (https://www.texpage.com) online LaTeX editor adapter for [OpenCLI](https://github.com/jackwener/opencli):
list projects, browse file trees, read & write files, compile, download PDF / source zip.

Auth uses your logged-in Chrome session (Browser Bridge) — no API token needed.

## Install

```bash
# From GitHub
opencli plugin install github:dull-bird/opencli-plugin-texpage

# From local development directory
opencli plugin install file:///path/to/opencli-plugin-texpage
```

Requires esbuild available to the opencli host package for TS transpilation
(`opencli plugin update` warns if it is missing).

## Commands

| Command | Description |
|---------|-------------|
| `opencli texpage list` | 列出项目（名称 / projectKey / 版本 / 更新时间） |
| `opencli texpage files <project>` | 列出项目文件树 |
| `opencli texpage read <project> <path>` | 读取文件内容（`--save` 存到本地） |
| `opencli texpage write <project> <path>` | 覆盖写入文件全部内容（`--file` / `--content`） |
| `opencli texpage compile <project>` | 编译并解析日志，报告错误/警告（`--log` / `--pdf` / `--main-file`） |
| `opencli texpage download <project>` | 下载最近编译的 PDF；`--type source` 下载源码 zip |

`<project>` 接受 projectKey 或确切项目名。

### Examples

```bash
opencli texpage list
opencli texpage files "My Paper"
opencli texpage read "My Paper" main.tex --save ./main.tex
opencli texpage write "My Paper" main.tex --file ./main.tex     # verified after write
opencli texpage compile "My Paper" --log ./build.log --pdf ./out.pdf
opencli texpage download "My Paper" --type source --output ./src.zip
```

A typical agent loop — edit locally, push, compile, inspect errors — is fully headless;
no TeXPage editor tab needs to be open.

## Notes & limitations

- `write` is a **full-content replace** of an existing file (file creation and
  partial edits are not supported yet). Each write is verified by reading the
  file back over HTTP (`verified: true`).
- `write` uses a fresh random CRDT site id per call, so it never collides with
  an editor session (the app itself uses your userKey as site id — reusing it
  would corrupt a concurrently open editor's state). If the file is open in a
  TeXPage editor tab when you write, that tab live-merges the new content and
  may show a "当前文件已被更新 / The current file has been updated" notice;
  dismiss it (or reload the tab) before continuing to type there.
- `compile`: LaTeX errors still produce a PDF (nonstopmode); check `status`
  (`success` / `success-with-errors` / `failed:<errorType>`) and `errorDetail`.
- `read -f json` on large files: opencli's JSON serializer drops oversized
  fields — use the default output or `--save` for large content.
- Not covered: project creation/upload, sharing, version management, review
  comments.

## Plan limits (free vs paid)

From https://www.texpage.com/pricing — boundaries that affect this plugin:

| | Free | Standard ¥18 | Professional ¥36 | Ultimate ¥59 |
|---|---|---|---|---|
| Compile timeout | 30s | 5min | 5min | 10min |
| Collaborators / project | 1 | 2 | 10 | Unlimited |
| Project versions | 2 | 5 | 10 | Unlimited |
| Document History / Track Changes / Git / Zotero | ✗ | ✓ | ✓ | ✓ |
| Formula Editor / Symbol Selector / Table Generator | ✓ | ✓ | ✓ | ✓ |

Practical notes:
- On the **free tier a compile is killed server-side after 30s** and returns
  `failed:timeout` — the local `--timeout` flag cannot extend it; keep documents
  small or upgrade.
- The Document History *UI* is paywalled, but the underlying API still returns
  the last ~5 file records on free tier (that is how a wiped file can be
  restored via `/api/project/historyFile/restore`).

## How it works

TeXPage has no public API docs; this plugin drives its internal frontend APIs,
discovered via network recon:

- **HTTP JSON API** (`www.texpage.com/api/...`, cookie auth): project list,
  file tree, raw file content, compile result metadata, source zip download.
- **socket.io channel** (`wss://socket.texpage.com/socket.io/`, EIO=4, cookie auth):
  RPC bridge — `emit("request", {request: {requestId, action}, data})`, replies
  arrive as `"response"` events matched by requestId. Used for:
  - **compile**: `get:/api/project/compile` with mainFile info returns
    presigned `pdfUrl` / `logUrl` (failure: `status.code 2001` + `errorType`).
  - **write**: documents are a CRDT (Atom text-buffer style splice ops).
    A whole-doc replace is one splice carrying a `deletion` (root→end sentinel
    range + `maxSeqsBySite`) plus an `insertion`, with extra ≤200-char chunks
    chained as insertion-only splices; the server acks via `mergedOperations`.
