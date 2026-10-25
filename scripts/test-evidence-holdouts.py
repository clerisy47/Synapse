#!/usr/bin/env python3
"""Frozen synthetic semantic holdouts; source-bound anchors plus authentic excerpts."""
import argparse,hashlib,json,os,pathlib,subprocess,tempfile,time,re
from semantic_rubric import assess
from qualification_provider import add_provider_arguments, provider_options, provider_metadata
from vault_snapshot import snapshot
p=argparse.ArgumentParser();p.add_argument('binary');p.add_argument('report');add_provider_arguments(p);a=p.parse_args();options=provider_options(p,a);binary=str(pathlib.Path(a.binary).resolve())
fixture=pathlib.Path(__file__).resolve().parent.parent/'tests/fixtures/evidence-holdouts-v1.json';cases=json.loads(fixture.read_text())['cases'];rows=[]
for case in cases:
 with tempfile.TemporaryDirectory(prefix='synapse-holdout-') as temporary:
  base=pathlib.Path(temporary).resolve();root=base/'workspace';root.mkdir();home=base/'home';home.mkdir()
  for name,body in case['notes'].items():
   f=root/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('---\ndescription: Frozen synthetic holdout\ntags: [fixture]\naliases: []\n---\n'+body+'\n')
  before=snapshot(root);start=time.monotonic();failures=[];result=None;out=None
  try:
   out=subprocess.run([binary,'ask','--workspace',str(root),case['question'],'--json','--stats',*options],env={**os.environ,'HOME':str(home),'XDG_STATE_HOME':str(base/'state')},capture_output=True,timeout=260)
   if out.returncode:failures.append('exit')
   result=json.loads(out.stdout)
  except (OSError,ValueError,subprocess.TimeoutExpired):failures.append('execution')
  score=assess(result,root,required=case['required'],expected=case['expected']);unchanged=before==snapshot(root)
  usage_match=re.search(rb'Query stats: calls=(\d+) prompt_tokens=(\d+) candidates=(\d+) served=(\d+) final=(\d+) elapsed_ms=(\d+)',out.stderr) if out is not None else None
  usage=dict(zip(('calls','prompt_tokens','candidate_ranges','served_ranges','final_ranges','elapsed_ms'),map(int,usage_match.groups()))) if usage_match else None
  if usage is not None:
   completion=re.search(rb'completion_tokens=(\d+)',out.stderr);usage['completion_tokens']=int(completion[1]) if completion else None
  row={'id':case['id'],'question':case['question'],'passed':not failures and score['correctness'] and unchanged,'failures':failures,'score':score,'seconds':round(time.monotonic()-start,3),'notes_unchanged':unchanged,'result':result,'usage':usage}
  rows.append(row);print(case['id']+(': PASS' if row['passed'] else ': FAIL'),flush=True)
  pathlib.Path(a.report).write_text(json.dumps({'version':1,'runtime':provider_metadata(a),'fixture_sha256':hashlib.sha256(fixture.read_bytes()).hexdigest(),'binary_sha256':hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),'passed':sum(r['passed'] for r in rows),'total':len(rows),'cases':rows},indent=2)+'\n')
raise SystemExit(0 if all(r['passed'] for r in rows) else 1)
