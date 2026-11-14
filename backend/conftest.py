import sys
from pathlib import Path

# The edge_gateway package lives at the repository root, next to backend/.
_ROOT = str(Path(__file__).resolve().parents[1])
if _ROOT not in sys.path:
    sys.path.append(_ROOT)
