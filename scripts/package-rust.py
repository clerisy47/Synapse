#!/usr/bin/env python3
"""Produce a native development archive from an explicit file allowlist."""
import gzip
import hashlib
import io
import json
import os
import pathlib
import platform
import re
import subprocess
import tarfile
import tomllib
root=pathlib.Path(__file__).resolve().parent.parent
cargo=os.environ.get('SYNAPSE_CARGO','cargo')
version=tomllib.loads((root/'Cargo.toml').read_text())['workspace']['package']['version']
target=subprocess.check_output([os.environ.get('SYNAPSE_RUSTC','rustc'),'-vV'],text=True).split('host: ')[1].splitlines()[0]
subprocess.run([cargo,'build','--locked','--release','-p','synapse-terminal'],cwd=root,check=True)
files={'bin/synapse':(root/'target/release/synapse').read_bytes(),'LICENSE':(root/'LICENSE').read_bytes()}
for path in ['README.md','docs/contracts/cli-v1.md','docs/contracts/mcp-v1.md','docs/native-install.md']:
 files[path]=(root/path).read_bytes()
# Include enabled normal/build dependencies, their declared license and all
# root license/notice texts. No user directory names enter this document.
tree=subprocess.check_output([cargo,'tree','--locked','-p','synapse-terminal','--edges','normal,build','--prefix','none','--format','{p}'],cwd=root,text=True)
packages=sorted(set(re.findall(r'^([A-Za-z0-9_-]+) v([^\s]+)',tree,re.M)))
cargo_home=pathlib.Path(os.environ.get('CARGO_HOME',pathlib.Path.home()/'.cargo'))
notices=[]
for name,release in packages:
 if name.startswith('synapse-'):continue
 candidates=list((cargo_home/'registry/src').glob(f'*/{name}-{release}'))
 if len(candidates)!=1:raise SystemExit('dependency source unavailable for license review')
 source=candidates[0];manifest=tomllib.loads((source/'Cargo.toml').read_text())['package']
 notices.append(f'\n{name} {release}\nLicense: {manifest.get("license","see license files")}\nSource: https://crates.io/crates/{name}/{release}\n')
 texts=[]
 for path in source.iterdir():
  if path.is_file() and re.match(r'(?i)^(licen[cs]e|copying|notice|unlicense)([.\-_].*)?$',path.name):
   texts.append(path)
 explicit=manifest.get('license-file')
 if explicit:
  path=source/explicit
  if path.is_file() and path not in texts:texts.append(path)
 if not texts:
  adopted = {'rmcp': 'rmcp-0.8.5-MIT.txt', 'rmcp-macros': 'rmcp-0.8.5-MIT.txt', 'unicode-casefold': 'unicode-casefold-0.2.0-APACHE.txt'}.get(name)
  if adopted and (root/'docs/licenses'/adopted).is_file(): texts.append(root/'docs/licenses'/adopted)
  else: raise SystemExit(f'missing dependency license text: {name}')
 for path in sorted(texts):notices.append(f'\n--- {path.name} ---\n'+path.read_text(errors='replace'))
files['THIRD_PARTY_LICENSES.txt']='\n'.join(notices).encode()
manifest={'version':1,'productVersion':version,'target':target,'toolchain':'1.85.1','qualification':'development; publication not authorized','sha256':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
files['manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
output=root/'target/packages'/f'synapse-{version}-{target}.tar.gz';output.parent.mkdir(parents=True,exist_ok=True)
prefix=f'synapse-{version}-{target}'
with output.open('wb') as raw:
 with gzip.GzipFile(filename='',fileobj=raw,mode='wb',mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w') as archive:
   for name,data in sorted(files.items()):
    info=tarfile.TarInfo(prefix+'/'+name);info.size=len(data);info.mode=0o755 if name=='bin/synapse' else 0o644;info.mtime=0
    archive.addfile(info,io.BytesIO(data))
output.with_suffix(output.suffix+'.sha256').write_text(hashlib.sha256(output.read_bytes()).hexdigest()+'  '+output.name+'\n')
# Verify archive contents/hashes before printing its intentional artifact path.
with tarfile.open(output) as archive:
 assert {m.name for m in archive.getmembers()}=={prefix+'/'+name for name in files}
 assert all(m.isfile() and not m.issym() and not m.islnk() for m in archive.getmembers())
 for name,expected in manifest['sha256'].items():assert hashlib.sha256(archive.extractfile(prefix+'/'+name).read()).hexdigest()==expected
print(output)
