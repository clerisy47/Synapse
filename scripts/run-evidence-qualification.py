#!/usr/bin/env python3
"""Three independent explicitly selected provider cycles on one immutable native binary/corpus.

This never starts a runtime, changes expectations or publishes. Remote requests
require explicit provider selection and disclosure consent. Raw legacy scores and additive semantic scores stay separate.
"""
import argparse,hashlib,json,os,pathlib,re,subprocess,sys,tempfile,time,urllib.request
from semantic_rubric import assess
from qualification_provider import add_provider_arguments, provider_options, provider_metadata
from vault_validation import validate_result
from vault_snapshot import snapshot
p=argparse.ArgumentParser();p.add_argument('binary');p.add_argument('vault');p.add_argument('report_directory');add_provider_arguments(p);a=p.parse_args();options=provider_options(p,a)
binary=pathlib.Path(a.binary).resolve();vault=pathlib.Path(a.vault).resolve();output=pathlib.Path(a.report_directory).resolve();output.mkdir(parents=True,exist_ok=True)
scripts=pathlib.Path(__file__).resolve().parent;fixtures=scripts.parent/'tests/fixtures';manifest=json.loads((fixtures/'semantic-v2.json').read_text())['cases']
build=hashlib.sha256(binary.read_bytes()).hexdigest();baseline=snapshot(vault);cycles=[]
def runtime_ready():
 if a.provider == 'openrouter':return True
 try:
  with urllib.request.urlopen('http://127.0.0.1:18080/health',timeout=3) as response:return response.status==200
 except Exception:return False
if not runtime_ready():
 print('local_runtime_unavailable: restore the existing user-managed runtime before qualification',file=sys.stderr);raise SystemExit(2)
for cycle in range(1,4):
 prefix=output/f'cycle-{cycle}';row={'cycle':cycle,'binary_sha256':build,'runtime':provider_metadata(a)}
 for kind,script,arguments in [('vault','test-rust-vault.py',[str(binary),str(vault),str(prefix)+'-vault.json']),('holdouts','test-evidence-holdouts.py',[str(binary),str(prefix)+'-holdouts.json']),('adversarial','test-rust-vault-adversarial.py',[str(binary),str(prefix)+'-adversarial.json'])]:
  if not runtime_ready():row['blocked']='local_runtime_unavailable';break
  result=subprocess.run([sys.executable,str(scripts/script),*arguments,*options]);row[kind+'_exit']=result.returncode
  if hashlib.sha256(binary.read_bytes()).hexdigest()!=build:raise SystemExit('qualification binary changed')
 if 'blocked' not in row:
  legacy=json.loads(pathlib.Path(str(prefix)+'-vault.json').read_text());semantic=[];exclusions=[]
  for case in legacy['cases']:
   if not case['case'].startswith('excluded-'):continue
   if case['case']=='excluded-metrics-tag':
    forbidden=[str(path.relative_to(vault)) for path in vault.rglob('*.md') if 'machine-learning' in path.read_text().split('---',2)[1]]
    score=assess(case['result'],vault,required=[('75 percent',['Search Lab/Lantern Precision Trial.md']),('80 percent',['Search Lab/Lantern Recall Trial.md'])],forbidden_paths=forbidden,allow_abstention=True)
    exclusions.append({'case':case['case'],'correctness':score['correctness'],'exclusion':score['exclusion'],'score':score})
   else:
    sources=case['result'].get('sources',[]) if isinstance(case['result'],dict) else []
    exclusions.append({'case':case['case'],'correctness':case['passed'],'exclusion':not any(source.get('path','').startswith('Everyday/') for source in sources)})
  row['exclusion_gates_pass']=all(case['exclusion'] and case['correctness'] for case in exclusions)
  pathlib.Path(str(prefix)+'-exclusions.json').write_text(json.dumps({'version':1,'cases':exclusions},indent=2)+'\n')
  for case in legacy['cases']:
   if case['command']!='ask' or case['case'].startswith('excluded-'):continue
   rule=manifest.get(case['case'])
   if rule:
    score=assess(case['result'],vault,required=rule.get('required',()),illustrative=rule.get('illustrative',()),expected=rule.get('expected','answered'))
    passed=score['correctness']
   else:score=None;passed=case['passed']
   semantic.append({'case':case['case'],'question':case.get('question'),'passed':passed,'score':score})
  assert len(semantic)==23,'documented semantic question set changed'
  with tempfile.TemporaryDirectory(prefix='synapse-compass-') as temporary:
   home=pathlib.Path(temporary).resolve();question='In the Compass worked example, how many items were completed out of the total, what completion percentage is that, and does it measure correctness?'
   started=time.monotonic()
   result=subprocess.run([str(binary),'ask','--workspace',str(vault),question,'--json','--stats',*options],env={**os.environ,'HOME':str(home)},capture_output=True,timeout=260)
   try:answer=json.loads(result.stdout)
   except ValueError:answer=None
   source='Learning Notes/Compass Worked Example.md'
   score=assess(answer,vault,required=[(fact,[source]) for fact in ('18','24','75 percent','does not measure correctness')])
   match=re.search(rb'Query stats: calls=(\d+) prompt_tokens=(\d+) candidates=(\d+) served=(\d+) final=(\d+) elapsed_ms=(\d+) completion_tokens=(\d+)',result.stderr)
   usage=dict(zip(('calls','prompt_tokens','candidate_ranges','served_ranges','final_ranges','elapsed_ms','completion_tokens'),map(int,match.groups()))) if match else None
   semantic.append({'case':'compass-explicit-multipart','question':question,'passed':result.returncode==0 and score['correctness'],'score':score,'result':answer,'seconds':time.monotonic()-started,'usage':usage})
  row['raw_legacy_score']=[legacy['passed'],legacy['total']];row['semantic_passed']=sum(case['passed'] for case in semantic);row['semantic_total']=24
  pathlib.Path(str(prefix)+'-semantic.json').write_text(json.dumps({'version':1,'binary_sha256':build,'cases':semantic},indent=2)+'\n')
  holdouts=json.loads(pathlib.Path(str(prefix)+'-holdouts.json').read_text());adversarial=json.loads(pathlib.Path(str(prefix)+'-adversarial.json').read_text())
  row['holdouts_passed']=holdouts['passed'];row['holdouts_total']=holdouts['total'];row['adversarial_passed']=adversarial['passed'];row['adversarial_total']=adversarial['total']
  row['automated_gates_pass']=row['semantic_passed']==24 and row['holdouts_passed']==24 and row['adversarial_passed']==11 and row['exclusion_gates_pass'] and baseline==snapshot(vault)
 row['corpus_unchanged']=baseline==snapshot(vault);row['human_passage_review']='pending'
 cycles.append(row);(output/'cycles.json').write_text(json.dumps({'version':1,'binary_sha256':build,'planned_cycles':3,'cycles':cycles,'release_qualified':False},indent=2)+'\n')
 if 'blocked' in row:raise SystemExit(2)
 if not row['automated_gates_pass']:
  print('Qualification gate failed; preserving this build’s cycle before further implementation.',file=sys.stderr);raise SystemExit(1)
print('Three cycles recorded; source passage review and terminal/MCP/install gates remain separate.')
raise SystemExit(0 if all(c.get('automated_gates_pass') for c in cycles) else 1)
