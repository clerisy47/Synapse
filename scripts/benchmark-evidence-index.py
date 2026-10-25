#!/usr/bin/env python3
"""Generate synthetic scale fixtures and record immutable, isolated index timings."""
import argparse,hashlib,json,os,pathlib,subprocess,tempfile,time,re
p=argparse.ArgumentParser();p.add_argument('probe');p.add_argument('report');p.add_argument('--counts',default='120,1000,10000,100000');a=p.parse_args()
probe=str(pathlib.Path(a.probe).resolve());rows=[]
for count in map(int,a.counts.split(',')):
 with tempfile.TemporaryDirectory(prefix='synapse-scale-') as temporary:
  base=pathlib.Path(temporary).resolve();root=base/'workspace';root.mkdir();home=base/'home';home.mkdir()
  eligible_bytes=0
  for i in range(count):
   paragraphs=[]
   if count<=10000:
    for section in range(16):
     paragraphs.append(f'Project {i} recorded duration {section+2} minutes. The limitation is a single observational trial. '+'Synthetic calibration context for the project. '*9)
   else:paragraphs=['Project duration was 4 minutes.']
   body=f'---\ndescription: Project timing fixture\ntags: [scale]\naliases: []\n---\n# Project {i}\n\n'+'\n\n'.join(paragraphs)+'\n'
   (root/f'note-{i:06}.md').write_text(body);eligible_bytes+=len(body.encode())
  before=hashlib.sha256(''.join(hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(root.iterdir())).encode()).hexdigest()
  env={**os.environ,'HOME':str(home),'XDG_STATE_HOME':str(base/'state')}
  command=[probe,str(root)]
  if os.uname().sysname=='Darwin':command=['/usr/bin/time','-l',*command]
  start=time.monotonic();result=subprocess.run(command,env=env,capture_output=True,text=True,timeout=600)
  row={'count':count,'source_bytes':eligible_bytes,'exit_code':result.returncode,'elapsed_seconds':time.monotonic()-start}
  try:row.update(json.loads(result.stdout))
  except (ValueError,TypeError):row['status']='error'
  match=re.search(r'(\d+)\s+maximum resident set size',result.stderr)
  if match:row['peak_rss_bytes']=int(match[1])
  row['index_storage_bytes']=sum(f.stat().st_size for f in home.rglob('index-v1.sqlite3*') if f.is_file())+sum(f.stat().st_size for f in (base/'state').rglob('index-v1.sqlite3*') if f.is_file())
  after=hashlib.sha256(''.join(hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(root.iterdir())).encode()).hexdigest();row['notes_unchanged']=before==after
  row['gates_pass']=row['notes_unchanged'] and (row.get('status')=='refused' and row.get('code')=='resource_limit' if count>10000 else row.get('status')=='indexed' and row.get('cold_seconds',999)>0 and row.get('cold_seconds',999)<=120 and row.get('warm_p95_seconds',999)<=10 and row.get('ranking_p95_seconds',999)<=.5 and row.get('peak_rss_bytes',0)<=512*1024*1024 and row['index_storage_bytes']<=1024**3)
  rows.append(row);print(json.dumps(row),flush=True)
  pathlib.Path(a.report).write_text(json.dumps({'version':1,'probe_sha256':hashlib.sha256(pathlib.Path(probe).read_bytes()).hexdigest(),'cases':rows},indent=2)+'\n')
