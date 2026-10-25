#!/usr/bin/env python3
"""Summarize saved qualification measurements without changing any scores."""
import argparse
import json
import math
import pathlib


def percentile(values, fraction):
    values = sorted(values)
    return values[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def summarize(rows):
    unsupported = [r for r in rows if r['expected'] == 'insufficient_evidence']
    supported = [r for r in rows if r['expected'] == 'answered']
    usage = [r['usage'] for r in rows if r.get('usage')]
    return {
        'questions': len(rows),
        'semantic_failures': sum(not r['passed'] for r in rows),
        'false_abstentions': sum(r['status'] == 'insufficient_evidence' for r in supported),
        'unsupported_answered': sum(r['status'] == 'answered' for r in unsupported),
        'unsupported_questions': len(unsupported),
        'unsupported_answered_rate': (
            sum(r['status'] == 'answered' for r in unsupported) / len(unsupported)
            if unsupported else None),
        'errors': sum(r['status'] not in ('answered', 'insufficient_evidence') for r in rows),
        'calls_max': max((r['calls'] for r in usage), default=None),
        'prompt_tokens_recorded': sum(r['prompt_tokens'] for r in usage),
        'completion_tokens_recorded': sum(r.get('completion_tokens') or 0 for r in usage),
        'latency_p50_seconds': percentile([r['seconds'] for r in rows], .5),
        'latency_p95_seconds': percentile([r['seconds'] for r in rows], .95),
        'latency_max_seconds': max((r['seconds'] for r in rows), default=None),
        'usage_limit': 'Failed or interrupted operations can have unknown token usage.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    cycles = json.loads((args.directory / 'cycles.json').read_text())
    fixture = pathlib.Path(__file__).resolve().parent.parent / 'tests/fixtures/evidence-holdouts-v1.json'
    expected_holdouts = {c['id']: c['expected'] for c in json.loads(fixture.read_text())['cases']}
    result = {'version': 1, 'binary_sha256': cycles['binary_sha256'], 'cycles': []}
    for cycle in cycles['cycles']:
        number = cycle['cycle']
        prefix = args.directory / f'cycle-{number}'
        semantic = json.loads(pathlib.Path(str(prefix) + '-semantic.json').read_text())['cases']
        passed = {c['case']: c['passed'] for c in semantic}
        rows = []
        groups = [('vault', None), ('holdouts', expected_holdouts), ('adversarial', None)]
        for group, expected in groups:
            report = json.loads(pathlib.Path(str(prefix) + f'-{group}.json').read_text())
            for case in report['cases']:
                name = case.get('case', case.get('id'))
                if group == 'vault' and (case['command'] != 'ask' or name.startswith('excluded-')):
                    continue
                target = (expected[name] if expected else case.get('expected',
                    'insufficient_evidence' if name.startswith(('unsupported-', 'unmeasured-')) else 'answered'))
                answer = case.get('result') or {}
                rows.append({'expected': target, 'status': answer.get('status'),
                    'passed': passed.get(name, case['passed']) if group == 'vault' else case['passed'], 'seconds': case['seconds'],
                    'usage': case.get('usage')})
        explicit = next(c for c in semantic if c['case'] == 'compass-explicit-multipart')
        rows.append({'expected': 'answered', 'status': (explicit.get('result') or {}).get('status'),
            'passed': explicit['passed'], 'seconds': explicit.get('seconds', 0),
            'usage': explicit.get('usage')})
        result['cycles'].append({'cycle': number, **summarize(rows)})
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
