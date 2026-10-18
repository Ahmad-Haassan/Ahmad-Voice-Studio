import os
import sys
import base64
import json
import time
import subprocess
import threading
from pathlib import Path

# Set working directory to app folder
BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)

import webview
from engine import engine, clean_and_normalize_audio

OUTPUTS_DIR = BASE_DIR / "outputs"
TEMP_DIR = BASE_DIR / "temp"
OUTPUTS_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

class StudioAPI:
    def __init__(self):
        self._window = None
        self._current_ref_audio = None
        self._cancel_requested = False
        self._is_generating = False

    def set_window(self, window):
        self._window = window

    def ping(self):
        return {
            "status": "ready" if engine.is_ready else "initializing",
            "device": engine.device.upper(),
            "name": "Ahmad Voice Studio",
            "version": "1.2.0"
        }

    def init_engine_background(self):
        """Asynchronously warm up engine on startup"""
        def run_warmup():
            try:
                engine.initialize(status_callback=lambda msg: self._send_status(msg))
                self._send_status("Engine ready!")
            except Exception as e:
                self._send_status(f"Init notice: {e}")

        t = threading.Thread(target=run_warmup, daemon=True)
        t.start()
        return True

    def _send_status(self, message: str):
        if self._window:
            safe_msg = json.dumps(message)
            self._window.evaluate_js(f"window.onEngineStatusUpdate && window.onEngineStatusUpdate({safe_msg});")

    def cancel_generation(self) -> dict:
        """Interrupt and cancel ongoing voice synthesis"""
        if self._is_generating:
            self._cancel_requested = True
            self._send_status("Cancelling generation...")
            return {"success": True, "message": "Cancellation requested"}
        return {"success": False, "message": "No active generation to cancel"}

    def save_recorded_audio(self, base64_data: str) -> dict:
        """Receive base64 audio data from browser MediaRecorder and normalize to 24kHz WAV"""
        try:
            if "," in base64_data:
                base64_data = base64_data.split(",")[1]
            audio_bytes = base64.b64decode(base64_data)

            raw_filename = f"raw_record_{int(time.time())}.wav"
            clean_filename = f"mic_enhanced_{int(time.time())}.wav"
            
            raw_path = TEMP_DIR / raw_filename
            clean_path = TEMP_DIR / clean_filename

            with open(raw_path, "wb") as f:
                f.write(audio_bytes)

            # Normalize using ffmpeg for high fidelity
            clean_and_normalize_audio(str(raw_path), str(clean_path), boost_volume=True, denoise=True)
            
            self._current_ref_audio = str(clean_path)
            
            # Read clean audio as base64 for browser preview
            with open(clean_path, "rb") as f:
                preview_b64 = base64.b64encode(f.read()).decode("utf-8")

            return {
                "success": True,
                "file_path": str(clean_path),
                "filename": "Microphone Voice (Enhanced)",
                "size_kb": round(clean_path.stat().st_size / 1024, 1),
                "audio_preview": f"data:audio/wav;base64,{preview_b64}"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def select_audio_file(self) -> dict:
        """Open native Windows file dialog to choose a reference voice file"""
        if not self._window:
            return {"success": False, "error": "Window not ready"}

        file_types = ("Audio Files (*.wav;*.mp3;*.m4a;*.flac;*.ogg;*.webm)", "All Files (*.*)")
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=file_types
        )
        if result and len(result) > 0:
            selected_path = result[0]
            clean_filename = f"norm_{int(time.time())}_{Path(selected_path).stem}.wav"
            clean_path = str(TEMP_DIR / clean_filename)

            # Auto-normalize uploaded file
            clean_and_normalize_audio(selected_path, clean_path, boost_volume=True, denoise=True)
            self._current_ref_audio = clean_path

            # Read clean audio as base64 for browser preview
            with open(clean_path, "rb") as f:
                preview_b64 = base64.b64encode(f.read()).decode("utf-8")

            return {
                "success": True,
                "file_path": clean_path,
                "filename": os.path.basename(selected_path),
                "size_kb": round(os.path.getsize(clean_path) / 1024, 1),
                "audio_preview": f"data:audio/wav;base64,{preview_b64}"
            }
        return {"success": False, "cancelled": True}

    def generate_speech(
        self,
        ref_audio_path: str,
        ref_text: str,
        gen_text: str,
        speed: float = 1.0,
        nfe_step: int = 20,
        cfg_strength: float = 2.0,
        cross_fade_duration: float = 0.15,
        remove_silence: bool = True,
        boost_volume: bool = True,
        denoise_mic: bool = True,
        seed: int = -1
    ) -> dict:
        """Synthesize voice using F5-TTS CPU engine with cancel capability"""
        try:
            self._cancel_requested = False
            self._is_generating = True

            if not ref_audio_path:
                ref_audio_path = self._current_ref_audio

            if not ref_audio_path or not os.path.exists(ref_audio_path):
                return {"success": False, "error": "Please provide reference voice audio."}

            if not gen_text or not gen_text.strip():
                return {"success": False, "error": "Please enter the text you want the voice to say."}

            timestamp = int(time.time())
            clean_name = f"voice_clone_{timestamp}.wav"
            output_file = str(OUTPUTS_DIR / clean_name)

            def status_reporter(msg):
                self._send_status(msg)

            def is_cancelled():
                return self._cancel_requested

            res = engine.clone_and_speak(
                ref_audio_path=ref_audio_path,
                ref_text=ref_text,
                gen_text=gen_text,
                output_file_path=output_file,
                speed=float(speed),
                nfe_step=int(nfe_step),
                cfg_strength=float(cfg_strength),
                cross_fade_duration=float(cross_fade_duration),
                remove_silence=bool(remove_silence),
                boost_volume=bool(boost_volume),
                denoise_mic=bool(denoise_mic),
                seed=int(seed),
                status_callback=status_reporter,
                cancel_checker=is_cancelled,
            )

            # Convert generated wav to base64 for instant HTML5 playback
            with open(output_file, "rb") as f:
                b64_audio = base64.b64encode(f.read()).decode("utf-8")

            return {
                "success": True,
                "filename": clean_name,
                "output_path": output_file,
                "duration": res["duration"],
                "ref_text": res["ref_text"],
                "seed": res["seed"],
                "audio_base64": f"data:audio/wav;base64,{b64_audio}",
            }
        except InterruptedError:
            return {"success": False, "error": "Generation was cancelled by user.", "cancelled": True}
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(e)}
        finally:
            self._is_generating = False
            self._cancel_requested = False

    def open_outputs_folder(self):
        """Open outputs directory in Windows Explorer"""
        try:
            os.startfile(str(OUTPUTS_DIR))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_history(self) -> list:
        """Return list of previously generated audio creations with base64 for replay"""
        items = []
        try:
            for p in sorted(OUTPUTS_DIR.glob("*.wav"), key=os.path.getmtime, reverse=True)[:20]:
                try:
                    with open(p, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode("utf-8")
                    items.append({
                        "filename": p.name,
                        "path": str(p),
                        "size_kb": round(p.stat().st_size / 1024, 1),
                        "time": time.strftime("%I:%M %p • %b %d", time.localtime(p.stat().st_mtime)),
                        "audio_base64": f"data:audio/wav;base64,{b64}"
                    })
                except Exception:
                    continue
        except Exception as e:
            print("History error:", e)
        return items

    def delete_history_item(self, filename: str) -> dict:
        """Delete an audio file from history"""
        try:
            target = OUTPUTS_DIR / os.path.basename(filename)
            if target.exists():
                target.unlink()
                return {"success": True}
            return {"success": False, "error": "File not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}

def main():
    api = StudioAPI()
    ui_path = (BASE_DIR / "ui" / "index.html").resolve()

    window = webview.create_window(
        title="Ahmad Voice Studio - Neural Voice Cloning Pro",
        url=str(ui_path),
        js_api=api,
        width=1280,
        height=880,
        min_size=(1020, 720),
        background_color="#0b1120",
        text_select=False,
    )
    api.set_window(window)

    threading.Timer(0.8, api.init_engine_background).start()

    webview.start(debug=False)

if __name__ == "__main__":
    main()
