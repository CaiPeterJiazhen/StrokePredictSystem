from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def load_feature(package: dict, kind: str, state: str) -> tuple[dict, np.lib.npyio.NpzFile]:
    for artifact in package["inputs"]["featureArtifacts"]:
        if artifact["kind"] == kind and artifact["state"] == state:
            return artifact, np.load(artifact["filePath"], allow_pickle=False)
    raise FileNotFoundError(f"Missing {kind} {state} feature artifact")


def save_prediction_panel(package: dict, output_dir: Path) -> dict:
    prediction = package["prediction"]
    file_path = output_dir / f"{package['subjectCode']}_prediction_summary.png"
    probability = float(prediction["probability"])
    fig, ax = plt.subplots(figsize=(5.2, 3.2))
    ax.barh(["比例恢复概率"], [probability], color="#2563eb")
    ax.axvline(float(prediction["threshold"]), color="#ef4444", linestyle="--", linewidth=1)
    ax.set_xlim(0, 1)
    ax.set_xlabel("Probability")
    ax.set_title(f"{package['subjectCode']} {prediction['predictedClass']}")
    fig.tight_layout()
    fig.savefig(file_path, dpi=180)
    plt.close(fig)
    return {
        "artifactType": "patient_shap",
        "title": f"{package['subjectCode']} prediction contribution summary",
        "method": "ResidualAware_SSL_CNN 10-seed fold checkpoint inference",
        "filePath": str(file_path),
        "topFeatures": [
            {"name": "Mean 10-seed EEG probability", "value": probability, "direction": "促进比例恢复"},
        ],
        "preview": {"probability": probability, "predictedClass": prediction["predictedClass"]},
    }


def save_psd_topomap(package: dict, output_dir: Path) -> dict:
    artifact, payload = load_feature(package, "PSD", "EO")
    psd = np.asarray(payload["psd"], dtype=float)
    frequency_bins = np.asarray(payload["frequency_bins"], dtype=float)
    channels = [str(item) for item in payload["channel_names_after_alignment"]]
    alpha_mask = (frequency_bins >= 8.0) & (frequency_bins <= 13.0)
    values = psd[:, alpha_mask].mean(axis=1)
    file_path = output_dir / f"{package['subjectCode']}_psd_alpha_topomap.png"

    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    plotted = False
    try:
      import mne

      keep = [index for index, channel in enumerate(channels) if channel.upper() not in {"CB1", "CB2"}]
      plot_channels = [channels[index] for index in keep]
      plot_values = values[keep]
      info = mne.create_info(plot_channels, sfreq=float(payload["sampling_rate"]), ch_types="eeg")
      info.set_montage("standard_1005", match_case=False, on_missing="ignore")
      mne.viz.plot_topomap(plot_values, info, axes=ax, show=False, cmap="viridis", contours=6)
      plotted = True
    except Exception:
      pass
    if not plotted:
      image = ax.imshow(values.reshape(1, -1), aspect="auto", cmap="viridis")
      ax.set_yticks([])
      ax.set_xlabel("Canonical channels")
      fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04)
    ax.set_title("EO Alpha PSD topomap")
    fig.tight_layout()
    fig.savefig(file_path, dpi=180)
    plt.close(fig)
    payload.close()
    return {
        "artifactType": "psd_heatmap",
        "title": f"{package['subjectCode']} EO Alpha PSD TopMap",
        "method": "MNE standard_1005 topomap from generated PSD feature" if plotted else "PSD channel heatmap fallback",
        "filePath": str(file_path),
        "topFeatures": [
            {"name": "EO Alpha PSD mean", "value": float(values.mean()), "direction": "EEG feature"},
            {"name": "EO Alpha PSD max", "value": float(values.max()), "direction": "EEG feature"},
        ],
        "preview": {"sourceFeature": artifact["filePath"], "channels": len(channels), "band": "Alpha 8-13 Hz"},
    }


def save_connectivity(package: dict, output_dir: Path) -> dict:
    artifact, payload = load_feature(package, "FC", "EC")
    wpli = np.asarray(payload["wpli"], dtype=float)
    edge_list = np.asarray(payload["edge_list"])
    band_names = [str(item) for item in payload["band_names"]]
    band_index = band_names.index("Alpha") if "Alpha" in band_names else 0
    matrix_size = int((1 + math.sqrt(1 + 8 * len(edge_list))) / 2)
    matrix = np.zeros((matrix_size, matrix_size), dtype=float)
    index = 0
    for left in range(matrix_size):
        for right in range(left + 1, matrix_size):
            if index >= len(edge_list):
                break
            matrix[left, right] = wpli[index, band_index]
            matrix[right, left] = wpli[index, band_index]
            index += 1
    file_path = output_dir / f"{package['subjectCode']}_ec_alpha_wpli_connectivity.png"
    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    image = ax.imshow(matrix, cmap="magma", vmin=0, vmax=max(float(matrix.max()), 1e-6))
    ax.set_title("EC Alpha wPLI connectivity")
    ax.set_xlabel("Channel index")
    ax.set_ylabel("Channel index")
    fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(file_path, dpi=180)
    plt.close(fig)
    payload.close()
    return {
        "artifactType": "fc_network",
        "title": f"{package['subjectCode']} EC Alpha wPLI Connectivity",
        "method": "Connectivity matrix from generated wPLI feature",
        "filePath": str(file_path),
        "topFeatures": [
            {"name": "EC Alpha wPLI mean", "value": float(wpli[:, band_index].mean()), "direction": "EEG feature"},
            {"name": "EC Alpha wPLI max", "value": float(wpli[:, band_index].max()), "direction": "EEG feature"},
        ],
        "preview": {"sourceFeature": artifact["filePath"], "band": "Alpha"},
    }


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python explain_recovery.py <explainability_task_package.json>")

    package_path = Path(sys.argv[-1])
    package = json.loads(package_path.read_text(encoding="utf-8-sig"))
    output_dir = Path(package["outputs"]["outputDirectory"])
    manifest_path = Path(package["outputs"]["manifestPath"])
    output_dir.mkdir(parents=True, exist_ok=True)

    method_path = output_dir / f"{package['subjectCode']}_method_manifest.json"
    method_path.write_text(
        json.dumps(
            {
                "target": package["request"]["target"],
                "model": package["model"],
                "prediction": package["prediction"],
                "scripts": ["engines/explain_recovery.py"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    artifacts = [
        save_prediction_panel(package, output_dir),
        save_psd_topomap(package, output_dir),
        save_connectivity(package, output_dir),
        {
            "artifactType": "method_manifest",
            "title": f"{package['subjectCode']} explainability method manifest",
            "method": "Software package provenance",
            "filePath": str(method_path),
            "preview": {"target": package["request"]["target"]},
        },
    ]
    manifest_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "type": "explainability_manifest",
                "taskId": package["taskId"],
                "patientId": package["patientId"],
                "subjectCode": package["subjectCode"],
                "artifacts": artifacts,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote explainability manifest to {manifest_path}")


if __name__ == "__main__":
    main()
