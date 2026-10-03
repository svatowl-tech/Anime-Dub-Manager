#!/usr/bin/env python3
"""
AI Environment Builder for Anime Dub Manager (ADM)
Creates a portable, self-contained AI runtime (DeepFilterNet3, Demucs v4, PyTorch)
and packages it into cross-platform zip archives for GitHub Releases CI/CD.
"""

import os
import sys
import shutil
import zipfile
import platform
import subprocess
import argparse
from pathlib import Path

def get_platform_tag():
    system = platform.system().lower()
    machine = platform.machine().lower()
    
    if system == "windows":
        return "windows_x64"
    elif system == "darwin":
        if "arm" in machine or "aarch" in machine:
            return "macos_arm64"
        return "macos_x64"
    elif system == "linux":
        return "linux_x64"
    return f"{system}_{machine}"

def run_cmd(cmd, cwd=None, env=None):
    print(f"  [EXEC] {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    res = subprocess.run(cmd, cwd=cwd, env=env, shell=isinstance(cmd, str))
    if res.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {res.returncode}: {cmd}")

def clean_pycache(target_dir):
    print("  [CLEANUP] Removing __pycache__, .pyc, and unnecessary temporary files...")
    for root, dirs, files in os.walk(target_dir, topdown=False):
        for name in files:
            if name.endswith('.pyc') or name.endswith('.pyo'):
                try:
                    os.remove(os.path.join(root, name))
                except Exception:
                    pass
        for name in dirs:
            if name == '__pycache__' or name == '.pytest_cache':
                try:
                    shutil.rmtree(os.path.join(root, name), ignore_errors=True)
                except Exception:
                    pass

def make_zip(source_dir, output_zip_path, root_folder_name="ai_env"):
    print(f"  [ZIP] Packaging '{source_dir}' -> '{output_zip_path}' (Root: '{root_folder_name}')...")
    os.makedirs(os.path.dirname(os.path.abspath(output_zip_path)), exist_ok=True)
    
    with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zip_file:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, source_dir)
                archive_name = os.path.join(root_folder_name, rel_path).replace("\\", "/")
                
                # Preserve file permissions on POSIX
                zip_info = zipfile.ZipInfo.from_file(file_path, archive_name)
                if os.name != 'nt':
                    st = os.stat(file_path)
                    zip_info.external_attr = (st.st_mode & 0xFFFF) << 16
                zip_file.writestr(zip_info, open(file_path, 'rb').read())
    
    size_mb = os.path.getsize(output_zip_path) / (1024 * 1024)
    print(f"  ✓ Archive created successfully: {output_zip_path} ({size_mb:.2f} MB)")

def build_ai_env(output_dir="out", custom_tag=None):
    root_dir = Path(__file__).resolve().parent.parent
    requirements_file = root_dir / "requirements.txt"
    build_temp_dir = root_dir / "build_temp_ai_env"
    env_dir = build_temp_dir / "python_env"
    out_dir = root_dir / output_dir
    
    tag = custom_tag or get_platform_tag()
    print("=" * 60)
    print(f"🚀 Building AI_env for platform: {tag}")
    print(f"📂 Project Root: {root_dir}")
    print(f"📋 Requirements: {requirements_file}")
    print("=" * 60)

    # 1. Clean previous temp builds
    if build_temp_dir.exists():
        shutil.rmtree(build_temp_dir, ignore_errors=True)
    build_temp_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 2. Create virtual environment
    print("\n📦 Step 1: Creating isolated portable virtual environment...")
    # Use python -m venv with --copies if supported
    try:
        run_cmd([sys.executable, "-m", "venv", "--copies", str(env_dir)])
    except Exception:
        print("  Falling back to standard venv...")
        run_cmd([sys.executable, "-m", "venv", str(env_dir)])

    # Determine paths inside venv
    is_win = platform.system().lower() == "windows"
    if is_win:
        venv_python = env_dir / "Scripts" / "python.exe"
        venv_pip = env_dir / "Scripts" / "pip.exe"
    else:
        venv_python = env_dir / "bin" / "python"
        venv_pip = env_dir / "bin" / "pip"

    if not venv_python.exists():
        raise FileNotFoundError(f"Virtual environment python executable not found at: {venv_python}")

    # 3. Upgrade pip, wheel, setuptools
    print("\n⚡ Step 2: Upgrading pip, setuptools, wheel...")
    run_cmd([str(venv_python), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel", "--no-cache-dir"])

    # 4. Install requirements
    print(f"\n🧠 Step 3: Installing Neural Audio packages from {requirements_file}...")
    run_cmd([str(venv_python), "-m", "pip", "install", "--no-cache-dir", "-r", str(requirements_file)])

    # 5. Copy sidecars into environment bundle for self-containment
    print("\n🚚 Step 4: Bundling audio_ai_processor sidecar and metadata...")
    sidecar_src = root_dir / "electron" / "sidecars" / "audio_ai_processor.py"
    sidecar_dst_dir = build_temp_dir / "sidecars"
    sidecar_dst_dir.mkdir(parents=True, exist_ok=True)
    if sidecar_src.exists():
        shutil.copy2(sidecar_src, sidecar_dst_dir / "audio_ai_processor.py")
        print(f"  ✓ Copied audio_ai_processor.py to {sidecar_dst_dir}")

    # 6. Create portable launcher / environment marker
    version_info_path = build_temp_dir / "env_info.json"
    with open(version_info_path, "w", encoding="utf-8") as f:
        f.write(f'{{\n  "platform": "{tag}",\n  "python_version": "{platform.python_version()}",\n  "deepfilternet": true,\n  "demucs": true\n}}\n')

    # 7. Clean up bloat
    clean_pycache(build_temp_dir)

    # 8. Package zip archives
    print("\n📦 Step 5: Archiving AI_env bundle...")
    primary_zip_name = f"ai_env_{tag}.zip"
    primary_zip_path = out_dir / primary_zip_name
    make_zip(str(build_temp_dir), str(primary_zip_path), root_folder_name="ai_env")

    # If windows, also produce generic ai_env.zip for backward compatibility
    if "windows" in tag:
        compat_zip_path = out_dir / "ai_env.zip"
        shutil.copyfile(primary_zip_path, compat_zip_path)
        print(f"  ✓ Created backward-compatible alias: {compat_zip_path}")

    print("\n🎉 AI_env build completed successfully!")
    print(f"   Output: {primary_zip_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build portable AI_env for Anime Dub Manager")
    parser.add_argument("--out", default="out", help="Output directory for zipped packages")
    parser.add_argument("--tag", default=None, help="Custom platform tag (e.g. windows_x64, macos_arm64, linux_x64)")
    args = parser.parse_args()
    
    build_ai_env(output_dir=args.out, custom_tag=args.tag)
