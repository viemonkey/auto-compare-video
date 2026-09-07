import os
import sys
import argparse
import numpy as np

# Ensure src/ is in sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

def main():
    parser = argparse.ArgumentParser(description="VieNeu TTS CLI for Video Scaffold")
    parser.add_argument("--text", required=True, help="Text to speak")
    parser.add_argument("--out", required=True, help="Output MP3/WAV file path")
    parser.add_argument("--voice", default="Adam", help="Preset voice name (e.g. Adam, Bao, Ha, Minh) or path to 3-5s reference audio for cloning")
    args = parser.parse_args()

    try:
        import soundfile as sf
        from vieneu import Vieneu
    except ImportError as e:
        print(f"Error importing dependencies: {e}", file=sys.stderr)
        sys.exit(1)

    voice_input = args.voice.strip()
    voice_name = None
    ref_audio_path = None

    if os.path.isfile(voice_input):
        ref_audio_path = os.path.abspath(voice_input)
        print(f"🎤 Mode: Voice Cloning from reference audio '{ref_audio_path}'")
    else:
        voice_name = voice_input
        print(f"🗣️ Mode: Preset Voice '{voice_name}'")

    print(f"⏳ Synthesizing text: '{args.text[:40]}...'")
    
    # Initialize with ONNX backend for fast CPU inference on Mac
    tts = Vieneu(mode="v3turbo", backend="onnx", precision="fp32")

    if ref_audio_path:
        wav = tts.infer(text=args.text, ref_audio=ref_audio_path)
    else:
        # Check if requested preset exists, fallback to default if not found
        available_presets = list(tts._preset_voices.keys())
        if voice_name not in available_presets:
            print(f"⚠️ Voice '{voice_name}' not in presets {available_presets}. Falling back to default voice '{tts._default_voice}'.")
            voice_name = tts._default_voice
        wav = tts.infer(text=args.text, voice=voice_name)

    out_abs = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    
    # Save audio output via soundfile at 48kHz
    sf.write(out_abs, wav, samplerate=tts.sample_rate)
    print(f"✅ SUCCESS: Saved audio to '{out_abs}'")

if __name__ == "__main__":
    main()
