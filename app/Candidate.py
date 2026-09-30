class Candidate:
    """A ballot option. `index` is the on-chain outcome_index (assigned by ElectionInit)."""

    def __init__(self, name, index=None):
        self.name = name
        self.index = index
        self.votes_received = 0  # filled in from on-chain data by the tally

    def __str__(self):
        return f"📜 Candidate #{self.index}: {self.name}"
