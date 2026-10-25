#!/usr/bin/env python3
"""Provider/consent controls without model or network requests."""
import argparse
import contextlib
import io
import os
import unittest
from unittest.mock import patch
from qualification_provider import add_provider_arguments, provider_options, provider_metadata

class ProviderTests(unittest.TestCase):
    def parse(self, flags):
        parser = argparse.ArgumentParser()
        add_provider_arguments(parser)
        args = parser.parse_args(flags)
        return provider_options(parser, args), provider_metadata(args)

    def test_local_needs_no_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            options, metadata = self.parse([])
        self.assertEqual(options, [])
        self.assertEqual(metadata['provider'], 'local')

    def test_remote_needs_both_consent_and_credentials(self):
        for flags, environment in [(['--provider', 'openrouter'], {'OPENROUTER_API_KEY': 'synthetic'}),
                                   (['--provider', 'openrouter', '--remote-consent'], {})]:
            with self.subTest(flags=flags), patch.dict(os.environ, environment, clear=True), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.parse(flags)

    def test_explicit_remote_is_propagated_without_secret(self):
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'synthetic'}, clear=True):
            options, metadata = self.parse(['--provider', 'openrouter', '--remote-consent'])
        self.assertIn('deepseek/deepseek-v4.1-flash', options)
        self.assertTrue(metadata['remote_consent'])
        self.assertNotIn('synthetic', repr((options, metadata)))

    def test_local_rejects_remote_model(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.parse(['--model', 'remote-model'])

if __name__ == '__main__':
    unittest.main()
