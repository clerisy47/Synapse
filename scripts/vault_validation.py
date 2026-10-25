"""Offline validation of untrusted CLI evaluation results."""
import pathlib


def validate_result(result, root, expected='answered', facts=(), paths=(),
                    forbidden_prefix=None, fact_sources=None, context_requirements=()):
    failures = []
    if not isinstance(result, dict):
        return ['result-shape']
    if type(result.get('version')) is not int or result.get('version') != 1:
        failures.append('version')
    if result.get('status') != expected:
        failures.append('status')
    answer = result.get('answer')
    if expected == 'answered' and (not isinstance(answer, str) or not answer.strip()):
        failures.append('empty-answer')
    if answer is not None and not isinstance(answer, str):
        failures.append('answer-shape')
    answer = answer if isinstance(answer, str) else ''
    for fact in facts:
        if fact.casefold() not in answer.casefold():
            failures.append('missing-fact:' + fact)
    sources = result.get('sources')
    if not isinstance(sources, list):
        return failures + ['sources-shape']
    if expected == 'answered' and all(isinstance(s, dict) and isinstance(s.get('text'), str) for s in sources):
        if answer != '\n\n'.join(s['text'] for s in sources):
            failures.append('answer-projection')
    if expected == 'answered' and not sources:
        failures.append('no-sources')
    if expected == 'insufficient_evidence' and (sources or result.get('answer') is not None):
        failures.append('unsupported-content')
    verified = {}
    root = pathlib.Path(root).resolve()
    for index, source in enumerate(sources, 1):
        if not isinstance(source, dict):
            failures.append('source-shape')
            continue
        name = source.get('path')
        if not isinstance(name, str) or not name or '\\' in name:
            failures.append('unsafe-path')
            continue
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or any(part in ('', '.', '..') for part in name.split('/')):
            failures.append('unsafe-path')
            continue
        if (forbidden_prefix and name.startswith(forbidden_prefix)) or path.name.casefold() in ('instructions.md', 'research.md') or path.suffix.casefold() != '.md' or any(part.startswith('.') for part in path.parts):
            failures.append('excluded-path')
            continue
        target = root
        unsafe = False
        for part in path.parts:
            target = target / part
            if target.is_symlink():
                unsafe = True
                break
        if unsafe:
            failures.append('unsafe-path')
            continue
        start, end = source.get('start_line'), source.get('end_line')
        if type(start) is not int or type(end) is not int:
            failures.append('coordinates')
            continue
        try:
            content = target.read_text(encoding='utf-8').splitlines()
        except (OSError, UnicodeError):
            failures.append('source-unreadable')
            continue
        if not 1 <= start <= end <= len(content):
            failures.append('coordinates')
            continue
        text = '\n'.join(content[start-1:end])
        if source.get('text') != text:
            failures.append('source-bytes')
            continue
        if type(source.get('id')) is not int or source.get('id') != index:
            failures.append('source-id')
        verified.setdefault(name, []).append(text)
    for name in paths:
        if name not in verified:
            failures.append('missing-source:' + name)
    for fact, names in (fact_sources or {}).items():
        if not any(fact.casefold() in text.casefold() for name in names for text in verified.get(name, [])):
            failures.append('unsupported-fact:' + fact)
    for requirement in context_requirements:
        for text in verified.get(requirement['path'], []):
            lower = text.casefold()
            if any(trigger.casefold() in lower for trigger in requirement['triggers']):
                if not all(context.casefold() in lower for context in requirement['required']):
                    failures.append('missing-context:' + requirement['name'])
    return failures
