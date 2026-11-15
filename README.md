# CocoaConvert

Convert images, documents, spreadsheets, audio, video, archives and data between formats. Drop files, pick a format, download the result.

Most conversions run in the browser, so files stay on the device. An optional server adds office documents (LibreOffice), e-books (Pandoc), 7Z/BZ2/XZ archives and native FFmpeg. It is only used for a file after the user turns on **Allow server conversion**, and it keeps nothing.

- 428 conversions on the device, 132 more with the server. Full list: [docs/SUPPORTED_FORMATS.md](docs/SUPPORTED_FORMATS.md), generated from the registry.
- Batches of any size, with per-file and overall progress, retry, cancel, and **Download all as ZIP**.
- Drag and drop anywhere, file picker (including phones), and paste from the clipboard.
- Dark and light themes, desktop and phone layouts, following the CocoaSuite Design Bible.

## Quick start

```bash
npm install
npm run build        # type-check, web app into dist/, server into dist-server/
npm start            # serves the app and the API on http://localhost:8080
```

During development, run `npm run dev:server` (API on port 8080) and `npm run dev` (Vite on port 5173, with `/api` proxied).

The web app also works on its own from any static host (`dist/`). Without the server it offers only on-device conversions and says so.

With Docker (installs every server tool):

```bash
docker build -t cocoaconvert .
docker run -p 8080:8080 cocoaconvert
```

## Server tools

The server detects tools at start-up and offers only what it finds. Each tool switches on a set of conversions:

| Tool | Package (Debian/Ubuntu) | Adds |
| --- | --- | --- |
| LibreOffice | `libreoffice-writer`, `-calc`, `-impress`, `-draw` | DOC, DOCX, ODT, RTF, PPT, PPTX, ODP, XLS, XLSX, ODS to PDF and between each other; HTML/TXT to PDF/DOCX/ODT; PDF to DOCX/ODT |
| Pandoc 3 | `pandoc` | EPUB in and out; Markdown, HTML, DOCX, ODT, RTF between each other |
| FFmpeg | `ffmpeg` (with libx264, libvpx, libmp3lame, libopus, libvorbis) | Every audio and video conversion, for files over 1 GB or faster than the browser |
| tar, xz, bzip2 | `tar`, `xz-utils`, `bzip2` | TAR.XZ, TAR.BZ2, XZ, BZ2 |
| 7-Zip | bundled via the `7zip-bin` package | 7Z in and out |

Fonts matter for office-to-PDF output: install `fonts-liberation` and `fonts-crosextra-carlito`/`caladea` for metric-compatible Microsoft fonts.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Where to listen |
| `STATIC_DIR` | `./dist` | Built web app to serve; leave the folder out to run the API only |
| `WORK_DIR` | system temp `/cocoaconvert-jobs` | Root for per-job folders |
| `MAX_UPLOAD_MB` | `500` | Largest upload |
| `CONCURRENCY`, `QUEUE_LIMIT` | `2`, `16` | Jobs at once, and how many may wait |
| `RATE_LIMIT` | `60` | Conversions per minute per address |
| `OFFICE_TIMEOUT_S`, `MEDIA_TIMEOUT_S`, `ARCHIVE_TIMEOUT_S` | `120`, `1800`, `300` | Hard time limits per job |
| `DISABLE_CONVERTERS` | — | Comma-separated: `libreoffice,pandoc,ffmpeg,archive-native` |
| `TRUST_PROXY` | — | `1` behind a reverse proxy, so rate limits see real addresses |

## How it works

```
src/engine/       Formats, content sniffing, the conversion registry and route finding (shared with the server)
src/converters/   On-device converters: image codecs, data, spreadsheets, documents, PDF, archives, FFmpeg.wasm
src/runtime/      Worker pool, route executor, server client
src/ui/           Preact interface and the batch controller
server/           Fastify server, tool detection, isolated process runner, server converters
tests/            Unit, integration (real tools) and browser tests, plus sample files for every format
```

**Registry and routes.** Every converter declares its edges (from → to), cost, size limit, where it runs and known quality limits (`src/engine/registry.ts`). The UI lists only targets the route finder can reach with the converters actually available, so it never offers a conversion it cannot perform. Routes may chain up to three steps (Markdown → HTML → PDF; HEIC → PNG → PDF), keep intermediate results in memory, and prefer on-device steps. Lossy or cross-category edges (PDF → DOCX, video → audio) are only ever used on their own.

**Detection.** Files are identified by their content (magic numbers, ZIP part names, OLE stream names, MP4 brands), not their extension. A mismatch is shown on the file row.

**On the device.** Image, data, spreadsheet, archive and Word-reading work runs in a pool of Web Workers. Heavy libraries load only when a file needs them: the first page load is about 26 KB of gzipped JavaScript. FFmpeg.wasm (31 MB) loads on the first audio or video file, runs one job at a time, and is recycled every 16 jobs or after any crash, so long batches stay reliable.

**Progress.** Percentages appear only where the work reports them: FFmpeg (from its timeline), PDF pages, server uploads and downloads. Other steps show their state without a number.

## Privacy and security

- On-device conversions never send data anywhere. The status bar says where work happens.
- Server conversions need explicit permission each session. Uploads stream into a private per-job folder under a fixed name, run, stream back, and the folder is deleted when the response ends. Leftover folders are swept every five minutes and at start-up. Nothing is logged about file contents; the file-name header is redacted from logs.
- The server checks the uploaded content matches the claimed format, enforces size limits while streaming, rate-limits, queues, and kills tools that pass their time limit (whole process group).
- Tools run with an argument list (never a shell), a private `HOME`/`TMPDIR`, a minimal environment, and, where Linux allows it, inside an empty network namespace (`unshare -rn`), so a document cannot fetch remote content.
- Pandoc reads documents with `--sandbox`; images that point outside the job folder (such as `![](/etc/passwd)`) are removed before writing.
- Archives: entry counts, expanded size and compression ratio are capped (ZIP bombs, XZ/BZ2 bombs); `..` and absolute paths are dropped; links and devices are never extracted.
- XML entities are not expanded; YAML loads with the JSON-compatible schema only.
- SVG is drawn inside an `<img>`, where scripts never run and nothing external loads. HTML is parsed into inert documents.
- The server sends a strict Content Security Policy and other hardening headers.

## Tests

```bash
npm test             # unit and integration: 457 tests, including every server conversion with the real tools
npm run test:e2e     # builds, then drives Chrome: every on-device conversion plus the full interface
npm run fixtures     # rebuilds tests/fixtures (needs ffmpeg, ImageMagick, LibreOffice, Pandoc, pillow-heif)
```

The integration and browser suites run every single-step edge in the registry on a real sample file and check the result: the format is sniffed again, media is probed with `ffprobe`, images are opened with ImageMagick, PDFs with `pdfinfo`, documents are read back with Pandoc, and archives are listed. The browser tests need Chrome (`CHROME_PATH` to override); the server tests need the tools in the table above.

## Known limitations

- **PDF → DOCX/ODT** rebuilds pages from positioned boxes (LibreOffice). Simple documents come out well; complex layouts need tidying. Scanned PDFs have no text to extract (no OCR).
- **Office formats need the server.** In the browser, DOCX can become HTML, Markdown or text, and spreadsheets convert between XLSX, XLS, ODS, CSV, JSON and HTML (values and formulas carry over; fonts, colours and charts do not). Everything with layout goes through LibreOffice.
- **Animated GIF to still images** keeps the first frame. Animation is kept when converting GIF to video.
- **WebM in the browser** uses VP8, because the VP9 encoder in the single-threaded FFmpeg.wasm build crashes. The server makes VP9.
- **Browser media files** are limited to 1 GB (the WebAssembly engine holds the file in memory). Larger files use the server when it is available.
- **TIFF** reading uses UTIF and is tested with 8-bit RGB with transparency. Some unusual layouts (for example 2-bit RGB) are not readable and are reported as such.
- **HEIC** can be read, not written. **RAW camera formats** (DNG, CR2, NEF…) are not supported yet.
- **SVG** rendering skips linked images and web fonts.
- Mobile browsers have less memory; very large images or videos may fail there with a message to try a smaller file.

## Design notes

The interface follows the CocoaSuite Design Bible v1.0: tokens in `src/styles/tokens.css`, Inter bundled, the shared 24-px icon grid, sentence case and British spelling. Two decisions were needed where the Bible is silent; they should be added to it:

- **Tile colour** for CocoaConvert: `#2F7A6B` with a Cream glyph (4.5:1), used only for the favicon.
- **Light-theme state colours**: the Bible lists ok/warn/bad for dark only. Light uses `#3A7550`, `#7F6119` and `#B23A24` to keep 4.5:1 text contrast.

## Third-party licences

Read before redistributing. FFmpeg.wasm's core (`@ffmpeg/core`) includes GPL components (x264), which affects distribution of the built app. libheif-js is LGPL. SheetJS and pdf.js are Apache-2.0; pdf-lib, fflate, marked, turndown, js-yaml, fast-xml-parser, gifenc, utif2, Preact and Fastify are MIT; mammoth is BSD-2-Clause; the jSquash codecs are Apache-2.0. Inter and JetBrains Mono are under the SIL Open Font License. Server tools (LibreOffice MPL-2.0, Pandoc GPL, FFmpeg LGPL/GPL, 7-Zip LGPL) run as separate programs.
