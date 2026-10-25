"""Additive semantic-v2 fixture rubric; never rewrites legacy scores or reports.

Facts are source-bound fixture anchors, not a general semantic entailment judge.
The caller supplies forbidden identities derived from the actual access policy.
"""
from vault_validation import validate_result

VERSION = 'semantic-v2'


def assess(result, root, *, required=(), illustrative=(), forbidden_paths=(),
           allow_abstention=False, expected='answered'):
    """Return independent dimensions after authenticating the source projection.

    required/illustrative contain (fact, permitted source identities) pairs.
    An optional illustration never changes correctness. An alternative source
    needs its own explicit source-bound anchors; arbitrary nonexcluded text is
    not accepted merely because the status is answered.
    """
    abstained = isinstance(result, dict) and result.get('status') == 'insufficient_evidence'
    target = 'insufficient_evidence' if allow_abstention and abstained else expected
    authenticity = validate_result(result, root, target)
    sources = result.get('sources', []) if isinstance(result, dict) else []
    if not isinstance(sources, list):
        sources = []
    paths = {s.get('path') for s in sources
             if isinstance(s, dict) and isinstance(s.get('path'), str)}
    excluded = sorted(paths.intersection(forbidden_paths))

    def covered(requirement):
        fact, identities = requirement
        return not authenticity and any(
            isinstance(s, dict) and s.get('path') in identities
            and isinstance(s.get('text'), str) and fact.casefold() in s['text'].casefold()
            for s in sources)

    missing = [] if target == 'insufficient_evidence' else [
        fact for fact, identities in required if not covered((fact, identities))]
    optional_missing = [fact for fact, identities in illustrative
                        if not covered((fact, identities))]
    supported_paths = {identity for _, identities in (*required, *illustrative)
                       for identity in identities}
    unrelated = sorted(paths - supported_paths) if target == 'answered' else []
    # No declared support rubric must not yield a vacuous answered pass.
    correctness = not authenticity and not missing and (
        target == 'insufficient_evidence' or bool(required))
    return {'rubric_version': VERSION, 'correctness': correctness,
            'exclusion': not excluded, 'minimality': not unrelated,
            'authenticity_failures': authenticity, 'missing_required': missing,
            'missing_illustrative': optional_missing,
            'forbidden_sources': excluded, 'unrelated_sources': unrelated}
