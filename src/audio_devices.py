"""CoreAudio output-device enumeration for server-side FluidSynth playback.

The web UI's output-device picker (fbOutput in web/fb-audio.js) can only
redirect browser-generated audio via AudioContext.setSinkId. Jam/Vamp play
server-side through FluidSynth's coreaudio driver, which needs the CoreAudio
device *name* (setting `audio.coreaudio.device`). Browser deviceIds don't map
to CoreAudio, but their labels do match CoreAudio names — except that Chromium
appends the USB vendor:product id to USB devices ("Scarlett Solo USB
(1235:8211)"), which _match() strips. The frontend sends the label with each
/api/play request and resolve_output_device() validates it against what the
machine actually has before handing it to Player.
"""

import json
import logging
import re
import subprocess
import time

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = 60.0
_cache: list[str] = []
_cache_at: float = 0.0

# Chromium suffixes USB audio device labels with the vendor:product id, e.g.
# "Scarlett Solo USB (1235:8211)" — CoreAudio knows the same device as plain
# "Scarlett Solo USB".
_USB_VID_PID_SUFFIX = re.compile(r"\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)$")


def _match(name: str, devices: list[str]) -> str | None:
    """Return the CoreAudio device name for a browser label, or None."""
    if name in devices:
        return name
    stripped = _USB_VID_PID_SUFFIX.sub("", name)
    if stripped != name and stripped in devices:
        return stripped
    return None


def _enumerate_output_devices() -> list[str]:
    try:
        r = subprocess.run(
            ["system_profiler", "SPAudioDataType", "-json"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        data = json.loads(r.stdout)
        items = data["SPAudioDataType"][0].get("_items", [])
        return [
            it["_name"]
            for it in items
            if "_name" in it and "coreaudio_device_output" in it
        ]
    except (subprocess.SubprocessError, json.JSONDecodeError, KeyError, IndexError) as e:
        logger.warning("output-device enumeration failed: %s", e)
        return []


def list_output_devices() -> list[str]:
    """Names of CoreAudio devices with output channels, cached for 60s —
    system_profiler takes 1-2s, too slow to run on every /api/play."""
    global _cache, _cache_at
    if time.monotonic() - _cache_at > _CACHE_TTL_SEC:
        _cache = _enumerate_output_devices()
        _cache_at = time.monotonic()
    return _cache


def resolve_output_device(name: str | None) -> str | None:
    """Validate a browser-supplied device label against real hardware.

    Returns the matching CoreAudio device name (a Chromium USB vid:pid suffix
    is stripped along the way), or None (system default) for empty input or a
    device that isn't there — a stale/unmatched name falls back to the default
    output rather than breaking playback. A miss re-enumerates once to catch
    hot-plugged interfaces."""
    if not name:
        return None
    match = _match(name, list_output_devices())
    if match:
        return match
    # Cache miss: maybe the interface was just plugged in — bypass the cache once.
    global _cache, _cache_at
    _cache = _enumerate_output_devices()
    _cache_at = time.monotonic()
    match = _match(name, _cache)
    if match:
        return match
    logger.warning("output device %r not found, falling back to system default", name)
    return None
