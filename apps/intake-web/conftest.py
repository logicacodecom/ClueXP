"""Make the co-located `api` package importable when running pytest from
apps/intake-web (matches how the app imports `api.*` at runtime)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
