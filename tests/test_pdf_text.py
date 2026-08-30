"""read_material_pdf (src/pdf_text.py) — the agent's read_pdf tool body.

The PDF fixtures are hand-built with pypdf generics (no reportlab dependency):
a blank page plus a raw text-draw content stream and a Helvetica resource.
"""

from pathlib import Path

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from src.pdf_text import OUTPUT_LIMIT, read_material_pdf


def _make_pdf(path: Path, pages: list) -> None:
    """pages: list of str (text page) or None (blank/image-like page)."""
    w = PdfWriter()
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    for text in pages:
        page = w.add_blank_page(width=612, height=792)
        if text is not None:
            stream = DecodedStreamObject()
            stream.set_data(f"BT /F1 24 Tf 72 700 Td ({text}) Tj ET".encode())
            page[NameObject("/Contents")] = stream
            page[NameObject("/Resources")] = DictionaryObject({
                NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})
            })
    with open(path, "wb") as f:
        w.write(f)


@pytest.fixture
def pdf_dir(tmp_path):
    return tmp_path


def _path_for(dir_):
    def resolve(material_id):
        p = dir_ / material_id
        return p if p.exists() else None
    return resolve


def test_extracts_page_numbered_text(pdf_dir):
    _make_pdf(pdf_dir / "score.pdf", ["Hello PDF", "Page two"])
    out = read_material_pdf("score.pdf", path_for=_path_for(pdf_dir))
    assert "--- page 1/2 ---" in out
    assert "Hello PDF" in out
    assert "--- page 2/2 ---" in out
    assert "Page two" in out


def test_page_range(pdf_dir):
    _make_pdf(pdf_dir / "score.pdf", ["one", "two", "three"])
    out = read_material_pdf("score.pdf", start_page=2, end_page=2, path_for=_path_for(pdf_dir))
    assert "two" in out
    assert "one" not in out and "three" not in out
    assert "page 2/3" in out


def test_unknown_material_id(pdf_dir):
    out = read_material_pdf("nope.pdf", path_for=_path_for(pdf_dir))
    assert out.startswith("Error: unknown material id")


def test_non_pdf_rejected(pdf_dir):
    (pdf_dir / "track.mp3").write_bytes(b"ID3")
    out = read_material_pdf("track.mp3", path_for=_path_for(pdf_dir))
    assert out.startswith("Error: not a PDF")


def test_scanned_pdf_reports_no_text(pdf_dir):
    _make_pdf(pdf_dir / "scan.pdf", [None])
    out = read_material_pdf("scan.pdf", path_for=_path_for(pdf_dir))
    assert "no extractable text" in out


def test_output_clipped(pdf_dir):
    _make_pdf(pdf_dir / "long.pdf", ["x" * (OUTPUT_LIMIT + 500)])
    out = read_material_pdf("long.pdf", path_for=_path_for(pdf_dir))
    assert len(out) <= OUTPUT_LIMIT + 100  # page header + truncation note
    assert "truncated" in out
