import json
import subprocess

import pytest

import src.audio_devices as ad

CANNED = {
    "SPAudioDataType": [{
        "_name": "coreaudio_device",
        "_items": [
            {"_name": "MacBook Pro Microphone", "coreaudio_device_input": 1},
            {"_name": "MacBook Pro Speakers", "coreaudio_device_output": 2},
            {"_name": "Scarlett Solo USB",
             "coreaudio_device_input": 2, "coreaudio_device_output": 2},
            {"_name": "ZoomAudioDevice", "coreaudio_device_input": 2},
        ],
    }],
}


def _fake_run(payload):
    def run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")
    return run


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    monkeypatch.setattr(ad, "_cache", [])
    monkeypatch.setattr(ad, "_cache_at", 0.0)
    yield


def test_lists_only_devices_with_output_channels(monkeypatch):
    monkeypatch.setattr(ad.subprocess, "run", _fake_run(CANNED))
    assert ad.list_output_devices() == ["MacBook Pro Speakers", "Scarlett Solo USB"]


def test_enumeration_failure_returns_empty(monkeypatch):
    def boom(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, 10)
    monkeypatch.setattr(ad.subprocess, "run", boom)
    assert ad.list_output_devices() == []


def test_resolve_returns_name_when_present(monkeypatch):
    monkeypatch.setattr(ad.subprocess, "run", _fake_run(CANNED))
    assert ad.resolve_output_device("Scarlett Solo USB") == "Scarlett Solo USB"


def test_resolve_strips_chromium_usb_vid_pid_suffix(monkeypatch):
    # Chromium labels USB audio devices "Name (vid:pid)" — CoreAudio knows the
    # same device without the suffix.
    monkeypatch.setattr(ad.subprocess, "run", _fake_run(CANNED))
    assert ad.resolve_output_device("Scarlett Solo USB (1235:8211)") == "Scarlett Solo USB"


def test_resolve_does_not_strip_unrelated_parentheticals(monkeypatch):
    monkeypatch.setattr(ad.subprocess, "run", _fake_run(CANNED))
    assert ad.resolve_output_device("Scarlett Solo USB (backup)") is None


def test_resolve_empty_means_system_default(monkeypatch):
    monkeypatch.setattr(ad.subprocess, "run", _fake_run(CANNED))
    assert ad.resolve_output_device(None) is None
    assert ad.resolve_output_device("") is None


def test_resolve_unknown_device_reenumerates_then_falls_back(monkeypatch):
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        # second enumeration sees the hot-plugged interface
        payload = CANNED if len(calls) == 1 else {
            "SPAudioDataType": [{
                "_name": "coreaudio_device",
                "_items": CANNED["SPAudioDataType"][0]["_items"] + [
                    {"_name": "New Interface", "coreaudio_device_output": 2},
                ],
            }],
        }
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(ad.subprocess, "run", run)
    # prime the cache without the new device
    assert ad.list_output_devices() == ["MacBook Pro Speakers", "Scarlett Solo USB"]
    assert ad.resolve_output_device("New Interface") == "New Interface"
    assert len(calls) == 2


def test_resolve_genuinely_missing_device_falls_back_to_default(monkeypatch):
    monkeypatch.setattr(ad.subprocess, "run", _fake_run(CANNED))
    assert ad.resolve_output_device("No Such Device") is None
