"""Build and seal a local frontend review artifact. Does not deploy or edit application source."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import subprocess
import stat
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STAMP = (2026, 1, 1, 0, 0, 0)
TEMPLATES = {f"site/templates/{name}{suffix}.csv" for name in ["department-members", "leave-records", "unitwise-assignments"] for suffix in ["", "-example"]}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def reject_reparse_tree(directory: Path) -> None:
    def check(path: Path) -> None:
        attributes = path.lstat()
        if stat.S_ISLNK(attributes.st_mode) or getattr(attributes, "st_file_attributes", 0) & 0x400:
            raise ValueError(f"Symbolic link or reparse point is outside the review contract: {path}")
    check(directory)
    for parent, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs + files:
            check(Path(parent) / name)


def allowed_entry(name: str) -> bool:
    return name in {"site/index.html", "site/frontend-bootstrap.js", "REVIEW.txt", "review-manifest.json"} | TEMPLATES or bool(re.fullmatch(r"site/assets/(?:index|recycle-bin|member-duplicates|rota-intelligence|compute-worker)-[A-Za-z0-9_-]+\.(?:js|css)", name))


def snapshot() -> dict[str, str]:
    frontend = ROOT / "frontend"
    reject_reparse_tree(frontend / "src")
    reject_reparse_tree(frontend / "public")
    paths = list((frontend / "src").rglob("*")) + list((frontend / "public").rglob("*"))
    paths += [frontend / name for name in ["index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json"]]
    result = {}
    for path in sorted(paths):
        if path.is_symlink():
            raise ValueError(f"Symbolic link is outside the review packaging contract: {path}")
        if path.is_file():
            result[path.relative_to(ROOT).as_posix()] = digest(path.read_bytes())
    return result


def check_build_assets(entries: dict[str, bytes]) -> None:
    html = entries.get("site/index.html", b"").decode("utf-8")
    for reference in re.findall(r'''(?:src|href)=["']([^"']+)["']''', html):
        if reference.startswith(("/assets/", "/frontend-bootstrap.js")):
            target = "site/" + reference.lstrip("/").split("?")[0]
            if target not in entries:
                raise ValueError(f"Build references a missing asset: {target}")
    for name, data in entries.items():
        if not name.endswith((".js", ".css")):
            continue
        for reference in re.findall(r'''["']((?:/assets/|assets/|\./)?(?:index|recycle-bin|member-duplicates|rota-intelligence|compute-worker)-[A-Za-z0-9_-]+\.(?:js|css))["']''', data.decode("utf-8")):
            target = "site/assets/" + reference.rsplit("/", 1)[-1]
            if target not in entries:
                raise ValueError(f"Build references a missing chunk: {target}")
    if not any(name.startswith("site/assets/compute-worker-") and name.endswith(".js") for name in entries):
        raise ValueError("Build is missing its compute worker")


def verify(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or "review-manifest.json" not in names:
            raise ValueError("Duplicate entries or missing manifest")
        for name in names:
            parts = PurePosixPath(name)
            info = archive.getinfo(name)
            mode = info.external_attr >> 16
            if mode and stat.S_IFMT(mode) not in {0, stat.S_IFREG}:
                raise ValueError(f"Nonregular archive entry: {name}")
            if parts.is_absolute() or parts.as_posix() != name or ".." in parts.parts or "\\" in name or ":" in name:
                raise ValueError(f"Unsafe archive entry: {name}")
            if not allowed_entry(name):
                raise ValueError(f"Unexpected archive entry: {name}")
        manifest = json.loads(archive.read("review-manifest.json"))
        if manifest["status"] != "review_only_incomplete" or manifest["deployment_authorized"] is not False:
            raise ValueError("Review boundary is missing")
        expected = manifest["entries"]
        if set(expected) != set(names) - {"review-manifest.json"}:
            raise ValueError("Manifest does not cover the exact archive")
        contents = {}
        for name, record in expected.items():
            data = archive.read(name)
            if len(data) != record["bytes"] or digest(data) != record["sha256"]:
                raise ValueError(f"Artifact integrity failure: {name}")
            contents[name] = data
        for required in ["site/index.html", "site/frontend-bootstrap.js", "site/templates/department-members.csv"]:
            if required not in expected:
                raise ValueError(f"Missing required public build asset: {required}")
        check_build_assets(contents)
        return {"archive": str(path), "sha256": digest(path.read_bytes()), "entries_verified": len(expected), "status": manifest["status"]}


def check_reviewed_build(proof: dict, sources: dict[str, str], assets: dict[str, str]) -> None:
    """Fail closed unless both current inputs and exact dist bytes match the held build."""
    if proof.get('build_exit_code') != 0 or proof.get('inputs_unchanged_during_build') is not True:
        raise ValueError('Reviewed build did not pass its held-input gate')
    if proof.get('source_hashes_before') != sources or proof.get('source_hashes_after') != sources:
        raise ValueError('Current source inputs differ from the reviewed build')
    if not assets or proof.get('artifacts') != assets:
        raise ValueError('Current exact build assets differ from the reviewed build')


def package(output: Path, reviewed_build: Path | None = None) -> dict:
    output = output.resolve()
    workspace_tmp = (ROOT / "tmp").resolve()
    if not output.is_relative_to(workspace_tmp) or output.suffix.lower() != ".zip":
        raise ValueError("Review archives must be new ZIP files inside workspace tmp")
    if output.exists():
        raise FileExistsError("Refusing to overwrite an existing review artifact")
    before = snapshot()
    for env_file in (ROOT / "frontend").glob(".env*"):
        if env_file.name != ".env.example" and re.search(r"^\s*(?:export\s+)?VITE_", env_file.read_text(encoding="utf-8"), re.MULTILINE):
            raise ValueError("A local frontend environment file defines build variables; review it before packaging")
    # Do not package a configurable external API target or accidental build credentials.
    env = os.environ.copy()
    for key in list(env):
        if key.startswith("VITE_"):
            del env[key]
    env["VITE_API_BASE_URL"] = ""
    proof_reference = None
    if reviewed_build is None:
        command = ["npm.cmd" if os.name == "nt" else "npm", "run", "build"]
        subprocess.run(command, cwd=ROOT / "frontend", env=env, check=True)
    else:
        reviewed_build = reviewed_build.resolve()
        if not reviewed_build.is_relative_to(ROOT):
            raise ValueError('Reviewed build evidence must be inside this workspace')
        reject_reparse_tree(ROOT / 'frontend/dist')
        proof = json.loads(reviewed_build.read_text(encoding='utf-8'))
        assets = {path.relative_to(ROOT).as_posix(): digest(path.read_bytes())
                  for path in (ROOT / 'frontend/dist').rglob('*') if path.is_file()}
        check_reviewed_build(proof, before, assets)
        proof_reference = {'path': reviewed_build.relative_to(ROOT).as_posix(),
                           'sha256': digest(reviewed_build.read_bytes()),
                           'mode': 'seal_exact_existing_build_without_rebuilding',
                           'limit': 'Build environment values are not certified; exact source and asset hashes only.'}
    if snapshot() != before:
        raise ValueError("Frontend source changed while building; no artifact created")
    entries = {}
    reject_reparse_tree(ROOT / "frontend/dist")
    for path in sorted((ROOT / "frontend/dist").rglob("*")):
        if path.is_symlink():
            raise ValueError("Build contains a symbolic link")
        if path.is_file():
            if path.suffix in {".map", ".env", ".db", ".sqlite", ".sqlite3"} or path.name.startswith(".env"):
                raise ValueError("Build contains a private or source-map artifact")
            name = "site/" + path.relative_to(ROOT / "frontend/dist").as_posix()
            if not allowed_entry(name):
                raise ValueError(f"Unexpected build asset requires review: {name}")
            entries[name] = path.read_bytes()
    dist_hashes = {name: digest(data) for name, data in entries.items()}
    entries["REVIEW.txt"] = (
        "LOCAL FRONTEND REVIEW ONLY - incomplete acceptance\n"
        "This archive contains the complete current frontend build, including concurrent frontend work.\n"
        "It is not a UI-only rollback patch or deployment approval. No backend or database is included.\n"
        "Serve site/ with an independently configured disposable API for review. Never point mutation tests at production.\n"
        "Verify with: python tools/package_frontend_review.py --verify <archive.zip>\n"
        "The source hashes and verification reference identify external repository evidence; those files are not included here.\n"
        "Keep the previous authorized complete frontend release and its asset hashes before any separate deployment.\n"
        "A hosting rollback restores that exact previous release's frontend assets; it must not migrate or restore a database.\n"
        "Do not reset shared source files to the task baseline: concurrent edits require a separately reviewed reverse patch.\n"
        "Native screen readers, physical devices, hosting policies and full 260-item acceptance remain unproven.\n"
    ).encode()
    verification = ROOT / "docs/premium-ui/verification-current.json"
    manifest = {
        "schema_version": 1, "status": "review_only_incomplete", "deployment_authorized": False,
        "source_sha256": before, "lockfile_sha256": before["frontend/package-lock.json"],
        "verification_reference": {"path": "docs/premium-ui/verification-current.json", "sha256": digest(verification.read_bytes())},
        "entries": {name: {"bytes": len(data), "sha256": digest(data)} for name, data in entries.items()},
        "limits": ["Local build, not full-plan acceptance", "Contains concurrent frontend code", "No source rollback patch", "No deployment, database or backend changes"],
    }
    if proof_reference is not None:
        manifest['reviewed_build_reference'] = proof_reference
    entries["review-manifest.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    check_build_assets(entries)
    if snapshot() != before:
        raise ValueError("Frontend source changed while packaging; no artifact created")
    if {"site/" + p.relative_to(ROOT / "frontend/dist").as_posix(): digest(p.read_bytes()) for p in (ROOT / "frontend/dist").rglob("*") if p.is_file()} != dist_hashes:
        raise ValueError("Build assets changed while packaging; no artifact created")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return verify(output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--output", type=Path)
    group.add_argument("--verify", type=Path)
    parser.add_argument('--from-reviewed-build', type=Path,
                        help='With --output, seal exact assets matching this successful held-build report; do not rebuild')
    args = parser.parse_args()
    if args.verify and args.from_reviewed_build:
        parser.error('--from-reviewed-build requires --output')
    print(json.dumps(verify(args.verify.resolve()) if args.verify else package(args.output, args.from_reviewed_build), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print(f"Review packaging failed: {error}", file=sys.stderr)
        sys.exit(1)
