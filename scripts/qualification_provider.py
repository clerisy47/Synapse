"""Explicit provider selection shared by opt-in qualification runners."""
import os

def add_provider_arguments(parser):
    parser.add_argument('--provider', choices=('local', 'openrouter'), default='local')
    parser.add_argument('--model')
    parser.add_argument('--remote-consent', action='store_true',
                        help='Send permitted test questions/passages to OpenRouter and its routed provider')

def provider_options(parser, args):
    if args.provider == 'local':
        if args.model or args.remote_consent:
            parser.error('--model and --remote-consent require --provider openrouter')
        return []
    if not args.remote_consent:
        parser.error('OpenRouter requires --remote-consent')
    if not os.environ.get('OPENROUTER_API_KEY'):
        parser.error('OPENROUTER_API_KEY is required')
    return ['--provider', 'openrouter', '--model',
            args.model or 'deepseek/deepseek-v4.1-flash', '--remote-consent']

def provider_metadata(args):
    return {'provider': args.provider,
            'model': (args.model or 'deepseek/deepseek-v4.1-flash') if args.provider == 'openrouter' else 'Bonsai 2 9B PQ2_0',
            'remote_consent': args.remote_consent,
            'max_model_calls': 32, 'context_ceiling': 32768 if args.provider == 'openrouter' else 4096,
            'completion_tokens_per_call': 2048 if args.provider == 'openrouter' else 512, 'workflow_seconds': 240, 'reasoning_enabled': args.provider == 'openrouter',
            'reasoning_effort': 'low' if args.provider == 'openrouter' and (args.model or 'deepseek/deepseek-v4.1-flash') == 'deepseek/deepseek-v4.1-flash' else None,
            'route': 'DeepInfra' if args.provider == 'openrouter' and (args.model or 'deepseek/deepseek-v4.1-flash') == 'deepseek/deepseek-v4.1-flash' else None}
