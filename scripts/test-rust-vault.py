#!/usr/bin/env python3
"""Opt-in read-only provider evaluation of Synapse-Test-Vault; never edits its source."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from vault_validation import validate_result
from vault_snapshot import snapshot

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary')
parser.add_argument('vault')
parser.add_argument('report')
parser.add_argument('--provider', choices=['local', 'openrouter'], default='local')
parser.add_argument('--model')
parser.add_argument('--remote-consent', action='store_true',
                    help='Consent to sending permitted passages/questions to OpenRouter and its routed provider')
args = parser.parse_args()
if args.provider == 'openrouter' and not args.remote_consent:
    parser.error('OpenRouter requires --remote-consent')
if args.model and args.provider != 'openrouter':
    parser.error('--model requires --provider openrouter')
binary = str(pathlib.Path(args.binary).resolve())
vault = pathlib.Path(args.vault).resolve()
report_path = pathlib.Path(args.report)
provider_options = []
if args.provider == 'openrouter':
    model = args.model or 'deepseek/deepseek-v4.1-flash'
    provider_options = ['--provider', 'openrouter', '--model', model, '--remote-consent']
    runtime = {'provider': 'OpenRouter', 'model': model, 'remote_consent': True,
               'route': 'DeepInfra' if model == 'deepseek/deepseek-v4.1-flash' else None,
               'reasoning_enabled': True, 'reasoning_effort': 'low' if model == 'deepseek/deepseek-v4.1-flash' else None, 'completion_tokens_per_call': 2048, 'max_model_calls': 32,
               'limits': 'Requested model ID; routed provider/weights not independently authenticated.'}
else:
    try:
        with urllib.request.urlopen('http://127.0.0.1:18080/props', timeout=5) as response:
            props = json.load(response)
        if not isinstance(props, dict):
            raise ValueError
        runtime_status = 'available'
    except (OSError, ValueError, urllib.error.URLError):
        props = {}
        runtime_status = 'provider_unavailable'
    runtime = {
        'status': runtime_status,
        'endpoint': 'http://127.0.0.1:18080',
        'provider': 'user-managed PrismML llama.cpp',
        'context_reported': props.get('default_generation_settings', {}).get('n_ctx'),
        'slots_reported': props.get('total_slots'),
        'thinking_requested': False,
        'runtime_build': props.get('build_info') if re.fullmatch(r'b[0-9]+-[0-9a-f]{7,40}', str(props.get('build_info', ''))) else 'unreported',
        'pq2_0_path_hint': 'pq2_0' in str(props.get('model_path', '')).lower(),
        'limits': 'Runtime self-report and model filename hint do not independently authenticate weights.',
    }
original = snapshot(vault)
notes = sorted(vault.rglob('*.md'))
baseline_note_text = {}
baseline_read_failed = False
for note in notes:
    try:
        baseline_note_text[note] = note.read_text(encoding='utf-8')
    except (OSError, UnicodeError):
        baseline_read_failed = True
original_missing_metadata = sum(not text.startswith('---\n') for text in baseline_note_text.values())
rows = []
EXPECTED_QUERIES = [
    'Why is cancellation_reason excluded from the churn model?',
    'Compare logistic regression and random forests for churn.',
    'What are precision and recall in the synthetic example?',
    'How should I split time-dependent account data?',
    'What can I try when training loss improves but validation loss worsens?',
    'How much water gives 70 percent hydration with 500 g flour?',
    'What should I pack for a day hike?',
    'What tradeoffs do database indexes introduce?',
    "What was the churn experiment's measured test accuracy?",
    'What do my notes say about marine biology?',
]
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
        failures = []
        try:
            output = subprocess.run([binary, command, '--workspace', str(root), *options, *provider_options, question, '--json', *(['--stats'] if command == 'ask' else [])],
                                    env=env, capture_output=True, timeout=260)
        except subprocess.TimeoutExpired as error:
            output = subprocess.CompletedProcess([], -1, error.stdout or b'', error.stderr or b'')
            failures.append('timeout')
        try:
            result = json.loads(output.stdout)
        except (ValueError, UnicodeDecodeError):
            result = {}
            failures.append('invalid-json')
        if output.returncode != 0:
            failures.append('exit')
        fact_sources = {fact: list(paths) for fact in facts}
        if name == 'comparison':
            fact_sources = {'nonlinear': ['Machine Learning/Random Forests.md'],
                            'threshold': ['Machine Learning/Logistic Regression.md']}
        context_requirements = []
        if name == 'overfitting':
            # Explicit fixture rubric: leakage examples are anti-patterns, not remedies.
            # Each displayed example passage must retain its own controlling context.
            context_requirements = [{
                'name': 'leakage-examples',
                'path': 'Machine Learning/Data Leakage.md',
                'triggers': ['Scaling all rows before splitting the dataset.',
                             'Including a cancellation timestamp when predicting future churn.',
                             'Putting near-duplicate records in both training and test sets.',
                             'Repeatedly tuning against final test results.'],
                'required': ['# Data Leakage',
                    'Data leakage occurs when training or evaluation uses information unavailable at the real prediction time, or when evaluation data influences model selection improperly.'],
            }]
        failures.extend(validate_result(result, root, expected, facts, paths,
                                        forbidden_prefix, fact_sources, context_requirements))
        if not isinstance(result, dict):
            result = {}
        sources = result.get('sources')
        sources = sources if isinstance(sources, list) else []
        if question.encode() in output.stderr: failures.append('diagnostic-question')
        if any(source.get('text', '').encode() in output.stderr
               for source in sources if isinstance(source, dict)
               and isinstance(source.get('text'), str) and source['text']):
            failures.append('diagnostic-source')
        match = re.search(rb'Query stats: calls=(\d+) prompt_tokens=(\d+) candidates=(\d+) served=(\d+) final=(\d+) elapsed_ms=(\d+)', output.stderr)
        usage = dict(zip(('calls','prompt_tokens','candidate_ranges','served_ranges','final_ranges','elapsed_ms'), map(int, match.groups()))) if match else None
        if usage is not None:
            completion = re.search(rb'completion_tokens=(\d+)', output.stderr)
            usage['completion_tokens'] = int(completion[1]) if completion else None
        if usage is not None:
            usage['prompt_tokens_known'] = output.returncode == 0
        rows.append({'case': name, 'command': command, 'question': question, 'passed': not failures,
                     'seconds': round(time.monotonic()-started, 3), 'status': result.get('status'),
                     'source_count': len(sources), 'result': result, 'failures': failures, 'usage': usage})
        report_path.with_suffix('.partial.json').write_text(json.dumps({'version':1,'complete':False,'cases':rows},indent=2)+'\n',encoding='utf-8')
        print(name + ': ' + ('PASS' if not failures else 'FAIL ' + ', '.join(failures)), flush=True)

    prepared = snapshot(workspace)
    try:
        if baseline_read_failed:
            raise ValueError('baseline-read')
        # Isolate legacy notes: the expanded vault also contains eligible notes.
        missing_workspace = base / 'missing-metadata'
        missing_workspace.mkdir()
        for note, text in baseline_note_text.items():
            if not text.startswith('---\n'):
                target = missing_workspace / note.relative_to(vault)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text, encoding='utf-8')
        for term in (('leakage', 'threshold', 'fermentation', 'navigation') if original_missing_metadata else ()):
            run('original-missing-metadata-' + term, 'search', term, 'insufficient_evidence',
                root=vault if original_missing_metadata == len(notes) else missing_workspace)
        for note in notes:
            target = workspace / note.relative_to(vault)
            target.parent.mkdir(parents=True, exist_ok=True)
            title = note.stem
            text = baseline_note_text[note]
            target.write_text(text if text.startswith('---\n') else
                              '---\ndescription: ' + json.dumps('Test note about ' + title) +
                              '\ntags: [fixture]\naliases: []\n---\n' + text, encoding='utf-8')
        prepared = snapshot(workspace)
        for term, path in [('leakage', 'Machine Learning/Data Leakage.md'),
                           ('threshold', 'Machine Learning/Logistic Regression.md'),
                           ('fermentation', 'Everyday/Bread and Fermentation.md'),
                           ('navigation', 'Everyday/Hiking Checklist.md')]:
            run('keyword-' + term, 'search', term, paths=[path])
        queries = re.findall(r'^\| ([^|]+) \|', baseline_note_text[vault / 'Test Queries.md'], re.M)[2:]
        checks = [
            ('leakage', ['after the outcome'], ['Machine Learning/Data Leakage.md']),
            ('comparison', ['nonlinear', 'threshold'], ['Machine Learning/Logistic Regression.md', 'Machine Learning/Random Forests.md']),
            ('metrics', ['0.75', '0.60'], ['Machine Learning/Classification Metrics.md']),
            ('time-split', ['chronological'], ['Machine Learning/Train Validation Test Split.md']),
            ('overfitting', ['L2 regularization', 'L1 regularization', 'Early stopping', 'Restricting tree depth'], ['Machine Learning/Overfitting and Regularization.md']),
            ('hydration', ['350 g'], ['Everyday/Bread and Fermentation.md']),
            ('hiking', ['Water and snacks', 'Weather-appropriate layers', 'Offline map and charged phone', 'First-aid kit', 'Sun protection', 'Headlamp'], ['Everyday/Hiking Checklist.md']),
            ('indexes', ['storage', 'maintenance'], ['Software/Database Indexes.md']),
            ('unmeasured-accuracy', [], []), ('unsupported-marine-biology', [], []),
        ]
        assert queries == EXPECTED_QUERIES, 'documented vault prompts changed'
        assert len(queries) == len(checks), 'vault query table changed'
        for question, (name, facts, paths) in zip(queries, checks):
            run(name, 'ask', question, 'insufficient_evidence' if name.startswith(('unmeasured', 'unsupported')) else 'answered', facts, paths)
        run('excluded-everyday-search', 'search', 'fermentation', options=['--exclude-folder', 'Everyday'], forbidden_prefix='Everyday/')
        run('excluded-everyday-ask', 'ask', queries[5], 'insufficient_evidence', options=['--exclude-folder', 'Everyday'])
        metrics_text = baseline_note_text[vault / 'Machine Learning/Classification Metrics.md']
        # Preserve existing tags and exclude a real source tag, not a presumed
        # preparation tag. Legacy metadata-free fixtures receive 'fixture'.
        tags_line = re.search(r'^tags: \[([^\]]+)\]', metrics_text, re.M)
        metrics_tag = tags_line.group(1).split(',')[0].strip().strip('\"\'') if tags_line else 'fixture'
        run('excluded-metrics-tag', 'ask', queries[2], 'insufficient_evidence', options=['--exclude-tag', metrics_tag])
        guide = vault / 'Expanded Collection Guide.md'
        if guide in baseline_note_text:
            expanded_queries = re.findall(r'^\| ([^|]+) \|', baseline_note_text[guide], re.M)[2:]
            expanded_checks = [
                ('cedar-dedup', ['112'], ['Data Engineering/Cedar Duplicate Events.md']),
                ('cedar-boundary', ['exactly 2 percent', 'warning'], ['Data Engineering/Cedar Quality Checks.md']),
                ('juniper-retries', ['three total attempts', '2 seconds', '8 seconds'], ['Systems/Juniper Retry Budget.md']),
                ('lantern-comparison', ['75 percent', '80 percent'], ['Search Lab/Lantern Precision Trial.md', 'Search Lab/Lantern Recall Trial.md']),
                ('unsupported-lantern-battery', [], []),
                ('maple-completion', ['8', '10'], ['Product Research/Maple Completion Trial.md']),
                ('harbor-mitigation', ['24 minutes', '20 to 4'], ['Operations/Harbor Incident Timeline.md', 'Operations/Harbor Mitigation.md']),
                ('ridge-budget', ['30'], ['Field Journal/Ridge Budget Worksheet.md']),
                ('orchard-comparison', ['20 degrees', 'six hours', '24 degrees', 'four hours', 'cannot isolate either effect'], ['Kitchen Lab/Orchard Trial A.md', 'Kitchen Lab/Orchard Trial B.md']),
                ('compass-completion', ['75 percent', 'does not measure correctness'], ['Learning Notes/Compass Worked Example.md']),
                ('quartz-ties', ['record ID'], ['Software Design/Quartz Stable Sorting.md']),
                ('atlas-inventory', ['48', '20 hand', '16 garden', '12 measuring'], ['Project Atlas/Atlas Inventory Fixture.md']),
                ('unsupported-atlas-results', [], []),
            ]
            assert len(expanded_queries) == len(expanded_checks), 'expanded query table changed'
            for question, (name, facts, paths) in zip(expanded_queries, expanded_checks):
                run(name, 'ask', question, 'insufficient_evidence' if name.startswith('unsupported-') else 'answered', facts, paths, root=vault)
    except Exception:
        rows.append({'case': 'harness-error', 'command': None, 'passed': False,
                     'seconds': 0, 'status': None, 'source_count': 0,
                     'result': {}, 'failures': ['harness-error']})
    finally:
        try:
            prepared_unchanged = snapshot(workspace) == prepared
        except OSError:
            prepared_unchanged = False

try:
    source_unchanged = snapshot(vault) == original
except OSError:
    source_unchanged = False
report = {'version': 1, 'binary_sha256': hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),
          'documented_prompts': EXPECTED_QUERIES, 'prompts_sha256': hashlib.sha256('\n'.join(EXPECTED_QUERIES).encode()).hexdigest(),
          'runtime': runtime, 'original_sha256': original, 'prepared_sha256': prepared,
          'vault_markdown_files': len(notes), 'original_missing_metadata': original_missing_metadata,
          'passed': sum(row['passed'] for row in rows), 'total': len(rows),
          'source_vault_unchanged': source_unchanged, 'prepared_copy_unchanged': prepared_unchanged, 'cases': rows,
          'limits': ('Extractive provider evaluation. Temporary copy adds metadata only. No original metadata repair or write approval. ' + ('Explicitly consented OpenRouter requests.' if args.provider == 'openrouter' else 'No remote requests.'))}
report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
sys.exit(0 if report['passed'] == report['total'] and source_unchanged and prepared_unchanged else 1)
