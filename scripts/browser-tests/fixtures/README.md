# Synthetic media fixtures

Generated locally with FFmpeg for automated tests. No personal files or third-party media.

- `sample.png`: 128×96 solid purple image.
- `sample.wav`: one second of a generated 440 Hz sine wave, PCM.
- `sample.mp4`: one second of solid purple frames, H.264, no audio.

Tests check actual decoding/playback, byte-for-byte export, durable storage, and binary transfer.
