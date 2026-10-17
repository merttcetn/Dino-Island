#!/usr/bin/env python3
"""Inspect Dino Island's original little-endian static .mesh files without running the game."""
import argparse
import json
from pathlib import Path
import struct


def inspect_mesh(path):
    data = Path(path).read_bytes()
    offset = 0

    def read(fmt):
        nonlocal offset
        size = struct.calcsize('<' + fmt)
        values = struct.unpack_from('<' + fmt, data, offset)
        offset += size
        return values[0] if len(values) == 1 else values

    def string():
        nonlocal offset
        size = read('I')
        value = data[offset:offset + size].rstrip(b'\0').decode('cp1252')
        offset += size
        return value

    def stream(components, fmt='f'):
        nonlocal offset
        enabled, count = read('BI')
        if enabled not in (0, 1) or count > 1000000:
            raise ValueError(f'Invalid stream at {offset - 5}')
        values = struct.unpack_from('<' + fmt * count * components, data, offset)
        offset += count * components * 4
        return values

    present, version, checksum, magic, count = read('BIIII')
    if (present, version, magic) != (1, 3, 0x12345678):
        raise ValueError('Unsupported mesh header')
    meshes = []
    for _ in range(count):
        name = string()
        vertex_count = read('I')
        positions = read('f' * vertex_count * 3)
        index_count = read('I')
        indices = read('I' * index_count)
        if max(indices, default=0) >= vertex_count:
            raise ValueError('Index exceeds vertex count')
        uv, normals, colors = stream(2), stream(3), stream(1, 'I')
        materials = []
        for _ in range(read('I')):
            ambient, diffuse, power, specular, emissive, textured = read('IIfIIB')
            texture = string()
            material_name = string()
            materials.append(dict(name=material_name, texture=texture,
                                  ambient=ambient, diffuse=diffuse, power=power,
                                  specular=specular, emissive=emissive))
        face_count = read('I')
        material_indices = read('H' * face_count)
        reserved = read('IIII')
        meshes.append(dict(name=name, vertices=vertex_count, triangles=index_count // 3,
                           bounds=[dict(min=min(positions[a::3]), max=max(positions[a::3]))
                                   for a in range(3)],
                           uv=len(uv) // 2, normals=len(normals) // 3, colors=len(colors),
                           materials=materials, faces=face_count, reserved=reserved))
    if offset != len(data):
        raise ValueError(f'Parsed {offset} of {len(data)} bytes')
    return dict(path=str(path), bytes=len(data), checksum=checksum, meshes=meshes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+', type=Path)
    args = parser.parse_args()
    for path in args.paths:
        if path.is_dir():
            paths = sorted(path.rglob('*.mesh'))
        else:
            paths = [path]
        for mesh in paths:
            try:
                print(json.dumps(inspect_mesh(mesh)))
            except (ValueError, struct.error, UnicodeDecodeError) as error:
                print(json.dumps(dict(path=str(mesh), error=str(error))))
