from pathlib import Path
import sys
import zipfile

from docx import Document
from PIL import Image
from io import BytesIO


def main() -> None:
    path = Path(sys.argv[1])
    document = Document(path)

    print("PARAGRAPHS")
    for index, paragraph in enumerate(document.paragraphs):
        text = paragraph.text.strip()
        if text:
            print(f"{index:04d} [{paragraph.style.name}] {text}")

    print("\nTABLES")
    for table_index, table in enumerate(document.tables):
        print(f"-- TABLE {table_index} {len(table.rows)}x{len(table.columns)} --")
        for row_index, row in enumerate(table.rows):
            values = [cell.text.replace("\n", " / ").strip() for cell in row.cells]
            print(f"{row_index:03d}: " + " | ".join(values))

    print(f"\nSECTIONS {len(document.sections)}")
    print(f"INLINE_SHAPES {len(document.inline_shapes)}")

    print("\nMEDIA")
    with zipfile.ZipFile(path) as archive:
        media_names = sorted(name for name in archive.namelist() if name.startswith("word/media/"))
        for name in media_names:
            payload = archive.read(name)
            try:
                with Image.open(BytesIO(payload)) as image:
                    print(f"{name}: {image.format} {image.width}x{image.height} ({len(payload)} bytes)")
            except Exception:
                print(f"{name}: unknown ({len(payload)} bytes)")
            if len(sys.argv) > 2:
                output_dir = Path(sys.argv[2])
                output_dir.mkdir(parents=True, exist_ok=True)
                (output_dir / Path(name).name).write_bytes(payload)


if __name__ == "__main__":
    main()
