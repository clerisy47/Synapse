"""Generate synthetic fixtures in a NEW directory. Requires local qpdf for encryption."""
import pathlib
import shutil
import subprocess
import sys


def pdf(texts):
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for text in texts:
        page_id = len(objects) + 1
        kids.append(f"{page_id} 0 R")
        stream = (f"BT /F1 18 Tf 50 700 Td ({text}) Tj ET" if text else "").encode("ascii")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>".encode("ascii"))
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream")
    objects[1] = f"<< /Type /Pages /Count {len(kids)} /Kids [{' '.join(kids)}] >>".encode("ascii")
    data = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{number} 0 obj\n".encode("ascii") + obj + b"\nendobj\n"
    xref = len(data)
    data += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("ascii")
    data += b"".join(f"{offset:010d} 00000 n \n".encode("ascii") for offset in offsets[1:])
    data += f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    return data


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 spikes/pdfjs-probe/fixtures.py <NEW fixture directory>")
    qpdf = shutil.which("qpdf")
    if not qpdf:
        raise SystemExit("qpdf is required to generate the synthetic encrypted fixture.")
    destination = pathlib.Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "text.pdf").write_bytes(pdf([f"Gate B synthetic page {n}: searchable text layer." for n in range(1, 4)]))
    (destination / "blank.pdf").write_bytes(pdf(["", "", ""]))
    (destination / "corrupt.pdf").write_bytes(b"Gate B deliberately invalid PDF bytes")
    (destination / "passage.md").write_text("# Gate B fixture\n\nPrefix inserted before the citation.\n\nGate B passage\ncontinued on the next line\n\nEnd.\n", encoding="utf-8")
    subprocess.run([qpdf, "--encrypt", "gate-b-user", "gate-b-owner", "256", "--", str(destination / "text.pdf"), str(destination / "encrypted.pdf")], check=True)
    print("Generated four synthetic PDFs and one Markdown fixture.")
