#!/usr/bin/env python3
"""
AI Environment Builder for Anime Dub Manager (ADM)
Creates a portable, self-contained Python AI runtime (DeepFilterNet3, Demucs v4, PyTorch, NumPy 1.26.4)
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


def run_cmd(cmd, cwd=None, env=None, check=True):
    cmd_str = ' '.join(cmd) if isinstance(cmd, list) else str(cmd)
    print(f"  [EXEC] {cmd_str}")
    sys.stdout.flush()
    
    merged_env = os.environ.copy()
    merged_env["PYTHONIOENCODING"] = "utf-8"
    merged_env["PYTHONUTF8"] = "1"
    if env:
        merged_env.update(env)
        
    res = subprocess.run(cmd, cwd=cwd, env=merged_env, shell=isinstance(cmd, str))
    if check and res.returncode != 0:
        sys.stderr.write(f"  [ERROR] Command failed with exit code {res.returncode}: {cmd_str}\n")
        sys.stderr.flush()
        raise RuntimeError(f"Command failed with exit code {res.returncode}: {cmd_str}")
    return res.returncode


def prune_unneeded_files(target_dir, strip_cuda=True):
    """
    Strips unnecessary heavy files (pycache, doc assets, CUDA/NVIDIA bloat)
    while preserving all required module directories (including torch/testing).
    """
    print("  [CLEANUP] Pruning unneeded files, static libraries, and caches...")
    unneeded_dir_names = {
        '__pycache__', '.pytest_cache', 'idle_test', 'unit_tests', 'examples', 'sample_data'
    }
    unneeded_extensions = {'.pyc', '.pyo', '.a', '.pdb', '.lib', '.h', '.c', '.cpp', '.cu', '.ptx'}
    
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
            dir_lower = name.lower()
            norm_root = root.replace("\\", "/").lower()

            # CRITICAL: NEVER prune ANY directory inside 'torch', 'torchaudio', 'deepfilternet', 'demucs', 'df', 'soundfile', 'scipy', 'numpy', 'numba', 'llvmlite', 'librosa', 'pedalboard'
            # Subpackages such as 'torch/cuda', 'torch/testing', 'torchaudio/compliance' are required at runtime!
            if any(core_pkg in norm_root for core_pkg in ['/torch', '\\torch', 'torch/', 'torch\\', 'torchaudio', 'deepfilternet', 'demucs', 'df', 'soundfile', 'scipy', 'numpy', 'numba', 'llvmlite', 'librosa', 'pedalboard']):
                continue

            # NEVER prune testing / tests if inside torch, torchaudio, onnx, or site-packages core
            if dir_lower in ['tests', 'test', 'testing'] and ('torch' in norm_root or 'site-packages' in norm_root):
                continue

            # Standalone heavy CUDA packages should only be stripped if they are top-level directories in site-packages
            is_top_level_site_package = norm_root.endswith(('site-packages', 'dist-packages'))
            is_standalone_cuda = is_top_level_site_package and (
                dir_lower.startswith(('nvidia_', 'nvidia', 'triton', 'cuda_'))
            )

            if dir_lower in unneeded_dir_names or (strip_cuda and is_standalone_cuda):
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
    print(f"[BUILD] Building AI_env for platform tag: {tag}")
    print(f"[PATH] Project Root: {root_dir}")
    print(f"[PATH] Output Directory: {out_dir}")
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
    # Note: DeepFilterNet 0.5.6 strictly requires `packaging>=23.0,<24.0`.
    print("\n[STEP 2] Upgrading pip, setuptools, wheel (DeepFilterNet compatible)...")
    run_cmd([
        str(venv_python), "-m", "pip", "install", "--upgrade",
        "pip<25.0",
        "setuptools<70.0.0",
        "wheel<0.45.0",
        "packaging>=23.0,<24.0",
        "--no-cache-dir"
    ])

    # Create constraints file to prevent transitive upgrades of numpy and packaging
    constraints_file = build_temp_dir / "constraints.txt"
    constraints_file.write_text(
        "numpy==1.26.4\n"
        "packaging>=23.0,<24.0\n"
        "setuptools<70.0.0\n"
        "wheel<0.45.0\n"
        "llvmlite==0.42.0\n"
        "numba==0.59.1\n",
        encoding="utf-8"
    )

    # 4. Install PyTorch & TorchAudio (Strictly version-matched 2.2.2)
    print("\n[STEP 3] Installing strictly matched PyTorch and TorchAudio (2.2.2)...")
    if use_cpu_wheels and (is_win or is_linux):
        print("  [OPT] Installing CPU PyTorch wheels directly from PyTorch CPU index...")
        run_cmd([
            str(venv_python), "-m", "pip", "install", 
            "--no-cache-dir",
            "--extra-index-url", "https://download.pytorch.org/whl/cpu",
            "-c", str(constraints_file),
            "torch==2.2.2", 
            "torchaudio==2.2.2"
        ])
    else:
        print("  [OPT] Installing PyTorch & TorchAudio from PyPI...")
        run_cmd([
            str(venv_python), "-m", "pip", "install", 
            "--no-cache-dir",
            "-c", str(constraints_file),
            "torch==2.2.2", 
            "torchaudio==2.2.2"
        ])

    # 5. Install DeepFilterNet, Demucs, and audio processing stack with LOCKED NumPy 1.26.4 & Torch 2.2.2
    print("\n[STEP 4] Installing DeepFilterNet3, Demucs v4 & audio packages (Locking NumPy 1.26.4 and Torch 2.2.2)...")
    extra_index_args = ["--extra-index-url", "https://download.pytorch.org/whl/cpu"] if (use_cpu_wheels and (is_win or is_linux)) else []

    # Pre-install llvmlite and numba binary wheels to prevent compiling LLVM from source on macOS Intel (x86_64)
    print("  [PREFER-BINARY] Pre-installing binary wheels for llvmlite 0.42.0 and numba 0.59.1...")
    run_cmd([
        str(venv_python), "-m", "pip", "install",
        "--no-cache-dir",
        "--prefer-binary",
        "-c", str(constraints_file),
        "llvmlite==0.42.0",
        "numba==0.59.1"
    ])

    pinned_stack = [
        "numpy==1.26.4",
        "pedalboard==0.9.25",
        "deepfilternet>=0.5.6,<0.6.0",
        "demucs>=4.0.0,<4.1.0",
        "soundfile>=0.12.1",
        "scipy>=1.10.0,<1.14.0",
        "librosa>=0.10.0",
        "onnxruntime>=1.16.0",
        "huggingface-hub>=0.20.0",
        "tqdm>=4.65.0",
        "einops>=0.7.0",
        "rotary-embedding-torch>=0.5.0",
        "requests>=2.31.0"
    ]
    run_cmd([str(venv_python), "-m", "pip", "install", "--no-cache-dir", "--prefer-binary", "-c", str(constraints_file)] + extra_index_args + pinned_stack)

    # Re-enforce numpy 1.26.4, torch 2.2.2 and torchaudio 2.2.2 strictly to prevent any transitive override
    print("  [STRICT] Re-enforcing NumPy 1.26.4 and TorchAudio 2.2.2 pinning...")
    run_cmd([str(venv_python), "-m", "pip", "install", "--no-cache-dir", "--force-reinstall", "--no-deps", "numpy==1.26.4"])
    if use_cpu_wheels and (is_win or is_linux):
        run_cmd([str(venv_python), "-m", "pip", "install", "--no-cache-dir", "--no-deps", "--extra-index-url", "https://download.pytorch.org/whl/cpu", "torch==2.2.2", "torchaudio==2.2.2"])
    else:
        run_cmd([str(venv_python), "-m", "pip", "install", "--no-cache-dir", "--no-deps", "torch==2.2.2", "torchaudio==2.2.2"])

    # Verify PyTorch / TorchAudio / NumPy integrity inside venv
    print("\n[STEP 5] Verifying environment integrity and imports inside venv...")
    verify_script_path = build_temp_dir / "verify_env.py"
    verify_script_content = """import sys
import traceback

print(f"  [VERIFY] Python executable: {sys.executable}")
print(f"  [VERIFY] Python version: {sys.version}")

try:
    import numpy as np
    print(f"  [VERIFY OK] NumPy: {np.__version__}")
    assert np.__version__.startswith("1.26"), f"CRITICAL: Expected NumPy 1.26.x, got {np.__version__}"
except Exception as e:
    print(f"  [VERIFY FAILED] NumPy: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    import torch
    print(f"  [VERIFY OK] PyTorch: {torch.__version__}")
    import torch.cuda
    _ = torch.cuda.is_available()
    print(f"  [VERIFY OK] torch.cuda is available check: {_}")
except Exception as e:
    print(f"  [VERIFY FAILED] PyTorch: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    import torchaudio
    print(f"  [VERIFY OK] TorchAudio: {torchaudio.__version__}")
    import torchaudio.functional
    import torchaudio.compliance
    print("  [VERIFY OK] torchaudio.compliance & torchaudio.functional imports succeeded.")
except Exception as e:
    print(f"  [VERIFY FAILED] TorchAudio: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    import df
    print("  [VERIFY OK] DeepFilterNet (df) import succeeded.")
except Exception as e:
    print(f"  [VERIFY FAILED] DeepFilterNet: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    import demucs.pretrained
    print("  [VERIFY OK] Demucs import succeeded.")
except Exception as e:
    print(f"  [VERIFY FAILED] Demucs: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    import soundfile
    print(f"  [VERIFY OK] SoundFile: {soundfile.__version__}")
except Exception as e:
    print(f"  [VERIFY FAILED] SoundFile: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    import pedalboard
    print(f"  [VERIFY OK] Pedalboard: {pedalboard.__version__}")
except Exception as e:
    print(f"  [VERIFY FAILED] Pedalboard: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    import numba
    import librosa
    import scipy
    import onnxruntime
    print(f"  [VERIFY OK] Numba ({numba.__version__}), Librosa ({librosa.__version__}), SciPy ({scipy.__version__}), ONNXRuntime ({onnxruntime.__version__})")
except Exception as e:
    print(f"  [VERIFY FAILED] DSP / Audio Stack: {e}")
    traceback.print_exc()
    sys.exit(1)

print("  [VERIFY COMPLETE] All required neural audio processing modules verified successfully!")
"""
    verify_script_path.write_text(verify_script_content, encoding="utf-8")
    run_cmd([str(venv_python), str(verify_script_path)])
    if verify_script_path.exists():
        try:
            os.remove(verify_script_path)
        except Exception:
            pass

    # 6. Preload base models for offline operation
    print("\n[STEP 6] Preloading AI base models for offline operation (DeepFilterNet3, Demucs htdemucs)...")
    models_dir = build_temp_dir / "models"
    torch_models_dir = models_dir / "torch"
    hf_models_dir = models_dir / "huggingface"
    df_models_dir = models_dir / "deepfilternet"
    
    torch_models_dir.mkdir(parents=True, exist_ok=True)
    hf_models_dir.mkdir(parents=True, exist_ok=True)
    df_models_dir.mkdir(parents=True, exist_ok=True)

    preload_script = f"""
import os
import sys

os.environ["TORCH_HOME"] = r"{torch_models_dir}"
os.environ["HF_HOME"] = r"{hf_models_dir}"
os.environ["DEEPFILTERNET_CACHE"] = r"{df_models_dir}"

print("  -> Preloading DeepFilterNet3 weights...")
try:
    import df
    model, df_state, _ = df.init_df("DeepFilterNet3", log_level="none")
    print("  [OK] DeepFilterNet3 model preloaded.")
except Exception as e:
    print(f"  [WARN] DeepFilterNet3 preload warning: {{e}}")

print("  -> Preloading Demucs base model (htdemucs)...")
try:
    import demucs.pretrained
    model = demucs.pretrained.get_model('htdemucs')
    print("  [OK] Demucs htdemucs model preloaded.")
except Exception as e:
    print(f"  [WARN] Demucs preload warning: {{e}}")
"""
    preload_py_file = build_temp_dir / "preload_models.py"
    preload_py_file.write_text(preload_script, encoding="utf-8")

    preload_env = {
        "TORCH_HOME": str(torch_models_dir),
        "HF_HOME": str(hf_models_dir),
        "DEEPFILTERNET_CACHE": str(df_models_dir)
    }
    
    run_cmd([str(venv_python), str(preload_py_file)], env=preload_env, check=False)
    if preload_py_file.exists():
        try:
            os.remove(preload_py_file)
        except Exception:
            pass

    # Copy user cache checkpoints to build_temp_ai_env/models if created in default home cache
    user_home = Path.home()
    default_torch_checkpoints = user_home / ".cache" / "torch" / "hub" / "checkpoints"
    if default_torch_checkpoints.exists():
        target_ckpt = torch_models_dir / "hub" / "checkpoints"
        target_ckpt.mkdir(parents=True, exist_ok=True)
        for f in default_torch_checkpoints.glob("*"):
            if f.is_file():
                try:
                    shutil.copy2(f, target_ckpt / f.name)
                    print(f"  [PORTABLE] Bundled preloaded checkpoint: {f.name}")
                except Exception:
                    pass

    default_df_cache = user_home / ".cache" / "deepfilternet"
    if default_df_cache.exists():
        for f in default_df_cache.glob("*"):
            try:
                if f.is_dir():
                    shutil.copytree(f, df_models_dir / f.name, dirs_exist_ok=True)
                else:
                    shutil.copy2(f, df_models_dir / f.name)
            except Exception:
                pass

    # 7. Copy base Python binaries & stdlib for portable execution
    print("\n[STEP 7] Bundling portable Python base binaries and standard library...")
    if is_win:
        base_dir = Path(sys.base_prefix)
        # 1. Copy base DLLs and python.exe into env_dir and Scripts/
        for item in base_dir.iterdir():
            if item.is_file() and item.suffix.lower() in [".dll", ".exe"]:
                try:
                    shutil.copy2(item, env_dir / item.name)
                    shutil.copy2(item, env_dir / "Scripts" / item.name)
                except Exception:
                    pass

        # 2. Copy DLLs folder (_socket.pyd, _ctypes.pyd, _ssl.pyd, etc.)
        dlls_src = base_dir / "DLLs"
        if dlls_src.exists():
            shutil.copytree(dlls_src, env_dir / "DLLs", dirs_exist_ok=True)
            print("  [PORTABLE] Copied DLLs/ folder (standard C-extensions)")

        # 3. Copy Lib/ standard library (encodings, os, json, etc.)
        lib_src = base_dir / "Lib"
        lib_dst = env_dir / "Lib"
        lib_dst.mkdir(parents=True, exist_ok=True)
        if lib_src.exists():
            for item in lib_src.iterdir():
                if item.name.lower() == "site-packages":
                    continue
                dst_item = lib_dst / item.name
                if item.is_dir():
                    shutil.copytree(item, dst_item, dirs_exist_ok=True)
                else:
                    shutil.copy2(item, dst_item)
            print("  [PORTABLE] Copied Lib/ standard library (encodings, os, json, etc.)")

        # 4. Set self-contained pyvenv.cfg
        cfg_path = env_dir / "pyvenv.cfg"
        try:
            cfg_path.write_text("home = .\ninclude-system-site-packages = false\nversion = 3.10.11\napplocal = true\n", encoding="utf-8")
        except Exception:
            pass

    if is_linux or is_mac:
        base_dir = Path(sys.base_prefix)
        py_ver = f"python3.{sys.version_info.minor}"
        base_lib = base_dir / "lib" / py_ver
        target_lib = env_dir / "lib" / py_ver
        target_lib.mkdir(parents=True, exist_ok=True)
        if base_lib.exists():
            for item in base_lib.iterdir():
                if item.name.lower() == "site-packages":
                    continue
                dst_item = target_lib / item.name
                if not dst_item.exists():
                    if item.is_dir():
                        shutil.copytree(item, dst_item, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dst_item)
            print(f"  [PORTABLE] Copied Unix standard library to {target_lib}")

    # 8. Copy sidecars into environment bundle for self-containment
    print("\n[STEP 8] Bundling audio_ai_processor sidecar script...")
    sidecar_src = root_dir / "electron" / "sidecars" / "audio_ai_processor.py"
    sidecar_dst_dir = build_temp_dir / "sidecars"
    sidecar_dst_dir.mkdir(parents=True, exist_ok=True)
    if sidecar_src.exists():
        shutil.copy2(sidecar_src, sidecar_dst_dir / "audio_ai_processor.py")
        print(f"  [OK] Copied audio_ai_processor.py to {sidecar_dst_dir}")

    # 9. Create portable launcher / environment marker
    version_info_path = build_temp_dir / "env_info.json"
    with open(version_info_path, "w", encoding="utf-8") as f:
        f.write(f'{{\n  "platform": "{tag}",\n  "python_version": "{platform.python_version()}",\n  "numpy_version": "1.26.4",\n  "deepfilternet": true,\n  "demucs": true\n}}\n')

    # 10. Prune bloat
    prune_unneeded_files(build_temp_dir, strip_cuda=(use_cpu_wheels and (is_win or is_linux)))

    # 10.1 Post-pruning verification: Ensure PyTorch, CUDA module stub, DeepFilterNet and Demucs are fully intact!
    print("\n[STEP 8.5] Post-pruning integrity verification inside runtime...")
    post_verify_code = """
import sys
import traceback
try:
    import numpy as np
    assert np.__version__.startswith("1.26"), f"NumPy version mismatch: {np.__version__}"
    import torch
    # Verify torch.cuda submodule is present and callable
    import torch.cuda
    _ = torch.cuda.is_available()
    import torchaudio
    import df
    import demucs
    import numba
    import librosa
    import pedalboard
    import soundfile
    import scipy
    import onnxruntime
    print(f"  [POST-PRUNE OK] All core packages intact: NumPy {np.__version__}, PyTorch {torch.__version__}, TorchAudio {torchaudio.__version__}, Pedalboard {pedalboard.__version__}, Numba {numba.__version__}")
except Exception as e:
    sys.stderr.write(f"  [POST-PRUNE ERROR] Crucial AI package was damaged by cleanup: {e}\\n")
    traceback.print_exc()
    sys.exit(1)
"""
    post_py_file = build_temp_dir / "post_verify.py"
    post_py_file.write_text(post_verify_code, encoding="utf-8")
    run_cmd([str(venv_python), str(post_py_file)], check=True)
    if post_py_file.exists():
        try: os.remove(post_py_file)
        except Exception: pass

    # 11. Package zip archives
    print("\n[STEP 9] Archiving AI_env bundle with maximum compression...")
    primary_zip_name = f"ai_env_{tag}.zip"
    primary_zip_path = out_dir / primary_zip_name
    make_zip(str(build_temp_dir), str(primary_zip_path), root_folder_name="ai_env")

    # If windows, also produce generic ai_env.zip for backward compatibility
    if "windows" in tag:
        compat_zip_path = out_dir / "ai_env.zip"
        shutil.copyfile(primary_zip_path, compat_zip_path)
        print(f"  [OK] Created backward-compatible alias: {compat_zip_path}")

    print("\n[SUCCESS] Portable AI_env build completed successfully!")
    print(f"  Primary Archive: {primary_zip_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build portable AI_env for Anime Dub Manager")
    parser.add_argument("--out", "--out-dir", dest="out", default="out", help="Output directory for zipped packages")
    parser.add_argument("--tag", default=None, help="Custom platform tag (e.g. windows_x64, macos_arm64, macos_x64, linux_x64)")
    parser.add_argument("--cuda", action="store_true", help="Build with CUDA wheels instead of CPU wheels")
    args = parser.parse_args()
    
    build_ai_env(output_dir=args.out, custom_tag=args.tag, use_cpu_wheels=not args.cuda)
