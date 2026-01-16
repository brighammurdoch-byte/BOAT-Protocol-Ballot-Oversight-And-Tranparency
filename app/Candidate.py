class Candidate:
    def __init__(self, name):
        self.name = name
        self.votes_received = 0 # (Optional) Just for local tracking if you want

    def __str__(self):
        return f"📜 Candidate: {self.name}"