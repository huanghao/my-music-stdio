# my-music-stdio

Music practice workstation research and small Python prototypes.

## System Dependencies

MIDI playback (`src/player.py`) uses [pyfluidsynth](https://pypi.org/project/pyFluidSynth/), which wraps the FluidSynth C library — not installed by `pip`, needs its own step:

```bash
brew install fluid-synth
```

This provides `libfluidsynth.dylib` (via the `/opt/homebrew/lib/` symlink `player.py` loads explicitly, since it's not on the default dyld search path). Without it, playback fails; nothing else in the app depends on it.

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
