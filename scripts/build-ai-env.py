#!/usr/bin/env python3
"""
AI Environment Builder for Anime Dub Manager (ADM)
Creates a portable, self-contained AI runtime (DeepFilterNet3, Demucs v4, PyTorch)
and packages it into lightweight cross-platform zip archives for GitHub Releases CI/CD (<2GB limit).
"""

import os
import sys
import shutil
import zipfile
import platform
import subprocess
import argparse
from pathlib import Path

# Ensure UTF-8 stdout/stderr on Windows runners to prevent cp1252 encoding errors
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

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
    cmd_str = ' '.join(cmd) if isinstance(cmd, list) else cmd
    print(f"  [EXEC] {cmd_str}")
    
    merged_env = os.environ.copy()
    merged_env["PYTHONIOENCODING"] = "utf-8"
    merged_env["PYTHONUTF8"] = "1"
    if env:
        merged_env.update(env)
        
    res = subprocess.run(cmd, cwd=cwd, env=merged_env, shell=isinstance(cmd, str))
    if res.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {res.returncode}: {cmd}")

def prune_unneeded_files(target_dir):
    """
    Strips unnecessary heavy files (tests, static libs, pycache, doc assets)
    to keep archive size ultra-light (< 400 MB) and well below GitHub's 2GB limit.
    """
    print("  [CLEANUP] Pruning unneeded files, static libraries, test suites, and caches...")
    unneeded_dir_names = {
        '__pycache__', '.pytest_cache', 'tests', 'test', 'testing', 
        'idle_test', 'unit_tests', 'examples', 'sample_data'
    }
    unneeded_extensions = {'.pyc', '.pyo', '.a', '.pdb', '.lib', '.h', '.c', '.cpp'}
    
    removed_count = 0
    for root, dirs, files in os.walk(target_dir, topdown=False):
        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext in unneeded_extensions:
                try:
                    os.remove(os.path.join(root, name))
                    removed_count += 1
                except Exception:
                    pass
        for name in dirs:
            if name in unneeded_dir_names:
                try:
                    shutil.rmtree(os.path.join(root, name), ignore_errors=True)
                    removed_count += 1
                except Exception:
                    pass
    print(f"  [CLEANUP] Removed unneeded files and directories ({removed_count} items pruned).")

def make_zip(source_dir, output_zip_path, root_folder_name="ai_env"):
    print(f"  [ZIP] Packaging '{source_dir}' -> '{output_zip_path}' (Root: '{root_folder_name}')...")
    os.makedirs(os.path.dirname(os.path.abspath(output_zip_path)), exist_ok=True)
    
    with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zip_file:
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
    
    size_bytes = os.path.getsize(output_zip_path)
    size_mb = size_bytes / (1024 * 1024)
    print(f"  [ZIP OK] Archive created: {output_zip_path} ({size_mb:.2f} MB / {size_bytes} bytes)")
    
    # Assert size is within GitHub Release limit (2GB = 2147483648 bytes)
    max_limit = 2147483648
    if size_bytes >= max_limit:
        raise ValueError(f"CRITICAL: Archive size {size_mb:.2f} MB exceeds GitHub Release 2GB limit!")

def build_ai_env(output_dir="out", custom_tag=None, use_cpu_wheels=True):
    root_dir = Path(__file__).resolve().parent.parent
    build_temp_dir = root_dir / "build_temp_ai_env"
    env_dir = build_temp_dir / "python_env"
    out_dir = root_dir / output_dir
    
    tag = custom_tag or get_platform_tag()
    is_win = "windows" in tag or platform.system().lower() == "windows"
    is_mac = "macos" in tag or platform.system().lower() == "darwin"
    is_linux = "linux" in tag or platform.system().lower() == "linux"

    print("=" * 60)
    print(f"[BUILD] Building AI_env for platform: {tag}")
    print(f"[PATH] Project Root: {root_dir}")
    print("=" * 60)

    # 1. Clean previous temp builds
    if build_temp_dir.exists():
        shutil.rmtree(build_temp_dir, ignore_errors=True)
    build_temp_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 2. Create virtual environment
    print("\n[STEP 1] Creating isolated portable virtual environment...")
    try:
        run_cmd([sys.executable, "-m", "venv", "--copies", str(env_dir)])
    except Exception:
        print("  [WARN] Falling back to standard venv...")
        run_cmd([sys.executable, "-m", "venv", str(env_dir)])

    # Determine paths inside venv
    if is_win:
        venv_python = env_dir / "Scripts" / "python.exe"
    else:
        venv_python = env_dir / "bin" / "python"

    if not venv_python.exists():
        raise FileNotFoundError(f"Virtual environment python executable not found at: {venv_python}")

    # 3. Upgrade pip, wheel, setuptools
    print("\n[STEP 2] Upgrading pip, setuptools, wheel...")
    run_cmd([str(venv_python), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel", "--no-cache-dir"])

    # 4. Install optimized PyTorch & dependencies
    print("\n[STEP 3] Installing PyTorch, DeepFilterNet3, Demucs v4 & audio packages...")
    
    # For Windows & Linux, use PyTorch CPU wheels by default for portable distributions to prevent 6GB CUDA bloat
    if use_cpu_wheels and (is_win or is_linux):
        print("  [OPT] Installing lightweight PyTorch (CPU wheel index) for portable release...")
        run_cmd([
            str(venv_python), "-m", "pip", "install", 
            "--no-cache-dir", 
            "torch>=2.1.0,<=2.3.1", 
            "torchaudio>=2.1.0,<=2.3.1", 
            "--index-url", "https://download.pytorch.org/whl/cpu"
        ])
    else:
        # macOS uses native PyTorch with built-in Apple Silicon Metal / MPS
        print("  [OPT] Installing standard PyTorch wheel...")
        run_cmd([
            str(venv_python), "-m", "pip", "install", 
            "--no-cache-dir", 
            "torch>=2.1.0,<=2.3.1", 
            "torchaudio>=2.1.0,<=2.3.1"
        ])

    # Install remaining audio ML packages
    run_cmd([
        str(venv_python), "-m", "pip", "install", 
        "--no-cache-dir",
        "deepfilternet>=0.5.6",
        "demucs>=4.0.1",
        "soundfile>=0.12.1",
        "numpy>=1.24.0,<2.0.0",
        "scipy>=1.10.0",
        "librosa>=0.10.0",
        "tqdm>=4.65.0",
        "packaging>=23.0"
    ])

    # 5. Copy sidecars into environment bundle for self-containment
    print("\n[STEP 4] Bundling audio_ai_processor sidecar and metadata...")
    sidecar_src = root_dir / "electron" / "sidecars" / "audio_ai_processor.py"
    sidecar_dst_dir = build_temp_dir / "sidecars"
    sidecar_dst_dir.mkdir(parents=True, exist_ok=True)
    if sidecar_src.exists():
        shutil.copy2(sidecar_src, sidecar_dst_dir / "audio_ai_processor.py")
        print(f"  [OK] Copied audio_ai_processor.py to {sidecar_dst_dir}")

    # 6. Create portable launcher / environment marker
    version_info_path = build_temp_dir / "env_info.json"
    with open(version_info_path, "w", encoding="utf-8") as f:
        f.write(f'{{\n  "platform": "{tag}",\n  "python_version": "{platform.python_version()}",\n  "deepfilternet": true,\n  "demucs": true\n}}\n')

    # 7. Prune bloat
    prune_unneeded_files(build_temp_dir)

    # 8. Package zip archives
    print("\n[STEP 5] Archiving AI_env bundle with maximum compression...")
    primary_zip_name = f"ai_env_{tag}.zip"
    primary_zip_path = out_dir / primary_zip_name
    make_zip(str(build_temp_dir), str(primary_zip_path), root_folder_name="ai_env")

    # If windows, also produce generic ai_env.zip for backward compatibility
    if "windows" in tag:
        compat_zip_path = out_dir / "ai_env.zip"
        shutil.copyfile(primary_zip_path, compat_zip_path)
        print(f"  [OK] Created backward-compatible alias: {compat_zip_path}")

    print("\n[DONE] AI_env build completed successfully!")
    print(f"  Output: {primary_zip_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build portable AI_env for Anime Dub Manager")
    parser.add_argument("--out", default="out", help="Output directory for zipped packages")
    parser.add_argument("--tag", default=None, help="Custom platform tag (e.g. windows_x64, macos_arm64, linux_x64)")
    parser.add_argument("--cuda", action="store_true", help="Build with CUDA wheels instead of CPU wheels")
    args = parser.parse_args()
    
    build_ai_env(output_dir=args.out, custom_tag=args.tag, use_cpu_wheels=not args.cuda)
