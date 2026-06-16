from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import torch


MODEL_ROOT = Path(os.environ.get("EEG_MODEL_ROOT", r"F:\CJZProjectFile\EEG_PredictStokeDLModel"))
MODEL_GROUP = os.environ.get("EEG_MODEL_GROUP", "residualaware_highrank_swa_clsalpha1")
if str(MODEL_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(MODEL_ROOT / "src"))

from eeg_recovery.metadata.subjects import normalize_subject_id
from eeg_recovery.training.train_supervised import SupervisedFeatureRecord, _make_batch


def load_module_from_file(name: str, script_path: Path):
    spec = importlib.util.spec_from_file_location(name, script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_residual_training_module():
    return load_module_from_file(
        "neuro_predict_residual_training",
        MODEL_ROOT / "scripts" / "30_train_residual_aware_patient_barlow.py",
    )


def load_explain_module():
    module = load_module_from_file(
        "neuro_predict_explain_helpers",
        MODEL_ROOT / "scripts" / "31_explain_residual_aware_ssl_cnn.py",
    )
    module._load_residual_training_module = load_residual_training_module
    return module


def load_npz_array(file_path: str, key: str) -> np.ndarray:
    with np.load(file_path, allow_pickle=False) as payload:
        return np.asarray(payload[key], dtype=np.float32)


def feature_record(package: dict) -> SupervisedFeatureRecord:
    subject_code = normalize_subject_id(str(package["subjectCode"]))
    by_kind_state: dict[tuple[str, str], str] = {}
    for artifact in package["inputs"]["featureArtifacts"]:
        by_kind_state[(artifact["kind"], artifact["state"])] = artifact["filePath"]

    psd_eo = load_npz_array(by_kind_state[("PSD", "EO")], "psd")
    psd_ec = load_npz_array(by_kind_state[("PSD", "EC")], "psd")
    wpli_eo = load_npz_array(by_kind_state[("FC", "EO")], "wpli")
    wpli_ec = load_npz_array(by_kind_state[("FC", "EC")], "wpli")

    return SupervisedFeatureRecord(
        subject_id=subject_code,
        label=0,
        eo=psd_eo,
        ec=psd_ec,
        modalities={
            "psd": (psd_eo, psd_ec),
            "wpli": (wpli_eo, wpli_ec),
        },
    )


def checkpoint_paths(subject_code: str) -> list[Path]:
    root = MODEL_ROOT / "results" / "checkpoints" / "supervised" / MODEL_GROUP
    paths = sorted(root.glob(f"{MODEL_GROUP}_seed*_fold*_test_{subject_code}.pt"))
    if not paths:
        raise FileNotFoundError(f"No supervised fold checkpoints found for {subject_code} under {root}")
    return paths


def seed_from_path(path: Path) -> int:
    match = re.search(r"_seed(\d+)_", path.name)
    return int(match.group(1)) if match else -1


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python predict_recovery.py <prediction_task_package.json>")

    package_path = Path(sys.argv[-1])
    package = json.loads(package_path.read_text(encoding="utf-8-sig"))
    subject_code = normalize_subject_id(str(package["subjectCode"]))
    threshold = float(package.get("request", {}).get("threshold") or 0.5)
    label_definition = str(package["request"]["labelDefinition"])
    result_path = Path(package["outputs"]["resultPath"])
    device = torch.device(os.environ.get("EEG_PREDICT_DEVICE", "cpu"))
    helpers = load_explain_module()
    record = feature_record(package)

    rows: list[dict] = []
    probabilities: list[float] = []
    for checkpoint_path in checkpoint_paths(subject_code):
        payload = helpers._load_checkpoint(checkpoint_path, device)
        model = helpers._build_model_from_metadata(payload["metadata"], payload["state_dict"], device)
        scaler = helpers._scaler_from_payload(payload["state_scaler"])
        batch = _make_batch([record], scaler, device, "multimodal")
        with torch.no_grad():
            outputs = model(batch)
            probability = float(outputs["classification_probability"].detach().cpu().numpy()[0, 0])
        probabilities.append(probability)
        rows.append(
            {
                "seed": seed_from_path(checkpoint_path),
                "checkpoint": str(checkpoint_path),
                "probability": probability,
            }
        )

    mean_probability = float(np.mean(probabilities))
    predicted_class = "比例恢复" if mean_probability >= threshold else "恢复不良"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(
        json.dumps(
            {
                "prediction": {
                    "predictedClass": predicted_class,
                    "probability": mean_probability,
                    "threshold": threshold,
                    "labelDefinition": label_definition,
                },
                "provenance": {
                    "modelGroup": MODEL_GROUP,
                    "checkpointCount": len(rows),
                    "subjectCode": subject_code,
                    "perSeed": rows,
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote prediction result to {result_path}")


if __name__ == "__main__":
    main()
