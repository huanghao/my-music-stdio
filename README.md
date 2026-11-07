# my-music-stdio

Music practice workstation research and small Python prototypes.

## System Dependencies

MIDI playback (`src/player.py`) uses [pyfluidsynth](https://pypi.org/project/pyFluidSynth/), which wraps the FluidSynth C library — not installed by `pip`, needs its own step:

```bash
brew install fluid-synth
```

This provides `libfluidsynth.dylib` (via the `/opt/homebrew/lib/` symlink `player.py` loads explicitly, since it's not on the default dyld search path). Without it, playback fails; nothing else in the app depends on it.

MIDI playback also needs a SoundFont file (`.sf2`) — the instrument samples FluidSynth plays. Without it, Jam and Vamp run but produce **no sound**, and `/api/soundfonts` returns `[]`. It is not in the repo and not migrated with the data dir; put it at:

```
~/workspace/my-store/my-music-stdio-data/soundfonts/Timbres of Heaven (XGM) 4.00(G).sf2
```

- Source: Timbres Of Heaven (XGM) 4.00, by Don Allen, from https://midkar.com/SoundFonts/index.html — direct link `https://midkar.com/SoundFonts/Timbres%20of%20Heaven%20(XGM)%204.00(G).7z` (about 285 MiB archive, `.sf2` is about 419 MiB).
- The download is a `.7z` archive: extract it with 7-Zip (`7zz x`), or `py7zr` in Python, and copy the `.sf2` into the path above.
- License: the author's page says the file may not be redistributed without written permission; it's for personal use only. Don't commit it to the repo.
- Any other `.sf2` can be used instead: drop it into the same folder and pick it on the Preferences page.

## Environment Variables / Secrets

The Agent 助教 feature needs at least one provider's API key exported before starting the server — `KIMI_API_KEY` (from the Kimi Code Console) for the default `kc` provider. Provider list lives in `data_dir()/agent-backends.yaml` (see `src/data_dir.py`), falling back to the defaults in `src/agent_client.py`'s `_default_providers()` when that file doesn't exist yet. Everything else in the app works without any of this.

## Python Environment

This project targets Python 3.12.

Recommended local interpreter:

```bash
/Users/huanghao/miniconda3/envs/3.12/bin/python
```

Create a project-specific conda environment:

```bash
conda env create -f environment.yml
conda activate my-music-stdio
```

Install or refresh Python dependencies:

```bash
python -m pip install -r requirements.txt
```

Development dependencies, when added, should go in `requirements-dev.txt`:

```bash
python -m pip install -r requirements-dev.txt
```

The current Python prototype uses `matplotlib` to render waveform previews.

Run the synth waveform demo:

```bash
python src/synth_wave_demo.py
```
