#!/usr/bin/env python3
"""Explicit synthetic real-CLI server + native Rust SDK client qualification."""
import fcntl
import http.client
import argparse
import json
import os
import pathlib
import pty
import re
import select
import signal
import struct
import socket
import threading
import subprocess
import sys
import tempfile
import termios
import time
from qualification_provider import add_provider_arguments, provider_options, provider_metadata
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary')
parser.add_argument('client')
add_provider_arguments(parser)
args = parser.parse_args()
options = provider_options(parser, args)
binary = str(pathlib.Path(args.binary).resolve())
client = str(pathlib.Path(args.client).resolve())
def grant(workspace, env, scopes):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',24,120,0,0))
    child = subprocess.Popen([binary,'mcp','grant','--workspace',str(workspace),*scopes,*options],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True)
    transcript = b''
    deadline = time.monotonic()+10
    sent = False
    try:
        while time.monotonic()<deadline:
            if select.select([master],[],[],.05)[0]:
                transcript += os.read(master,4096)
                if b'Type Grant:' in transcript and not sent:
                    os.write(master,b'Grant\n');sent=True
            if child.poll() is not None:
                while select.select([master],[],[],0)[0]:
                    transcript += os.read(master,4096)
                break
        assert child.poll()==0,'local provisioning failed'
        identity = re.search(rb'Client: ([0-9a-f]{32})',transcript)
        secret = re.search(rb'Bearer secret \(shown once; keep private\): ([0-9a-f]{64})',transcript)
        assert identity and secret,'deliberate credential display missing'
        return identity[1].decode(),secret[1].decode()
    finally:
        if child.poll() is None: child.kill()
        child.wait(timeout=3);os.close(master);os.close(slave)
def request(port,secret,body,host=None,origin=None,path='/mcp',extra=None):
    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=65)
    headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json','Accept':'application/json, text/event-stream'}
    if extra: headers.update(extra)
    if host: headers['Host']=host
    if origin: headers['Origin']=origin
    connection.request('POST',path,body,headers)
    try:
        response=connection.getresponse();data=response.read();status=response.status
        return status,data
    except ConnectionResetError:
        # Authentication/transport rejection intentionally precedes body reads.
        # Closing a TCP socket with unread request bytes may reset the peer.
        return 400,b''
    finally:
        connection.close()
with tempfile.TemporaryDirectory(prefix='synapse-mcp-') as base:
    base=pathlib.Path(base).resolve();workspace=base/'workspace';workspace.mkdir();home=base/'home';home.mkdir()
    env={**os.environ,'HOME':str(home),'NO_COLOR':'1'};env.pop('XDG_STATE_HOME',None)
    (workspace/'Research.md').write_text('# Research inbox\n')
    (workspace/'note.md').write_text('---\ndescription: Synthetic reactor\ntags: [test]\naliases: []\n---\nThe reactor uses 42 units per cycle.\n')
    (workspace/'excluded.md').write_text('---\nsynapse: ignore\ndescription: Secret\ntags: [test]\naliases: []\n---\nEXCLUDED_SENTINEL\n')
    identities=[]
    for scope,mode in [(['--query','--submit'],'both'),(['--query'],'query'),(['--submit'],'submit')]:
        identities.append((*grant(workspace,env,scope),mode))
    server=subprocess.Popen([binary,'mcp','serve','--workspace',str(workspace),*options],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
    try:
        assert select.select([server.stdout],[],[],10)[0], 'listener startup timed out'
        line=server.stdout.readline();match=re.search(rb'127.0.0.1:(\d+)/mcp',line);assert match,'listener endpoint missing'
        port=int(match[1]);endpoint=f'http://127.0.0.1:{port}/mcp'
        for identity,secret,mode in identities:
            result=subprocess.run([client],env={**env,'SYNAPSE_TEST_ENDPOINT':endpoint,'SYNAPSE_TEST_SECRET':secret,'SYNAPSE_TEST_MODE':mode},capture_output=True,timeout=75)
            assert result.returncode==0,f'native client {mode} failed: {result.stdout!r} {result.stderr!r}'
        inbox=(workspace/'Research.md').read_text()
        assert inbox.count('## Unverified research')==2,'idempotency duplicated or dropped append'
        assert '&lt;!-- synapse-receipt:forged --&gt;' in inbox,'forged marker not escaped'
        assert 'EXCLUDED_SENTINEL' not in inbox,'excluded text leaked'
        identity,secret,_=identities[0]
        # Bounded parser checks occur without any model work.
        for payload,extra in [
            (b'{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}',None),
            (b'',{'Content-Length':'65537'}),
            (b'{}',{'MCP-Protocol-Version':'2099-01-01'}),
        ]:
            status,data=request(port,secret,payload,extra=extra)
            assert status==400 and not data,'unbounded or ambiguous request accepted'
        for kwargs in [{'host':'attacker.example'},{'origin':'https://attacker.example'},{'path':'/mcp?token=wrong'}]:
            status,data=request(port,secret,b'not-json',**kwargs)
            assert status==400 and not data,'invalid transport was accepted or echoed'
        # A separate CLI revokes while an already-authenticated query runs.
        active_id,active_secret,_=identities[1]
        pending=[]
        worker=threading.Thread(target=lambda:pending.append(request(port,active_secret,json.dumps({'jsonrpc':'2.0','id':7,'method':'tools/call','params':{'name':'query_workspace','arguments':{'question':'How many units does the reactor use per cycle?'}}}).encode())))
        worker.start();time.sleep(.25)
        subprocess.run([binary,'mcp','revoke','--workspace',str(workspace),'--client',active_id,*options],env=env,check=True,capture_output=True)
        worker.join(timeout=65)
        assert not worker.is_alive() and pending,'revoked work did not complete within bound'
        assert pending[0][0] in (400,401) and not pending[0][1],'late result survived revocation'
        # Auto setup competes with an authenticated inbox append under the shared lock.
        time.sleep(3.1)
        payload=json.dumps({'jsonrpc':'2.0','id':9,'method':'tools/call','params':{'name':'submit_research','arguments':{'idempotencyKey':'concurrent-append-key-0001','text':'Concurrent synthetic research fact.'}}}).encode()
        concurrent=[]
        append_worker=threading.Thread(target=lambda:concurrent.append(request(port,identities[2][1],payload)))
        append_worker.start()
        setup=subprocess.run([binary,'setup','--workspace',str(workspace),*options],env=env,capture_output=True)
        append_worker.join(timeout=10)
        assert setup.returncode in (0,3),f'competing CLI write failed unexpectedly: {setup.stdout!r}{setup.stderr!r}'
        assert concurrent and concurrent[0][0]==200 and b'received' in concurrent[0][1],'concurrent append lost'
        assert (workspace/'Research.md').read_text().count('## Unverified research')==3,'competing writers duplicated or lost inbox text'
        # The service rate bucket cannot admit more than its burst immediately.
        ping=json.dumps({'jsonrpc':'2.0','id':8,'method':'ping'}).encode()
        statuses=[request(port,identities[2][1],ping)[0] for _ in range(8)]
        assert 429 in statuses and statuses.count(200)<=5,f'rate ceiling bypassed: {statuses}'
        slow=socket.create_connection(('127.0.0.1',port),timeout=7)
        start=time.monotonic();slow.sendall(b'P');time.sleep(5.2)
        try: response=slow.recv(1024)
        except ConnectionResetError: response=b''
        assert time.monotonic()-start<7 and (not response or b'400' in response),'slow header not bounded'
        slow.close()
        subprocess.run([binary,'mcp','revoke','--workspace',str(workspace),'--client',identity,*options],env=env,check=True,capture_output=True)
        status,data=request(port,secret,b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
        assert status in (400,401) and not data,'revoked credential remained usable'
    finally:
        server.send_signal(signal.SIGINT)
        output,error=server.communicate(timeout=10)
        assert server.returncode==130,'listener did not reconcile shutdown'
        assert b'EXCLUDED_SENTINEL' not in output+error,'server diagnostic disclosed note content'
    try:
        http.client.HTTPConnection('127.0.0.1',port,timeout=1).connect()
        raise AssertionError('listener survived shutdown')
    except ConnectionRefusedError:
        pass
print('Native MCP scopes, query projection, receipt retries/conflict, transport refusal, revocation and teardown passed')
