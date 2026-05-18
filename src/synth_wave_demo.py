#!/usr/bin/env python
"""Generate simple synth waveform demos as WAV files and a subplot overview."""

from __future__ import print_function

import argparse
import math
import os
import struct
import wave

SAMPLE_RATE = 44100
DURATION = 2.0
FREQ = 220.0
A4_MIDI_NOTE = 69
A4_FREQ = 440.0
C4_MIDI_NOTE = 60
E4_MIDI_NOTE = 64
G4_MIDI_NOTE = 67


def write_wav(path, samples):
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory)
    file = wave.open(path, "w")
    try:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for sample in samples:
            sample = max(-1.0, min(1.0, sample))
            frames += struct.pack("<h", int(sample * 32767))
        file.writeframes(bytes(frames))
    finally:
        file.close()


def plot_waveforms(outputs, path, preview_ms=40.0):
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory)

    mpl_config_dir = os.path.join("tmp", ".matplotlib")
    if not os.path.exists(mpl_config_dir):
        os.makedirs(mpl_config_dir)
    os.environ.setdefault("MPLCONFIGDIR", mpl_config_dir)

    import matplotlib.pyplot as plt

    preview_count = max(1, int(SAMPLE_RATE * (preview_ms / 1000.0)))
    rows = len(outputs)
    figure, axes = plt.subplots(
        rows,
        1,
        figsize=(10, max(2.0, rows * 1.35)),
        sharex=True,
        constrained_layout=True,
    )
    if rows == 1:
        axes = [axes]

    for axis, (filename, samples) in zip(axes, outputs):
        visible = samples[:preview_count]
        times_ms = [
            (float(index) / SAMPLE_RATE) * 1000.0 for index in range(len(visible))
        ]
        axis.plot(times_ms, visible, linewidth=1.0)
        axis.set_title(filename.replace(".wav", ""), loc="left", fontsize=9)
        axis.set_ylabel("amp")
        axis.set_ylim(-0.45, 0.45)
        axis.grid(True, linewidth=0.4, alpha=0.35)

    axes[-1].set_xlabel("time (ms)")
    figure.suptitle("Synth waveform previews", fontsize=12)
    figure.savefig(path, dpi=160)
    plt.close(figure)


def note_frequency(midi_note):
    return A4_FREQ * (2.0 ** ((midi_note - A4_MIDI_NOTE) / 12.0))


def envelope(index, total):
    attack = int(0.02 * SAMPLE_RATE)
    release = int(0.25 * SAMPLE_RATE)
    if index < attack:
        return float(index) / attack
    if index > total - release:
        return max(0.0, float(total - index) / release)
    return 1.0


def sine(time, freq):
    return math.sin(2 * math.pi * freq * time)


def saw(time, freq):
    phase = (freq * time) % 1.0
    return 2.0 * phase - 1.0


def square(time, freq):
    return 1.0 if (freq * time) % 1.0 < 0.5 else -1.0


def make_oscillator(waveform, freq):
    return lambda time: waveform(time, freq)


def lowpass(samples, cutoff_hz):
    # Simple one-pole low-pass filter; enough to demonstrate darker timbre.
    rc = 1.0 / (2 * math.pi * cutoff_hz)
    dt = 1.0 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    value = 0.0
    output = []
    for sample in samples:
        value = value + alpha * (sample - value)
        output.append(value)
    return output


def lowpass_sweep(
    samples,
    start_hz=200.0,
    end_hz=5000.0,
):
    value = 0.0
    output = []
    total = len(samples)
    for index, sample in enumerate(samples):
        ratio = float(index) / max(1, total - 1)
        cutoff = start_hz * ((end_hz / start_hz) ** ratio)
        rc = 1.0 / (2 * math.pi * cutoff)
        dt = 1.0 / SAMPLE_RATE
        alpha = dt / (rc + dt)
        value = value + alpha * (sample - value)
        output.append(value)
    return output


def render(oscillator, duration=DURATION, use_envelope=True):
    total = int(SAMPLE_RATE * duration)
    samples = []
    for index in range(total):
        time = float(index) / SAMPLE_RATE
        amp = envelope(index, total) if use_envelope else 1.0
        samples.append(0.4 * oscillator(time) * amp)
    return samples


def render_mix(oscillators, duration=DURATION):
    total = int(SAMPLE_RATE * duration)
    samples = []
    count = float(len(oscillators))
    for index in range(total):
        time = float(index) / SAMPLE_RATE
        value = 0.0
        for oscillator in oscillators:
            value += oscillator(time)
        samples.append(0.35 * (value / count) * envelope(index, total))
    return samples


def render_arpeggio(notes, note_duration=0.55, gap_duration=0.05):
    samples = []
    gap = [0.0] * int(SAMPLE_RATE * gap_duration)
    for note in notes:
        oscillator = make_oscillator(sine, note_frequency(note))
        samples.extend(render(oscillator, duration=note_duration))
        samples.extend(gap)
    return samples


def render_harmonic_stack(base_freq=FREQ):
    partials = [
        (1, 1.00),
        (2, 0.50),
        (3, 0.33),
        (4, 0.25),
        (5, 0.20),
    ]
    total = int(SAMPLE_RATE * DURATION)
    samples = []
    amp_sum = sum(amp for _, amp in partials)
    for index in range(total):
        time = float(index) / SAMPLE_RATE
        value = 0.0
        for multiple, amp in partials:
            value += amp * sine(time, base_freq * multiple)
        samples.append(0.4 * (value / amp_sum) * envelope(index, total))
    return samples


def main():
    parser = argparse.ArgumentParser(
        description="Generate sine/saw/square/filter demo WAV files.",
    )
    parser.add_argument(
        "--out-dir",
        default="tmp/synth_wave_demo",
        help="Directory for generated WAV files.",
    )
    parser.add_argument(
        "--plot-path",
        default=None,
        help="Path for the generated subplot PNG. Defaults to OUT_DIR/waveforms.png.",
    )
    args = parser.parse_args()

    out_dir = args.out_dir
    sine_samples = render(make_oscillator(sine, FREQ))
    saw_samples = render(make_oscillator(saw, FREQ))
    square_samples = render(make_oscillator(square, FREQ))
    c4_samples = render(make_oscillator(sine, note_frequency(C4_MIDI_NOTE)))
    c_major_notes = [C4_MIDI_NOTE, E4_MIDI_NOTE, G4_MIDI_NOTE]
    c_major_chord = render_mix(
        [make_oscillator(sine, note_frequency(note)) for note in c_major_notes]
    )

    outputs = [
        ("sine.wav", sine_samples),
        ("saw.wav", saw_samples),
        ("square.wav", square_samples),
        (
            "saw_no_envelope_click.wav",
            render(make_oscillator(saw, FREQ), use_envelope=False),
        ),
        ("saw_lowpass.wav", lowpass(saw_samples, 600.0)),
        ("saw_sweep.wav", lowpass_sweep(saw_samples)),
        ("c4_sine.wav", c4_samples),
        ("c_major_chord.wav", c_major_chord),
        ("c_major_arpeggio.wav", render_arpeggio(c_major_notes)),
        ("harmonic_stack.wav", render_harmonic_stack(FREQ)),
    ]

    for filename, samples in outputs:
        write_wav(os.path.join(out_dir, filename), samples)

    plot_path = args.plot_path or os.path.join(out_dir, "waveforms.png")
    plot_waveforms(outputs, plot_path)

    print("Generated {0} files in {1}".format(len(outputs), out_dir))
    for filename, _ in outputs:
        print("- {0}".format(os.path.join(out_dir, filename)))
    print("- {0}".format(plot_path))


if __name__ == "__main__":
    main()
