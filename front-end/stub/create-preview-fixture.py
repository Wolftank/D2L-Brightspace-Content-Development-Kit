"""Save the kit starter as an immutable preview and download fixture."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[2]
starter = root / 'back-end/kit/skills/d2l-scorm-package/assets/starter'
fixture = Path(__file__).parent / 'fixtures/preview'
fixture.mkdir(parents=True, exist_ok=True)
html = (starter / 'index.html').read_text(encoding='utf-8')
html = html.replace('RENAME ME', 'Sample SCORM activity')
html = html.replace('</head>', '<link rel="stylesheet" href="sample.css">\n</head>')
manifest = (starter / 'imsmanifest.xml').read_text(encoding='utf-8')
manifest = manifest.replace('<file href="index.html"/>', '<file href="index.html"/>\n      <file href="sample.css"/>')
files = {'index.html': html, 'imsmanifest.xml': manifest,
         'sample.css': '#root { border-top: 4px solid #7b2338; }\n'}
with ZipFile(fixture.parent / 'preview.zip', 'w', ZIP_DEFLATED) as archive:
    for name, content in files.items():
        data = content.encode('utf-8')
        (fixture / name).write_bytes(data)
        archive.writestr(name, data)
