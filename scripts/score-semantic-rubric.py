#!/usr/bin/env python3
"""Score source-bound synthetic rubrics into a NEW report, preserving legacy data.

Usage: score-semantic-rubric.py LEGACY_JSON VAULT RUBRIC_JSON NEW_REPORT
Rubric: {"version":"semantic-v2", "cases": {case_name: assess_keyword_args}}.
Only use a matching, immutable vault snapshot; no runtime or network is used.
"""
import argparse
import hashlib
import json
import pathlib
from semantic_rubric import VERSION, assess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ('legacy', 'vault', 'rubric', 'output'):
        parser.add_argument(argument, type=pathlib.Path)
    args = parser.parse_args()
    raw = args.legacy.read_bytes()
    rubric_raw = args.rubric.read_bytes()
    legacy = json.loads(raw)
    rubric = json.loads(rubric_raw)
    if rubric.get('version') != VERSION or not isinstance(rubric.get('cases'), dict):
        parser.error('unsupported rubric')
    rows = []
    for name, requirements in rubric['cases'].items():
        matches = [row for row in legacy['cases'] if row.get('case') == name]
        if len(matches) != 1:
            rows.append({'case': name, 'failure': 'missing-or-duplicate-case'})
            continue
        row = matches[0]
        rows.append({'case': name, 'legacy_passed': row.get('passed'),
                     'semantic': assess(row.get('result'), args.vault, **requirements)})
    report = {'version': 1, 'rubric_version': VERSION,
              'legacy_sha256': hashlib.sha256(raw).hexdigest(),
              'rubric_sha256': hashlib.sha256(rubric_raw).hexdigest(),
              'legacy_passed': legacy.get('passed'), 'legacy_total': legacy.get('total'),
              'cases': rows,
              'limits': 'Source-bound fixture anchors, not general entailment. Original report unchanged. No live requests.'}
    # Exclusive creation also prevents accidental rewriting of either input.
    with args.output.open('x', encoding='utf-8') as output:
        output.write(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
