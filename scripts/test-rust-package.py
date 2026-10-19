#!/usr/bin/env python3
"""Isolated native archive install/upgrade/uninstall qualification."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
artifact=pathlib.Path(sys.argv[1]).resolve()
checksum=artifact.with_suffix(artifact.suffix+'.sha256')
if checksum.exists():assert checksum.read_text().split()[0]==hashlib.sha256(artifact.read_bytes()).hexdigest(),'archive checksum mismatch'
with tempfile.TemporaryDirectory(prefix='synapse-package-') as base:
 base=pathlib.Path(base).resolve();unpacked=base/'unpacked';unpacked.mkdir()
 with tarfile.open(artifact) as archive:
  members=archive.getmembers();roots={pathlib.PurePosixPath(m.name).parts[0] for m in members};assert len(roots)==1
  prefix=next(iter(roots))
  allowed={'bin/synapse','LICENSE','THIRD_PARTY_LICENSES.txt','manifest.json','README.md','docs/rust-review.md','docs/contracts/cli-v1.md','docs/contracts/mcp-v1.md','docs/rust-providers.md','docs/native-install.md'}
  assert {m.name.removeprefix(prefix+'/') for m in members}==allowed,'artifact allowlist mismatch'
  for member in members:
   assert member.isfile() and not member.issym() and not member.islnk(),'unexpected archive type'
   assert '..' not in pathlib.PurePosixPath(member.name).parts and not member.name.startswith('/'),'unsafe archive path'
  archive.extractall(unpacked,filter='data')
 folder=unpacked/prefix;manifest=json.loads((folder/'manifest.json').read_text())
 for name,expected in manifest['sha256'].items():assert hashlib.sha256((folder/name).read_bytes()).hexdigest()==expected
 install=base/'install';(install/'bin').mkdir(parents=True);(install/'keep.txt').write_text('unrelated')
 workspace=base/'workspace';workspace.mkdir();(workspace/'keep.md').write_text('Preserved note\n');(workspace/'Research.md').write_text('Synthetic research\n');home=base/'home';home.mkdir()
 env={**os.environ,'HOME':str(home),'PATH':str(install/'bin')+':/usr/bin:/bin','NO_COLOR':'1'};env.pop('XDG_STATE_HOME',None)
 executable=install/'bin/synapse'
 for iteration in range(2):
  staging=install/'bin/synapse.new';shutil.copyfile(folder/'bin/synapse',staging);staging.chmod(0o755);staging.replace(executable)
  version=subprocess.run(['synapse','--version'],cwd=base,env=env,capture_output=True,check=True)
  assert version.stdout.decode().strip()=='synapse '+manifest['productVersion']
  subprocess.run(['synapse','--help'],cwd=base,env=env,stdout=subprocess.DEVNULL,check=True)
  subprocess.run(['synapse','doctor','--workspace',str(workspace),'--offline'],cwd=base,env=env,stdout=subprocess.DEVNULL,check=True)
  denied=subprocess.run(['synapse','setup','--workspace',str(workspace)],cwd=base,env=env,input=b'Apply\n',capture_output=True)
  assert denied.returncode==2,'installed binary accepted piped approval'
  if iteration==0:
   wrong=subprocess.run(['synapse','research','capture','--workspace',str(workspace),'--file','keep.md'],cwd=base,env=env,capture_output=True)
   assert wrong.returncode!=0,'capture accepted an arbitrary file'
   subprocess.run(['synapse','research','capture','--workspace',str(workspace),'--file','Research.md'],cwd=base,env=env,stdout=subprocess.DEVNULL,check=True)
   state_before={str(p.relative_to(home)):p.read_bytes() for p in home.rglob('*.json')}
   assert state_before,'capture state missing'
  else:
   assert state_before=={str(p.relative_to(home)):p.read_bytes() for p in home.rglob('*.json')},'upgrade changed state'
 assert (workspace/'keep.md').read_text()=='Preserved note\n'
 executable.unlink()
 assert state_before=={str(p.relative_to(home)):p.read_bytes() for p in home.rglob('*.json')},'uninstall changed state'
 assert not executable.exists() and (install/'keep.txt').read_text()=='unrelated'
 assert (workspace/'keep.md').read_text()=='Preserved note\n'
print('Native archive allowlist/checksums, isolated install/same-version upgrade/uninstall and piped approval refusal passed')
