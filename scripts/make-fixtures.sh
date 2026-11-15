#!/usr/bin/env bash
# Builds small, real sample files for every supported input format into tests/fixtures.
# Needs: ffmpeg, ImageMagick (convert), LibreOffice (soffice), pandoc, tar, gzip, bzip2, xz,
# and Python with Pillow + pillow-heif for the HEIC sample.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=tests/fixtures
SEVENZ=$(node -e "process.stdout.write(require('7zip-bin').path7za)")
rm -rf "$OUT" && mkdir -p "$OUT"
cd "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Images: a 64 × 48 picture with a transparent corner.
convert -size 64x48 xc:'#1e78dc' -fill '#c85028' -draw 'rectangle 0,24 63,47' -alpha set \
  -fill none -draw 'color 0,0 floodfill' -region 16x12+0+0 -alpha transparent sample.png
convert sample.png -background white -flatten -quality 90 sample.jpg
convert sample.png -quality 90 sample.webp
convert sample.png sample.gif
convert sample.png -background white -flatten BMP3:sample.bmp
convert sample.png -depth 8 -compress lzw sample.tiff
convert sample.png -define icon:auto-resize=48,32,16 sample.ico
ffmpeg -loglevel error -y -i sample.jpg -c:v libaom-av1 -still-picture 1 -crf 30 sample.avif
python3 - <<'PY'
import pillow_heif
from PIL import Image
pillow_heif.register_heif_opener()
Image.open('sample.png').convert('RGB').save('sample.heic', quality=90)
PY
cat > sample.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 24" width="32" height="24">
  <rect width="32" height="12" fill="#1e78dc"/>
  <rect y="12" width="32" height="12" fill="#c85028"/>
  <script>document.title = 'should never run'</script>
</svg>
SVG

# Text, markup and data.
cat > sample.md <<'MD'
# CocoaConvert sample

A paragraph with **bold**, *italic* and a [link](https://example.com).

- First item
- Second item

| Name | Size |
| --- | --- |
| Alpha | 1 |
| Beta | 2 |
MD
printf 'CocoaConvert sample\n\nPlain text with two paragraphs.\nSecond line & <angle> characters.\n' > sample.txt
pandoc -s -f gfm -t html5 --metadata title="CocoaConvert sample" sample.md -o sample.html
printf 'name,size,active,note\nAlpha,1,true,"Comma, inside"\nBeta,2.5,false,"Line ""quoted"""\nGamma,,true,Ünïcode\n' > sample.csv
printf 'name\tsize\nAlpha\t1\nBeta\t2\n' > sample.tsv
cat > sample.json <<'JSON'
[
  { "name": "Alpha", "size": 1, "tags": ["a", "b"], "owner": { "id": 7, "email": "a@example.com" } },
  { "name": "Beta", "size": 2.5, "tags": [], "owner": { "id": 8 } }
]
JSON
cat > sample.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="b1"><title>Alpha</title><price>10.5</price></book>
  <book id="b2"><title>Beta</title><price>7</price></book>
</catalog>
XML
printf 'name: CocoaConvert\nversion: 1\nformats:\n  - png\n  - jpg\nnested:\n  enabled: true\n' > sample.yaml

# Office documents.
pandoc -f gfm sample.md -o sample.docx
pandoc -f gfm sample.md -o sample.odt
pandoc -s -f gfm sample.md -o sample.rtf
pandoc -f gfm --metadata title="CocoaConvert sample" sample.md -o sample.epub
pandoc -f gfm sample.md -o sample.pptx
PROFILE="-env:UserInstallation=file://$TMP/lo"
soffice --headless $PROFILE --convert-to 'doc:MS Word 97' --outdir . sample.docx >/dev/null 2>&1
soffice --headless $PROFILE --convert-to pdf --outdir . sample.docx >/dev/null 2>&1
soffice --headless $PROFILE --convert-to 'ppt:MS PowerPoint 97' --outdir . sample.pptx >/dev/null 2>&1
soffice --headless $PROFILE --convert-to odp --outdir . sample.pptx >/dev/null 2>&1
soffice --headless $PROFILE --infilter=CSV:44,34,76,1 --convert-to 'xlsx:Calc MS Excel 2007 XML' --outdir . sample.csv >/dev/null 2>&1
soffice --headless $PROFILE --infilter=CSV:44,34,76,1 --convert-to 'xls:MS Excel 97' --outdir . sample.csv >/dev/null 2>&1
soffice --headless $PROFILE --infilter=CSV:44,34,76,1 --convert-to ods --outdir . sample.csv >/dev/null 2>&1

# Audio: one second of a tone.
A="-loglevel error -y -f lavfi -i sine=frequency=440:duration=1 -metadata title=Sample"
ffmpeg $A -c:a libmp3lame -b:a 64k sample.mp3
ffmpeg $A sample.wav
ffmpeg $A sample.flac
ffmpeg $A -c:a aac -b:a 64k sample.aac
ffmpeg $A -c:a aac -b:a 64k sample.m4a
ffmpeg $A -c:a libvorbis sample.ogg
ffmpeg $A -c:a libopus sample.opus
ffmpeg $A sample.aiff
ffmpeg $A -c:a wmav2 sample.wma

# Video: one second, 160 × 120, with sound.
V="-loglevel error -y -f lavfi -i testsrc=size=160x120:rate=15:duration=1 -f lavfi -i sine=duration=1 -shortest"
ffmpeg $V -c:v libx264 -pix_fmt yuv420p -c:a aac sample.mp4
ffmpeg $V -c:v libx264 -pix_fmt yuv420p -c:a aac sample.mov
ffmpeg $V -c:v libx264 -pix_fmt yuv420p -c:a aac sample.mkv
ffmpeg $V -c:v mpeg4 -c:a libmp3lame sample.avi
ffmpeg $V -c:v libvpx-vp9 -c:a libopus sample.webm
ffmpeg $V -c:v wmv2 -c:a wmav2 sample.wmv
ffmpeg $V -c:v flv -c:a libmp3lame -ar 44100 sample.flv
ffmpeg $V -c:v mpeg2video -c:a mp2 -f mpeg sample.mpeg
ffmpeg $V -c:v libx264 -profile:v baseline -pix_fmt yuv420p -c:a aac -ar 22050 -ac 1 sample.3gp
ffmpeg -loglevel error -y -f lavfi -i testsrc=size=80x60:rate=5:duration=1 animated.gif

# Archives holding two small files in a folder.
mkdir -p "$TMP/pack/folder"
cp sample.txt "$TMP/pack/folder/notes.txt"
cp sample.png "$TMP/pack/picture.png"
(cd "$TMP/pack" && zip -qr "$OLDPWD/sample.zip" . && tar -cf "$OLDPWD/sample.tar" . && "$SEVENZ" a -bd -t7z "$OLDPWD/sample.7z" . >/dev/null)
gzip -9 -c sample.tar > sample.tar.gz
bzip2 -9 -c sample.tar > sample.tar.bz2
xz -c sample.tar > sample.tar.xz
gzip -9 -c sample.txt > sample.txt.gz
bzip2 -9 -c sample.txt > sample.txt.bz2
xz -c sample.txt > sample.txt.xz

ls -la
du -sh .
