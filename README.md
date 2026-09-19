# ClassAll Platform

## Generate the local hackathon dataset

The generated inbox records and document attachments are intentionally excluded from Git.
Recreate the deterministic 520-email corpus after cloning with:

```bash
python data/generate.py --seed 42 --n 500 --out data
```
