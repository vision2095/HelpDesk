#!/usr/bin/env python3
"""Compile the actual Windows AutoTypeWorker with deterministic Win32 stubs.

Run from the repository root: python3 tests/windows/test_autotype_worker.py
Optionally pass --compiler /path/to/c++, clang++, g++, or cl. This is a host-side
behavior test, not a Windows build or a test of physical input or SendInput.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
START = "void InputManager::AutoTypeWorker("
END = "\nstatic HHOOK s_globalMouseHook"
MARKER = "// PRODUCTION_WORKER_INSERTION_POINT"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", help="C++20 compiler executable")
    args = parser.parse_args()
    compiler = args.compiler or next(
        (path for name in ("c++", "clang++", "g++", "cl") if (path := shutil.which(name))),
        None,
    )
    if not compiler:
        parser.error("A C++20 compiler is required; pass its path with --compiler")
    template = (ROOT / "tests/windows/autotype_worker_harness.cpp").read_text(encoding="utf-8")
    if template.count(MARKER) != 1:
        raise ValueError("Expected exactly one worker insertion marker")
    with tempfile.TemporaryDirectory(prefix="lensdesk-autotype-test-") as temp:
        temporary = Path(temp)
        for index, source in enumerate((
            ROOT / "src-native/src/input_manager.cpp",
            ROOT / "apps/windows/src-native/src/input_manager.cpp",
        )):
            contents = source.read_text(encoding="utf-8")
            if contents.count(START) != 1 or contents.count(END) != 1:
                raise ValueError(f"Could not uniquely locate the production worker in {source}")
            worker = contents[contents.index(START):contents.index(END)]
            harness = temporary / f"harness_{index}.cpp"
            executable = temporary / f"harness_{index}.exe"
            harness.write_text(template.replace(MARKER, worker), encoding="utf-8")
            if Path(compiler).name.lower() in ("cl", "cl.exe"):
                command = [compiler, "/nologo", "/std:c++20", "/EHsc", str(harness), f"/Fe:{executable}"]
            else:
                command = [compiler, "-std=c++20", "-pthread", str(harness), "-o", str(executable)]
            subprocess.run(command, check=True, cwd=temporary)
            subprocess.run([str(executable)], check=True, cwd=temporary, timeout=20)
            print(f"Passed stubbed worker behavior tests: {source.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
