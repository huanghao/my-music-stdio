"""PDF text extraction for the floating agent assistant's read_pdf tool.

Kept free of the pydantic_ai import chain so it's unit-testable without the
agent providers installed. The tool wrapper lives in src/agent_client.py and
only injects the materials-store path resolver.
"""

from pathlib import Path
from typing import Callable

try:
    import pypdf
except ImportError:  # optional capability: everything but read_pdf keeps working
    pypdf = None

OUTPUT_LIMIT = 8000


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... [truncated {len(text) - limit} chars]"


def read_material_pdf(
    material_id: str,
    start_page: int = 1,
    end_page: int = 0,
    *,
    path_for: Callable[[str], "Path | None"],
) -> str:
    """Extract page-numbered text from a materials-library PDF.

    Same "errors are protocol messages, never exceptions" contract as the
    read tool in agent_client: every failure returns an "Error: ..." string
    for the model to react to. `path_for` resolves a material id to a file
    path (MaterialsStore.path_for) — injected so this module stays
    store-agnostic.
    """
    try:
        if pypdf is None:
            return "Error: pypdf is not installed on the server"
        path = path_for(material_id)
        if path is None:
            return f"Error: unknown material id: {material_id}"
        if path.suffix.lower() != ".pdf":
            return f"Error: not a PDF: {material_id}"
        reader = pypdf.PdfReader(str(path))
        total = len(reader.pages)
        start = min(max(1, start_page), total)
        end = min(end_page if end_page >= start else total, total)
        texts = [(reader.pages[i].extract_text() or "") for i in range(start - 1, end)]
        if not any(t.strip() for t in texts):
            return (
                "(no extractable text — this PDF is likely scanned images; "
                "text extraction doesn't apply)"
            )
        parts = [f"--- page {start + i}/{total} ---\n{t}" for i, t in enumerate(texts)]
        return _clip("\n".join(parts).strip(), OUTPUT_LIMIT)
    except Exception as e:
        return f"Error: {type(e).__name__}: {e}"
