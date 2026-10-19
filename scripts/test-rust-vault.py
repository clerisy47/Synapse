#!/usr/bin/env python3
"""Opt-in read-only local evaluation of Synapse-Test-Vault; never edits its source."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time

binary = str(pathlib.Path(sys.argv[1]).resolve())
vault = pathlib.Path(sys.argv[2]).resolve()
report_path = pathlib.Path(sys.argv[3])

def snapshot(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file() and not p.is_symlink()}

original = snapshot(vault)
notes = sorted(vault.rglob('*.md'))
rows = []
with tempfile.TemporaryDirectory(prefix='synapse-vault-eval-') as temporary:
    base = pathlib.Path(temporary).resolve()
    home = base / 'home'
    home.mkdir()
    workspace = base / 'workspace'
    workspace.mkdir()
    env = {**os.environ, 'HOME': str(home), 'NO_COLOR': '1'}
    env.pop('XDG_STATE_HOME', None)

    def run(name, command, question, expected='answered', facts=(), paths=(), options=(), root=None, forbidden_prefix=None):
        root = root or workspace
        started = time.monotonic()
        output = subprocess.run([binary, command, '--workspace', str(root), *options, question, '--json'],
                                env=env, capture_output=True, timeout=90)
        failures = []
        try:
            result = json.loads(output.stdout)
        except (ValueError, UnicodeDecodeError):
            result = {}
            failures.append('invalid-json')
        if output.returncode != 0: failures.append('exit')
        if result.get('version') != 1: failures.append('version')
        if result.get('status') != expected: failures.append('status')
        answer = result.get('answer') or ''
        for fact in facts:
            if fact.lower() not in answer.lower(): failures.append('missing-fact:' + fact)
        sources = result.get('sources', [])
        if expected == 'answered' and not sources: failures.append('no-sources')
        if expected == 'insufficient_evidence' and (sources or result.get('answer') is not None):
            failures.append('unsupported-content')
        for path in paths:
            if not any(s['path'] == path for s in sources): failures.append('missing-source:' + path)
        if forbidden_prefix and any(s['path'].startswith(forbidden_prefix) for s in sources):
            failures.append('excluded-path')
        for index, source in enumerate(sources, 1):
            path = pathlib.PurePosixPath(source['path'])
            if path.is_absolute() or '..' in path.parts:
                failures.append('unsafe-path')
                continue
            content = (root / path).read_text().splitlines()
            start, end = source['start_line'], source['end_line']
            if not 1 <= start <= end <= len(content): failures.append('coordinates')
            elif '\n'.join(content[start-1:end]) != source['text']:
                failures.append('source-bytes')
            if source['id'] != index: failures.append('source-id')
        if question.encode() in output.stderr: failures.append('diagnostic-question')
        if any(s.get('text', '').encode() in output.stderr for s in sources if s.get('text')):
            failures.append('diagnostic-source')
        rows.append({'case': name, 'command': command, 'passed': not failures,
                     'seconds': round(time.monotonic()-started, 3), 'status': result.get('status'),
                     'source_count': len(sources), 'result': result, 'failures': failures})
        print(name + ': ' + ('PASS' if not failures else 'FAIL ' + ', '.join(failures)), flush=True)

    for term in ('leakage', 'threshold', 'fermentation', 'navigation'):
        run('original-missing-metadata-' + term, 'search', term, 'insufficient_evidence', root=vault)
    for note in notes:
        target = workspace / note.relative_to(vault)
        target.parent.mkdir(parents=True, exist_ok=True)
        title = note.stem
        target.write_text('---\ndescription: ' + json.dumps('Test note about ' + title) +
                          '\ntags: [fixture]\naliases: []\n---\n' + note.read_text())
    prepared = snapshot(workspace)
    for term, path in [('leakage', 'Machine Learning/Data Leakage.md'),
                       ('threshold', 'Machine Learning/Logistic Regression.md'),
                       ('fermentation', 'Everyday/Bread and Fermentation.md'),
                       ('navigation', 'Everyday/Hiking Checklist.md')]:
        run('keyword-' + term, 'search', term, paths=[path])
    queries = re.findall(r'^\| ([^|]+) \|', (vault / 'Test Queries.md').read_text(), re.M)[2:]
    checks = [
        ('leakage', ['after the outcome'], ['Machine Learning/Data Leakage.md']),
        ('comparison', ['nonlinear', 'threshold'], []),
        ('metrics', ['0.75', '0.60'], ['Machine Learning/Classification Metrics.md']),
        ('time-split', ['chronological'], ['Machine Learning/Train Validation Test Split.md']),
        ('overfitting', ['Early stopping'], ['Machine Learning/Overfitting and Regularization.md']),
        ('hydration', ['350 g'], ['Everyday/Bread and Fermentation.md']),
        ('hiking', ['Water and snacks', 'Headlamp'], ['Everyday/Hiking Checklist.md']),
        ('indexes', ['storage', 'maintenance'], ['Software/Database Indexes.md']),
        ('unmeasured-accuracy', [], []), ('unsupported-marine-biology', [], []),
    ]
    assert len(queries) == len(checks), 'vault query table changed'
    for question, (name, facts, paths) in zip(queries, checks):
        run(name, 'ask', question, 'insufficient_evidence' if name.startswith(('unmeasured', 'unsupported')) else 'answered', facts, paths)
    run('excluded-everyday-search', 'search', 'fermentation', options=['--exclude-folder', 'Everyday'], forbidden_prefix='Everyday/')
    run('excluded-everyday-ask', 'ask', queries[5], 'insufficient_evidence', options=['--exclude-folder', 'Everyday'])
    run('excluded-tag-all', 'ask', queries[2], 'insufficient_evidence', options=['--exclude-tag', 'fixture'])
    assert snapshot(workspace) == prepared, 'temporary notes changed'
assert snapshot(vault) == original, 'source vault changed'
report = {'version': 1, 'binary_sha256': hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),
          'vault_markdown_files': len(notes), 'original_missing_metadata': sum(not n.read_text().startswith('---\n') for n in notes),
          'passed': sum(row['passed'] for row in rows), 'total': len(rows),
          'source_vault_unchanged': True, 'prepared_copy_unchanged': True, 'cases': rows,
          'limits': 'Local extractive Bonsai evaluation. Temporary copy adds metadata only. No original metadata repair or write approval. No remote requests.'}
report_path.write_text(json.dumps(report, indent=2) + '\n')
sys.exit(0 if report['passed'] == report['total'] else 1)
