"""Print an isolated package path, preserving the repository's published IDs.
Add --storage-candidate to include the comparison fixture ONLY in that copy.
"""
import argparse
import pathlib
import re
import shutil
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--storage-candidate", action="store_true")
args = parser.parse_args()
scripts = pathlib.Path(__file__).resolve().parent
source = scripts.parent.parent / "contracts" / "protocol"
destination = pathlib.Path(tempfile.mkdtemp(prefix="fractalmind-v020-contract-"))
shutil.copytree(source, destination, dirs_exist_ok=True, ignore=shutil.ignore_patterns("build", "Move.lock"))
manifest = destination / "Move.toml"
text = re.sub(r'^published-at = .*\n', '', manifest.read_text(), flags=re.M)
text = re.sub(r'fractalmind_protocol = "0x[0-9a-f]+"', 'fractalmind_protocol = "0x0"', text)
manifest.write_text(text)
if args.storage_candidate:
    shutil.copyfile(scripts / "fixtures" / "storage_candidate.move", destination / "sources" / "storage_candidate.move")
print(destination)
