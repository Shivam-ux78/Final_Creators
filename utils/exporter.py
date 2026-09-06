import csv
import json
from pathlib import Path
import pandas as pd

def export_data(data: list[dict], output_path_without_ext: str or Path, formats=('csv', 'xlsx', 'json')):
    """
    Exports a list of dictionary records to CSV, Excel (.xlsx), and JSON.
    """
    if not data:
        print("[!] No data to export.")
        return

    path = Path(output_path_without_ext)
    path.parent.mkdir(parents=True, exist_ok=True)

    if 'csv' in formats:
        csv_file = path.with_suffix('.csv')
        fieldnames = list(data[0].keys())
        with open(csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(data)
        print(f"[OK] Saved {len(data)} rows to CSV:   {csv_file}")

    if 'json' in formats:
        json_file = path.with_suffix('.json')
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"[OK] Saved {len(data)} rows to JSON:  {json_file}")

    if 'xlsx' in formats:
        xlsx_file = path.with_suffix('.xlsx')
        df = pd.DataFrame(data)
        df.to_excel(xlsx_file, index=False)
        print(f"[OK] Saved {len(data)} rows to Excel: {xlsx_file}")
