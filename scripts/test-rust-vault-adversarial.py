#!/usr/bin/env python3
"""Opt-in live synthetic generalization checks derived from Synapse-Test-Vault gaps."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import re
import urllib.request
from vault_validation import validate_result
from vault_snapshot import snapshot
from qualification_provider import add_provider_arguments, provider_options, provider_metadata

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary'); parser.add_argument('report'); parser.add_argument('vault', nargs='?')
add_provider_arguments(parser); args = parser.parse_args(); options = provider_options(parser, args)
binary = pathlib.Path(args.binary).resolve()
report_path = pathlib.Path(args.report)
vault = pathlib.Path(args.vault).resolve() if args.vault else None
try:
    original = snapshot(vault) if vault else None
    original_readable = True
except OSError:
    original = None
    original_readable = False
try:
    binary_sha256 = hashlib.sha256(binary.read_bytes()).hexdigest()
except OSError:
    binary_sha256 = None
try:
    if args.provider != 'local':
        raise OSError('remote selected')
    with urllib.request.urlopen('http://127.0.0.1:18080/props', timeout=5) as response:
        props = json.load(response)
    if not isinstance(props, dict):
        raise ValueError('runtime shape')
    runtime_status = 'available'
except (OSError, ValueError):
    props = {}
    runtime_status = 'provider_unavailable'
runtime = {
    'status': runtime_status, 'endpoint': 'http://127.0.0.1:18080',
    'provider': 'user-managed PrismML llama.cpp',
    'context_reported': props.get('default_generation_settings', {}).get('n_ctx') if isinstance(props.get('default_generation_settings'), dict) else None,
    'slots_reported': props.get('total_slots'), 'thinking_requested': False,
    'runtime_build': props.get('build_info') if re.fullmatch(r'b[0-9]+-[0-9a-f]{7,40}', str(props.get('build_info', ''))) else 'unreported',
    'pq2_0_path_hint': 'pq2_0' in str(props.get('model_path', '')).lower(),
    'limits': 'Runtime self-report and model filename hint do not independently authenticate weights.',
}
if args.provider == 'openrouter':
    runtime = provider_metadata(args)
CASES = [
    ('linked-comparison', 'Compare logistic regression and random forests for churn.',
     '# Comparison\n[[Logistic regression]] uses a linear boundary and a configurable threshold.\n[[Random forests]] capture nonlinear interactions.\n',
     'answered', ['linear boundary', 'threshold', 'nonlinear interactions']),
    ('plain-comparison-positive', 'Compare logistic regression and random forests for churn.',
     '# Comparison\nLogistic regression uses a linear boundary and a configurable threshold.\nRandom forests capture nonlinear interactions.\n',
     'answered', ['linear boundary', 'threshold', 'nonlinear interactions']),
    ('discovery-only-comparison', 'Compare logistic regression and random forests for churn.',
     '# Comparison\nRelated: [[Logistic regression]] and [[Random forests]].\n',
     'insufficient_evidence', []),
    ('unmeasured-date', 'What was the churn experiment measured test accuracy?',
     '# Churn experiment\nThe churn experiment has never measured test accuracy as of 2026.\n',
     'insufficient_evidence', []),
    ('measured-positive', 'What was the churn experiment measured test accuracy?',
     '# Churn experiment\nThe churn experiment measured test accuracy was 0.83 on its held-out test partition.\n',
     'answered', ['0.83']),
    ('unmeasured-unrelated-value', 'What was the churn experiment measured test accuracy?',
     '# Churn experiment\nThe churn experiment has never measured test accuracy as of 2026.\nAn unrelated weather experiment measured test accuracy of 0.91.\n',
     'insufficient_evidence', []),
    ('table-measured-positive', 'What was the churn experiment measured test accuracy?',
     '# Churn experiment\nThe measured held-out results are:\n| Metric | Value |\n| --- | --- |\n| Churn experiment test accuracy | 0.83 |\n',
     'answered', ['0.83']),
    ('per-cent-positive', 'What was the churn experiment measured test accuracy?',
     '# Churn experiment\nThe churn experiment measured test accuracy was 83 per cent on its held-out test partition.\n',
     'answered', ['83 per cent']),
    ('planned-value-negative', 'What was the churn experiment measured test accuracy?',
     '# Churn experiment\nThe churn experiment planned test accuracy is 0.91; no evaluation has taken place.\n',
     'insufficient_evidence', []),
    ('cross-clause-unrelated-negative', 'What was the churn experiment measured test accuracy?',
     '# Churn experiment\nThe weather experiment measured test accuracy was 0.91; the churn experiment used 200 accounts.\n',
     'insufficient_evidence', []),
    ('bookmarked-comparison-negative', 'Compare logistic regression and random forests for churn.',
     '# Comparison\nI bookmarked [[Logistic regression]] and [[Random forests]] for later reading.\n',
     'insufficient_evidence', []),
]
rows = []
with tempfile.TemporaryDirectory(prefix='synapse-adversarial-') as temp:
    base = pathlib.Path(temp).resolve()
    for name, question, body, expected, facts in CASES:
        workspace = base / name
        workspace.mkdir()
        home = base / (name + '-home')
        home.mkdir()
        note = workspace / 'Evidence.md'
        raw = '---\ndescription: Synthetic factual evidence fixture\ntags: [fixture]\naliases: []\n---\n' + body
        note.write_text(raw)
        before = hashlib.sha256(note.read_bytes()).hexdigest()
        env = {**os.environ, 'HOME': str(home), 'NO_COLOR': '1'}
        env.pop('XDG_STATE_HOME', None)
        started = time.monotonic()
        failures = []
        result = {}
        output = None
        try:
            output = subprocess.run([str(binary), 'ask', '--workspace', str(workspace), question, '--json', '--stats', *options],
                                    capture_output=True, env=env, timeout=260)
            result = json.loads(output.stdout)
            if output.returncode: failures.append('exit')
            failures.extend(validate_result(result, workspace, expected, facts,
                ['Evidence.md'] if expected == 'answered' else [],
                fact_sources={fact: ['Evidence.md'] for fact in facts}))
            if question.encode() in output.stderr or body.encode() in output.stderr:
                failures.append('diagnostic-content')
            if isinstance(result, dict) and isinstance(result.get('sources'), list):
                for source in result['sources']:
                    if isinstance(source, dict) and isinstance(source.get('text'), str) and source['text'] and source['text'].encode() in output.stderr:
                        failures.append('diagnostic-source')
        except (ValueError, UnicodeDecodeError, OSError, subprocess.TimeoutExpired) as error:
            failures.append('timeout' if isinstance(error, subprocess.TimeoutExpired) else 'process-error' if isinstance(error, OSError) else 'invalid-response')
        try:
            if hashlib.sha256(note.read_bytes()).hexdigest() != before: failures.append('mutated')
        except OSError:
            failures.append('note-unreadable-after-run')
        usage_match = re.search(rb'Query stats: calls=(\d+) prompt_tokens=(\d+) candidates=(\d+) served=(\d+) final=(\d+) elapsed_ms=(\d+) completion_tokens=(\d+)', output.stderr) if output is not None else None
        usage = dict(zip(('calls','prompt_tokens','candidate_ranges','served_ranges','final_ranges','elapsed_ms','completion_tokens'),map(int,usage_match.groups()))) if usage_match else None
        rows.append({'case': name, 'question': question, 'expected': expected, 'passed': not failures,
                     'seconds': round(time.monotonic()-started, 3), 'failures': failures, 'result': result, 'usage':usage})
        print(name + ': ' + ('PASS' if not failures else 'FAIL ' + ', '.join(failures)), flush=True)
try:
    unchanged = original_readable and snapshot(vault) == original if vault else None
except OSError:
    unchanged = False
report = {'source_vault_unchanged': unchanged, 'original_sha256': original, 'version': 1, 'binary_sha256': binary_sha256,
          'runtime': runtime, 'passed': sum(row['passed'] for row in rows), 'total': len(rows), 'cases': rows,
          'limits': 'Live local synthetic generalization checks; original vault untouched; no repair/write approval or remote selection.'}
report_path.write_text(json.dumps(report, indent=2) + '\n')
sys.exit(0 if report['passed'] == report['total'] and unchanged is not False else 1)
