"""Hash regular files and symlink entries without traversing symlinks.

Directory metadata and empty directories are outside snapshot scope. Regular file
values retain their historical SHA-256 format; link values hash link text only.
"""
import hashlib
import os
import pathlib
import stat


def snapshot(root):
    root = pathlib.Path(root)
    if not stat.S_ISDIR(root.lstat().st_mode):
        raise OSError('snapshot root must be a real directory')
    result = {}

    def visit(directory):
        for entry in sorted(directory.iterdir(), key=lambda path: path.name):
            mode = entry.lstat().st_mode
            name = entry.relative_to(root).as_posix()
            if stat.S_ISLNK(mode):
                target = os.fsencode(os.readlink(entry))
                result[name] = 'symlink-sha256:' + hashlib.sha256(target).hexdigest()
            elif stat.S_ISDIR(mode):
                visit(entry)
            elif stat.S_ISREG(mode):
                result[name] = hashlib.sha256(entry.read_bytes()).hexdigest()

    visit(root)
    return result
