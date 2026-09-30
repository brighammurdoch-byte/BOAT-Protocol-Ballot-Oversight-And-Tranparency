"""Minimal non-interactive election: create → register 5 voters → vote → tally. See class_demo.py for the narrated version."""
import os

os.environ.setdefault("BOAT_NO_PAUSE", "1")

from class_demo import main  # noqa: E402

if __name__ == "__main__":
    main()
