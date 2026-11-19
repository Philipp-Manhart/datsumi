"""Verify the exact distributable, not just build directories. No external Python packages."""
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

path = Path(sys.argv[1])
with zipfile.ZipFile(path) as archive:
    names = archive.namelist()
    manifest = json.loads(archive.read('extension/package.json'))
    vsix_manifest = ET.fromstring(archive.read('extension.vsixmanifest'))
    ns = {'v': 'http://schemas.microsoft.com/developer/vsx-schema/2011'}
    properties = {item.attrib['Id']: item.attrib.get('Value') for item in vsix_manifest.findall('.//v:Property', ns)}
    pre_release = properties.get('Microsoft.VisualStudio.Code.PreRelease', '').lower() == 'true'
    flags = re.split(r'[,\s]+', vsix_manifest.findtext('.//v:GalleryFlags', '', ns))
    if manifest.get('preview'):
        assert pre_release and 'Preview' in flags, 'Preview must use the Marketplace pre-release channel and label'
    else:
        assert not pre_release and 'Preview' not in flags, 'Stable release must not contain pre-release or Preview flags'
    assert manifest['license'] == 'MIT', 'Project license must be MIT'
    for document in ['PRIVACY.md','SECURITY.md','SUPPORT.md','SETTINGS.md','SUPPORT-MATRIX.md','CONNECTIONS.md','GETTING-STARTED.md']:
        assert archive.read('extension/' + document), 'Missing offline help: ' + document
    license_file = next(name for name in names if re.fullmatch(r'extension/licen[sc]e(?:\.(?:txt|md))?', name, re.I))
    assert b'Permission is hereby granted' in archive.read(license_file)
    assert archive.read('extension/' + manifest['icon']).startswith(b'\x89PNG\r\n\x1a\n')
    assert not any(re.search(r'(?:/(?:src|test|node_modules)/|\.(?:pem|key|sqlite|duckdb|map)$|/\.env(?:\.|$))', name) for name in names), 'Unexpected source/private artifact in VSIX'
    catalog = json.loads(archive.read('extension/dist/driver-catalog.json'))
    for artifact in catalog:
        payload = archive.read('extension/dist/drivers/' + artifact['file'])
        assert len(payload) == artifact['bytes']
        assert hashlib.sha256(payload).hexdigest() == artifact['sha256']
    assert not any(re.search(r'\.vsix(?:\.sha256)?$', name) for name in names), 'Nested release artifact in VSIX'
    inventories = [name for name in names if name.endswith('.components.json')]
    assert len(inventories) >= len(catalog) + 3, 'Missing core/webview/native license inventory'
    components = set()
    for inventory in inventories:
        notices = archive.read(inventory.replace('.components.json', '.NOTICES.txt')).decode()
        for item in json.loads(archive.read(inventory)):
            assert item['license'] not in ('UNLICENSED', 'UNKNOWN', ''), item
            assert item['name'] + '@' + item['version'] in notices, item
            components.add(item['name'])
    assert {'react', 'react-dom', 'scheduler', 'tailwindcss', '@vscode/codicons'} <= components
    assert 'mariadb' not in components, 'LGPL MariaDB transport must not be bundled'
sha = hashlib.sha256(path.read_bytes()).hexdigest()
path.with_suffix(path.suffix + '.sha256').write_text(sha + '  ' + path.name + '\n')
print(json.dumps({'file':str(path),'version':manifest['version'],'sha256':sha,'components':len(components),'checks':'passed'}))
