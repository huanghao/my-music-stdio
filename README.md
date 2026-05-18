# my-music-stdio

Music practice workstation research and small Python prototypes.

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
