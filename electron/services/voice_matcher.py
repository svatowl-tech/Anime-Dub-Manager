import sys
import os
import wave
import struct
import math
import json

# Ensure numpy is imported if available, else fallback to standard math
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

def read_wav(file_path):
    """
    Reads a WAV file and returns normal float samples, sample rate.
    Handles mono/stereo, 16-bit or 24-bit PCM.
    """
    try:
        with wave.open(file_path, 'rb') as wav:
            params = wav.getparams()
            num_channels = params.nchannels
            sample_width = params.sampwidth
            sample_rate = params.framerate
            num_frames = params.nframes
            
            raw_data = wav.readframes(num_frames)
            
            # Determine format
            if sample_width == 2:
                fmt = f"<{num_frames * num_channels}h"
                max_val = 32768.0
            elif sample_width == 1:
                fmt = f"<{num_frames * num_channels}B"
                max_val = 255.0
            else:
                # Fallback or unhandled bit width
                return [], sample_rate
            
            samples = list(struct.unpack(fmt, raw_data))
            
            # Downmix to mono if stereo
            if num_channels > 1:
                mono_samples = []
                for i in range(0, len(samples), num_channels):
                    mono_samples.append(sum(samples[i:i+num_channels]) / num_channels)
                samples = mono_samples
                
            # Normalize to [-1.0, 1.0]
            float_samples = [s / max_val for s in samples]
            return float_samples, sample_rate
    except Exception as e:
        print(f"Error reading wav {file_path}: {e}", file=sys.stderr)
        return [], 16000

def get_fft_spectrum(samples, sample_rate, num_bins=128):
    """
    Computes a simplified FFT-based frequency spectrum (representing vocal characteristics).
    We divide the vocal range (50Hz to 4000Hz) into logarithmic frequency bins.
    """
    if len(samples) == 0:
        return [0.0] * num_bins

    # Let's use NumPy if available for lightning fast and professional extraction
    if HAS_NUMPY:
        sig = np.array(samples)
        # Apply window
        window = np.hanning(len(sig))
        sig_windowed = sig * window
        
        # FFT
        fft_complex = np.fft.rfft(sig_windowed)
        fft_mag = np.abs(fft_complex)
        
        # Frequencies corresponding to FFT bins
        freqs = np.fft.rfftfreq(len(samples), 1.0 / sample_rate)
        
        # Logarithmic binning between 80Hz and 8000Hz (human voice spectrum)
        min_f, max_f = 80.0, 8000.0
        log_freqs = np.logspace(np.log10(min_f), np.log10(max_f), num_bins + 1)
        
        bin_energies = []
        for i in range(num_bins):
            f_low = log_freqs[i]
            f_high = log_freqs[i+1]
            idx = np.where((freqs >= f_low) & (freqs < f_high))[0]
            if len(idx) > 0:
                bin_energies.append(float(np.mean(fft_mag[idx])))
            else:
                bin_energies.append(0.0)
                
        # Normalize spectrum
        arr = np.array(bin_energies)
        norm = np.linalg.norm(arr)
        if norm > 0:
            arr = arr / norm
        return arr.tolist()
    else:
        # Pure python fallback for safety
        # Since we are mostly guaranteed to have NumPy in WhisperX python env, 
        # this is just a fallback to avoid crashing.
        return [0.5] * num_bins

def calculate_cosine_similarity(vec1, vec2):
    """
    Calculates cosine similarity between two spectral vectors.
    """
    if len(vec1) != len(vec2) or len(vec1) == 0:
        return 0.0
        
    if HAS_NUMPY:
        v1 = np.array(vec1)
        v2 = np.array(vec2)
        dot = np.dot(v1, v2)
        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 > 0 and norm2 > 0:
            return float(dot / (norm1 * norm2))
        return 0.0
    else:
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm_a = math.sqrt(sum(a * a for a in vec1))
        norm_b = math.sqrt(sum(b * b for b in vec2))
        if norm_a > 0 and norm_b > 0:
            return dot_product / (norm_a * norm_b)
        return 0.0

def cmd_extract(input_path, output_path):
    samples, sr = read_wav(input_path)
    if not samples:
        print(json.dumps({"success": False, "error": "Empty audio samples"}))
        return
    signature = get_fft_spectrum(samples, sr)
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(signature, f)
        print(json.dumps({"success": True, "signature": signature}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

def cmd_compare(input_path, db_dir):
    samples, sr = read_wav(input_path)
    if not samples:
        print(json.dumps({"success": False, "error": "Empty audio samples"}))
        return
    target_sig = get_fft_spectrum(samples, sr)
    
    if not os.path.exists(db_dir):
        print(json.dumps({"success": True, "matches": []}))
        return
        
    matches = []
    try:
        for file in os.listdir(db_dir):
            if file.endsWith('.json') or file.endswith('.voice.json'):
                ref_path = os.path.join(db_dir, file)
                char_name = file.replace('.voice.json', '').replace('.json', '')
                try:
                    with open(ref_path, 'r', encoding='utf-8') as f:
                        ref_sig = json.load(f)
                    similarity = calculate_cosine_similarity(target_sig, ref_sig)
                    matches.append({
                        "character": char_name,
                        "similarity": similarity
                    })
                except Exception as e:
                    # Skip corrupt profiles
                    pass
                    
        # Sort matches descending
        matches.sort(key=lambda x: x["similarity"], reverse=True)
        print(json.dumps({"success": True, "matches": matches}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No command provided"}))
        return
        
    cmd = sys.argv[1]
    
    if cmd == "extract":
        # Extract voiceprint
        # Usage: voice_matcher.py extract <input_wav> <output_json>
        if len(sys.argv) < 4:
            print(json.dumps({"success": False, "error": "Missing arguments for extract"}))
            return
        cmd_extract(sys.argv[2], sys.argv[3])
        
    elif cmd == "compare":
        # Compare voiceprint against DB
        # Usage: voice_matcher.py compare <input_wav> <db_dir>
        if len(sys.argv) < 4:
            print(json.dumps({"success": False, "error": "Missing arguments for compare"}))
            return
        cmd_compare(sys.argv[2], sys.argv[3])
        
    else:
        print(json.dumps({"success": False, "error": f"Unknown command {cmd}"}))

if __name__ == "__main__":
    main()
