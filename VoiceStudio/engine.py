import os
import sys
import json
import time
import random
import subprocess
import torch
import soundfile as sf
import torchaudio
from pathlib import Path
from importlib.resources import files

# Add SEARCH/src and D:\F5-TTS-CPU\src to sys.path
for p in [Path(r"c:\Users\Ahmad\OneDrive\Desktop\SEARCH\src"), Path(r"D:\F5-TTS-CPU\src")]:
    if str(p) not in sys.path and p.exists():
        sys.path.insert(0, str(p))

from cached_path import cached_path
from f5_tts.infer.utils_infer import (
    load_model,
    load_vocoder,
    preprocess_ref_audio_text,
    infer_process,
    remove_silence_for_generated_wav,
    transcribe,
)
from f5_tts.model import DiT

DEFAULT_MODEL_CFG = [
    "hf://SWivid/F5-TTS/F5TTS_v1_Base/model_1250000.safetensors",
    "hf://SWivid/F5-TTS/F5TTS_v1_Base/vocab.txt",
    json.dumps(dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4)),
]

def clean_and_normalize_audio(input_path: str, output_path: str, boost_volume: bool = True, denoise: bool = True) -> str:
    """
    Use ffmpeg to convert any audio (WebM, MP3, M4A, OGG, WAV) into pristine 24kHz mono PCM WAV.
    Applies highpass/lowpass filter to remove mic rumble/hiss and dynamic normalization.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    filters = []
    if denoise:
        # Filter low rumble below 80Hz and shrill hiss above 9500Hz
        filters.append("highpass=f=80")
        filters.append("lowpass=f=9500")
    if boost_volume:
        # Dynamic normalization to level speech volume evenly across syllables
        filters.append("volume=1.8")
        filters.append("dynaudnorm=p=0.9:m=5:s=12")
    
    af_arg = ",".join(filters) if filters else "volume=1.0"
    
    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-ar", "24000",
        "-ac", "1",
        "-af", af_arg,
        "-c:a", "pcm_s16le",
        str(output_path)
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return output_path
    except Exception as e:
        print(f"[Engine] ffmpeg normalization notice: {e}, falling back to original file")
        return input_path

class VoiceEngine:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.vocoder = None
        self.model = None
        self.is_ready = False
        # Set optimal CPU threads
        if self.device == "cpu":
            torch.set_num_threads(4)

    def initialize(self, status_callback=None):
        if self.is_ready:
            return

        def update(msg):
            if status_callback:
                status_callback(msg)
            print(f"[Engine] {msg}")

        update("Loading Vocoder (Vocos)...")
        self.vocoder = load_vocoder(device=self.device)

        update("Loading F5-TTS Base Model Checkpoint...")
        ckpt_path = str(cached_path(DEFAULT_MODEL_CFG[0]))
        vocab_path = str(files("f5_tts").joinpath("infer/examples/vocab.txt"))
        model_cfg = json.loads(DEFAULT_MODEL_CFG[2])

        self.model = load_model(
            DiT,
            model_cfg,
            ckpt_path,
            vocab_file=vocab_path,
            device=self.device,
        )

        self.is_ready = True
        update("Voice Engine Ready!")

    def clone_and_speak(
        self,
        ref_audio_path: str,
        ref_text: str,
        gen_text: str,
        output_file_path: str,
        speed: float = 1.0,
        nfe_step: int = 20,
        cfg_strength: float = 2.0,
        cross_fade_duration: float = 0.15,
        remove_silence: bool = True,
        boost_volume: bool = True,
        denoise_mic: bool = True,
        seed: int = -1,
        status_callback=None,
        cancel_checker=None,
    ) -> dict:
        """
        Synthesize high-fidelity voice clone with enhanced audio clarity and cancellation support.
        """
        if not self.is_ready:
            self.initialize(status_callback)

        def check_abort():
            if cancel_checker and cancel_checker():
                raise InterruptedError("Generation cancelled by user.")

        def update(msg):
            check_abort()
            if status_callback:
                status_callback(msg)
            print(f"[Synthesis] {msg}")

        check_abort()

        # Seed setup
        if seed < 0 or seed > 2**31 - 1:
            seed = random.randint(0, 2**31 - 1)
        torch.manual_seed(seed)

        # Clean up quotes from text inputs
        ref_text = (ref_text or "").strip().strip('"\'“”')
        gen_text = (gen_text or "").strip().strip('"\'“”')

        # 1. Audio Normalization & Enhancement via FFmpeg
        update("Enhancing and standardizing reference audio...")
        temp_clean_path = str(Path(output_file_path).parent / f"clean_ref_{int(time.time() * 1000)}.wav")
        clean_audio = clean_and_normalize_audio(
            ref_audio_path,
            temp_clean_path,
            boost_volume=boost_volume,
            denoise=denoise_mic
        )

        check_abort()

        # 2. Reference Text Resolution
        if not ref_text:
            update("Auto-transcribing with Whisper (Tip: typing transcript speeds this up)...")
            try:
                ref_text = transcribe(clean_audio)
                update(f"Transcribed: \"{ref_text}\"")
            except Exception as e:
                update(f"Whisper fallback note: {e}")
                ref_text = "Hello world."

        check_abort()

        # 3. Reference Preprocessing
        update("Preprocessing voice acoustic features...")
        ref_audio_clean, ref_text_clean = preprocess_ref_audio_text(
            clean_audio,
            ref_text,
            show_info=update
        )

        check_abort()

        # 4. Neural Flow-Matching Generation with Pre-Forward Hook for Instant Abort
        hook_handle = None
        if hasattr(self.model, "transformer"):
            if hasattr(self.model.transformer, "clear_cache"):
                self.model.transformer.clear_cache()
            if cancel_checker:
                hook_handle = self.model.transformer.register_forward_pre_hook(lambda m, inp: check_abort())

        try:
            update(f"Synthesizing voice (Steps: {nfe_step}, Clarity/CFG: {cfg_strength}, Speed: {speed}x)...")
            final_wave, final_sample_rate, _ = infer_process(
                ref_audio_clean,
                ref_text_clean,
                gen_text,
                self.model,
                self.vocoder,
                speed=speed,
                nfe_step=nfe_step,
                cfg_strength=cfg_strength,
                cross_fade_duration=cross_fade_duration,
                show_info=update,
                device=self.device,
            )
        finally:
            if hook_handle:
                try:
                    hook_handle.remove()
                except Exception:
                    pass
            if hasattr(self.model, "transformer") and hasattr(self.model.transformer, "clear_cache"):
                try:
                    self.model.transformer.clear_cache()
                except Exception:
                    pass

        check_abort()

        # 5. Export and Post-Processing
        update("Exporting audio...")
        output_dir = os.path.dirname(output_file_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        sf.write(output_file_path, final_wave, final_sample_rate)

        if remove_silence:
            try:
                update("Trimming silence gaps...")
                remove_silence_for_generated_wav(output_file_path)
            except Exception as e:
                print(f"Silence trim note: {e}")

        # Clean temporary ref file
        if os.path.exists(temp_clean_path):
            try:
                os.remove(temp_clean_path)
            except Exception:
                pass

        # Calculate duration
        try:
            info = sf.info(output_file_path)
            duration = round(info.duration, 2)
        except Exception:
            duration = 0.0

        update(f"Complete! Generated {duration}s audio.")
        return {
            "success": True,
            "output_path": output_file_path,
            "duration": duration,
            "ref_text": ref_text_clean,
            "seed": seed
        }

# Global singleton engine instance
engine = VoiceEngine()
