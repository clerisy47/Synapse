#!/usr/bin/env python3
"""Offline file/link snapshot checks using only temporary synthetic fixtures."""
import hashlib
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from vault_snapshot import snapshot


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name) / 'workspace'
        self.root.mkdir()
        self.note = self.root / 'note.md'
        self.note.write_bytes(b'original fixture\n')

    def test_file_add_remove_and_byte_change(self):
        before = snapshot(self.root)
        self.assertEqual(before, {'note.md': hashlib.sha256(self.note.read_bytes()).hexdigest()})
        extra = self.root / 'extra.md'
        extra.write_bytes(b'extra')
        self.assertNotEqual(before, snapshot(self.root))
        extra.unlink()
        self.assertEqual(before, snapshot(self.root))
        self.note.write_bytes(b'changed')
        self.assertNotEqual(before, snapshot(self.root))

    def test_link_add_remove_retarget_and_broken_target(self):
        before = snapshot(self.root)
        link = self.root / 'link.md'
        link.symlink_to('note.md')
        linked = snapshot(self.root)
        self.assertNotEqual(before, linked)
        self.assertEqual(linked['link.md'], 'symlink-sha256:' + hashlib.sha256(b'note.md').hexdigest())
        link.unlink()
        link.symlink_to('missing.md')
        self.assertNotEqual(linked, snapshot(self.root))
        self.assertTrue(snapshot(self.root)['link.md'].startswith('symlink-sha256:'))
        link.unlink()
        self.assertEqual(before, snapshot(self.root))

    def test_linked_directory_never_traversed_or_target_read(self):
        outside = pathlib.Path(self.temp.name) / 'outside'
        outside.mkdir()
        (outside / 'secret.md').write_bytes(b'OUTSIDE')
        (self.root / 'linked').symlink_to(outside, target_is_directory=True)
        original_read = pathlib.Path.read_bytes
        def read(path):
            self.assertEqual(path, self.note)
            return original_read(path)
        with patch.object(pathlib.Path, 'read_bytes', read):
            result = snapshot(self.root)
        self.assertEqual(set(result), {'note.md', 'linked'})
        self.assertNotIn(str(outside), str(result))

    def test_symlink_root_refused(self):
        alias = pathlib.Path(self.temp.name) / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError):
            snapshot(alias)

    def test_snapshot_preserves_all_original_entries(self):
        (self.root / 'broken').symlink_to('missing')
        before_bytes = self.note.read_bytes()
        before_link = (self.root / 'broken').readlink()
        first = snapshot(self.root)
        self.assertEqual(first, snapshot(self.root))
        self.assertEqual(self.note.read_bytes(), before_bytes)
        self.assertEqual((self.root / 'broken').readlink(), before_link)


if __name__ == '__main__':
    unittest.main()
