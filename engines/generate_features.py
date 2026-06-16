from __future__ import annotations

import json
import os
import sys
from pathlib import Path


MODEL_ROOT = Path(os.environ.get("EEG_MODEL_ROOT", r"F:\CJZProjectFile\EEG_PredictStokeDLModel"))
if str(MODEL_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(MODEL_ROOT / "src"))

from eeg_recovery.features.connectivity import compute_connectivity_for_eeg_record, write_connectivity_feature
from eeg_recovery.features.psd import compute_psd_for_eeg_record, write_psd_feature
from eeg_recovery.io.index import EEGFileRecord


def affected_hand_from_contract(package: dict) -> str:
    side = ((package.get("contract") or {}).get("affectedSide") or "").strip().lower()
    return {"right": "右", "left": "左", "bilateral": "右"}.get(side, "右")


def make_record(package: dict, pair: dict) -> EEGFileRecord:
    subject_code = str(package["subjectCode"])
    state = str(pair["state"])
    return EEGFileRecord(
        group="patient",
        subject_id=subject_code,
        subject_key=subject_code,
        stage=str(pair.get("stage") or "基线"),
        state=state,
        set_path=Path(pair["setPath"]),
        fdt_path=Path(pair["fdtPath"]),
        is_supervised_subject=True,
    )


def feature_preview(array, *, source_path: Path) -> dict:
    return {
        "shape": list(array.shape),
        "mean": float(array.mean()),
        "std": float(array.std()),
        "source": str(source_path),
    }


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python generate_features.py <feature_generation_task_package.json>")

    package_path = Path(sys.argv[-1])
    package = json.loads(package_path.read_text(encoding="utf-8-sig"))
    output_root = Path(package["outputs"]["outputDirectory"])
    manifest_path = Path(package["outputs"]["manifestPath"])
    feature_kinds = set(package.get("request", {}).get("featureKinds") or ["PSD", "FC"])
    states = set(package.get("request", {}).get("states") or ["EO", "EC"])
    affected_hand = affected_hand_from_contract(package)

    artifacts: list[dict] = []
    for pair in package["inputs"]["eegStatePairs"]:
        state = str(pair["state"])
        if state not in states:
            continue
        record = make_record(package, pair)

        if "PSD" in feature_kinds:
            feature = compute_psd_for_eeg_record(record, affected_hand)
            file_path = write_psd_feature(feature, output_root)
            artifacts.append(
                {
                    "kind": "PSD",
                    "state": state,
                    "filePath": str(file_path),
                    "featureCount": int(feature.psd.shape[0] * feature.psd.shape[1]),
                    "params": {
                        "alignment": "right_affected_c3",
                        "shape": list(feature.psd.shape),
                        "frequencyBins": int(feature.frequency_bins.shape[0]),
                    },
                    "preview": feature_preview(feature.psd, source_path=Path(pair["setPath"])),
                }
            )

        if "FC" in feature_kinds:
            feature = compute_connectivity_for_eeg_record(record, affected_hand)
            file_path = write_connectivity_feature(feature, output_root)
            artifacts.append(
                {
                    "kind": "FC",
                    "state": state,
                    "filePath": str(file_path),
                    "featureCount": int(feature.wpli.shape[0]),
                    "params": {
                        "alignment": "right_affected_c3",
                        "metric": "wpli",
                        "shape": list(feature.wpli.shape),
                    },
                    "preview": feature_preview(feature.wpli, source_path=Path(pair["setPath"])),
                }
            )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "type": "feature_generation_manifest",
                "taskId": package.get("taskId"),
                "patientId": package.get("patientId"),
                "subjectCode": package.get("subjectCode"),
                "artifacts": artifacts,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(artifacts)} feature artifacts to {manifest_path}")


if __name__ == "__main__":
    main()
