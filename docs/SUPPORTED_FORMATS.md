# Supported conversions

Generated from the conversion registry (`src/engine/registry.ts`) by `npm run docs:formats`. Every single-step conversion in the registry is run by the test suite on real sample files and its output checked. Some targets are reached in two or three steps (for example Markdown → HTML → PDF); those chain tested steps and keep the result in memory between them.

- **On device**: runs in the browser. The file never leaves the computer.
- **Server**: needs the optional CocoaConvert server with the tools listed in the README, and the user’s permission for each session.

In total: 428 conversions on device and 132 more with the server.

## Images

| From | On device | Server |
| --- | --- | --- |
| JPG (.jpg, .jpeg, .jpe, .jfif) | PNG, WebP, AVIF, GIF, BMP, TIFF, ICO, PDF | — |
| PNG (.png) | JPG, WebP, AVIF, GIF, BMP, TIFF, ICO, PDF | — |
| WebP (.webp) | JPG, PNG, AVIF, GIF, BMP, TIFF, ICO, PDF | — |
| AVIF (.avif) | JPG, PNG, WebP, GIF, BMP, TIFF, ICO, PDF | — |
| GIF (.gif) | JPG, PNG, WebP, AVIF, BMP, TIFF, ICO, PDF, MP4, WebM, MOV, MKV | — |
| BMP (.bmp, .dib) | JPG, PNG, WebP, AVIF, GIF, TIFF, ICO, PDF | — |
| TIFF (.tiff, .tif) | JPG, PNG, WebP, AVIF, GIF, BMP, ICO, PDF | — |
| SVG (.svg) | PNG, JPG, WebP, AVIF, GIF, BMP, TIFF, ICO, PDF | — |
| ICO (.ico) | JPG, PNG, WebP, AVIF, GIF, BMP, TIFF, PDF | — |
| HEIC (.heic, .heif, .hif) | JPG, PNG, WebP, AVIF, GIF, BMP, TIFF, ICO, PDF | — |

## Documents

| From | On device | Server |
| --- | --- | --- |
| PDF (.pdf) | PNG, JPG, TXT | DOCX, ODT |
| DOC (.doc) | — | PDF, DOCX, HTML, Markdown, TXT, ODT, EPUB, RTF |
| DOCX (.docx) | HTML, Markdown, TXT | EPUB, ODT, RTF, PDF, DOC |
| ODT (.odt) | — | PDF, DOCX, HTML, Markdown, TXT, EPUB, RTF, DOC |
| RTF (.rtf) | — | PDF, DOCX, HTML, Markdown, TXT, ODT, EPUB, DOC |
| TXT (.txt, .text, .log) | HTML, Markdown | EPUB, DOCX, ODT, RTF, PDF, DOC |
| HTML (.html, .htm, .xhtml) | Markdown, TXT | PDF, DOCX, ODT, EPUB, RTF, DOC |
| Markdown (.md, .markdown, .mdown, .mkd) | HTML, TXT | PDF, DOCX, ODT, DOC, RTF, EPUB |

## Spreadsheets

| From | On device | Server |
| --- | --- | --- |
| XLSX (.xlsx) | XLS, ODS, CSV, TSV, JSON, HTML, SQL, Markdown, XML, YAML, TXT | PDF, DOCX, ODT, EPUB, RTF, DOC |
| XLS (.xls) | XLSX, ODS, CSV, TSV, JSON, HTML, SQL, Markdown, XML, YAML, TXT | PDF, DOCX, ODT, EPUB, RTF, DOC |
| ODS (.ods) | XLSX, XLS, CSV, TSV, JSON, HTML, SQL, Markdown, XML, YAML, TXT | PDF, DOCX, ODT, EPUB, RTF, DOC |

## Presentations

| From | On device | Server |
| --- | --- | --- |
| PPTX (.pptx) | — | PDF, PPT, ODP |
| PPT (.ppt) | — | PDF, PPTX, ODP |
| ODP (.odp) | — | PDF, PPTX, PPT |

## E-books

| From | On device | Server |
| --- | --- | --- |
| EPUB (.epub) | — | DOCX, HTML, Markdown, TXT, PDF, ODT, RTF, DOC |

## Audio

| From | On device | Server |
| --- | --- | --- |
| MP3 (.mp3) | WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA | — |
| WAV (.wav, .wave) | MP3, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA | — |
| FLAC (.flac) | MP3, WAV, AAC, M4A, OGG, Opus, AIFF, WMA | — |
| AAC (.aac) | MP3, WAV, FLAC, M4A, OGG, Opus, AIFF, WMA | — |
| M4A (.m4a) | MP3, WAV, FLAC, AAC, OGG, Opus, AIFF, WMA | — |
| OGG (.ogg, .oga) | MP3, WAV, FLAC, AAC, M4A, Opus, AIFF, WMA | — |
| Opus (.opus) | MP3, WAV, FLAC, AAC, M4A, OGG, AIFF, WMA | — |
| AIFF (.aiff, .aif, .aifc) | MP3, WAV, FLAC, AAC, M4A, OGG, Opus, WMA | — |
| WMA (.wma) | MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF | — |

## Video

| From | On device | Server |
| --- | --- | --- |
| MP4 (.mp4, .m4v) | MOV, MKV, AVI, WebM, WMV, FLV, MPEG, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| MOV (.mov, .qt) | MP4, MKV, AVI, WebM, WMV, FLV, MPEG, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| MKV (.mkv) | MP4, MOV, AVI, WebM, WMV, FLV, MPEG, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| AVI (.avi) | MP4, MOV, MKV, WebM, WMV, FLV, MPEG, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| WebM (.webm) | MP4, MOV, MKV, AVI, WMV, FLV, MPEG, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| WMV (.wmv) | MP4, MOV, MKV, AVI, WebM, FLV, MPEG, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| FLV (.flv) | MP4, MOV, MKV, AVI, WebM, WMV, MPEG, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| MPEG (.mpeg, .mpg, .mpe, .ts, .m2ts, .vob) | MP4, MOV, MKV, AVI, WebM, WMV, FLV, 3GP, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |
| 3GP (.3gp, .3g2) | MP4, MOV, MKV, AVI, WebM, WMV, FLV, MPEG, MP3, WAV, FLAC, AAC, M4A, OGG, Opus, AIFF, WMA, GIF | — |

## Archives

| From | On device | Server |
| --- | --- | --- |
| ZIP (.zip) | TAR, TAR.GZ, Extracted files | 7Z, TAR.BZ2, TAR.XZ |
| 7Z (.7z) | — | TAR, ZIP, TAR.GZ, Extracted files, TAR.BZ2, TAR.XZ |
| TAR (.tar) | ZIP, TAR.GZ, Extracted files | 7Z, TAR.BZ2, TAR.XZ |
| TAR.GZ (.tar.gz, .tgz) | ZIP, TAR, Extracted files | 7Z, TAR.BZ2, TAR.XZ |
| TAR.BZ2 (.tar.bz2, .tbz2, .tbz) | — | TAR, ZIP, TAR.GZ, Extracted files, 7Z, TAR.XZ |
| TAR.XZ (.tar.xz, .txz) | — | TAR, ZIP, TAR.GZ, Extracted files, 7Z, TAR.BZ2 |
| GZ (.gz) | Extracted files | — |
| BZ2 (.bz2) | — | Extracted files |
| XZ (.xz) | — | Extracted files |

## Data

| From | On device | Server |
| --- | --- | --- |
| CSV (.csv) | JSON, TSV, SQL, Markdown, HTML, XLSX, XLS, ODS, XML, YAML, TXT | EPUB, DOCX, ODT, RTF, PDF, DOC |
| TSV (.tsv, .tab) | JSON, CSV, SQL, Markdown, HTML, XLSX, XLS, ODS, XML, YAML, TXT | PDF, EPUB, DOCX, ODT, RTF, DOC |
| JSON (.json) | CSV, TSV, SQL, Markdown, HTML, XLSX, XLS, ODS, TXT, XML, YAML | EPUB, DOCX, ODT, RTF, PDF |
| XML (.xml) | JSON, CSV, TSV, SQL, Markdown, HTML, XLSX, XLS, ODS, YAML | PDF |
| YAML (.yaml, .yml) | JSON, CSV, TSV, SQL, Markdown, HTML, XLSX, XLS, ODS, XML | PDF |
