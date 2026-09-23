#!/usr/bin/env python3
import argparse
import base64
from pathlib import Path


def read_jpeg_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as f:
        if f.read(2) != b"\xFF\xD8":
            raise ValueError("Input is not a JPEG file.")

        while True:
            marker_start = f.read(1)
            if not marker_start:
                break
            if marker_start != b"\xFF":
                continue

            marker = f.read(1)
            while marker == b"\xFF":
                marker = f.read(1)

            if not marker:
                break

            code = marker[0]
            if code in (0xD8, 0xD9):
                continue

            segment_length_bytes = f.read(2)
            if len(segment_length_bytes) != 2:
                break
            segment_length = int.from_bytes(segment_length_bytes, "big")
            if segment_length < 2:
                break

            if code in (0xC0, 0xC1, 0xC2, 0xC3):
                data = f.read(5)
                if len(data) != 5:
                    break
                height = int.from_bytes(data[1:3], "big")
                width = int.from_bytes(data[3:5], "big")
                return width, height

            f.seek(segment_length - 2, 1)

    raise ValueError("Could not read JPEG dimensions.")


def convert_jpg_to_svg(input_path: Path, output_path: Path) -> None:
    width, height = read_jpeg_size(input_path)
    encoded = base64.b64encode(input_path.read_bytes()).decode("ascii")
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        f'  <image width="{width}" height="{height}" href="data:image/jpeg;base64,{encoded}" />\n'
        "</svg>\n"
    )
    output_path.write_text(svg, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fast and dirty JPG-to-SVG converter (embeds the JPG as base64)."
    )
    parser.add_argument("input", type=Path, help="Path to input .jpg/.jpeg file")
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="Path to output .svg file (defaults to input name + .svg)",
    )
    args = parser.parse_args()

    input_path = args.input
    if not input_path.exists():
        raise SystemExit(f"Input file not found: {input_path}")

    output_path = args.output or input_path.with_suffix(".svg")
    convert_jpg_to_svg(input_path, output_path)
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
