#!/usr/bin/env python3
"""Remove known untracked generated legacy outputs; preserve source/dependencies/state."""
import pathlib
import shutil
import subprocess
root=pathlib.Path(__file__).resolve().parent.parent
outputs=[root/'dist',root/'main.js',root/'main.js.map']
for output in outputs:
 if not output.exists():continue
 if output.is_symlink():raise SystemExit('refusing symbolic legacy output')
 if subprocess.check_output(['git','ls-files','--',str(output.relative_to(root))],cwd=root):raise SystemExit('refusing tracked legacy output')
 paths=list(output.rglob('*')) if output.is_dir() else [output]
 if any(p.is_symlink() or (p.is_file() and p.suffix not in {'.js','.json','.css','.map'}) for p in paths):raise SystemExit('refusing unexpected legacy output content')
 if output.is_dir():shutil.rmtree(output)
 else:output.unlink()
print('Known untracked legacy compiled outputs removed; source, dependencies and state preserved')
