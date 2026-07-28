#!/usr/bin/env python3
"""Generate and rig the six NEXORA evolution forms without buying duplicate actions."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "meshy_output"
PUBLISH_ROOT = ROOT / "NEXORA_3D_CREATURES"
HISTORY_PATH = OUTPUT_ROOT / "history.json"
BASE = "https://api.meshy.ai"

ROUTES = {
    "cute": {
        "name": "LUMO / 露莫",
        "directory": "CUTE_LUMO",
        "heights": {"young": 0.85, "resonance": 1.0},
        "identity": (
            "cream-white cloud fox with warm amber eyes, coral inner ears and paw pads, "
            "cyan faceted heart chest core, curled forehead lock, cheek fur, and paired "
            "cloud tail; friendly original creature"
        ),
    },
    "cool": {
        "name": "VEYR / 维尔",
        "directory": "COOL_VEYR",
        "heights": {"young": 1.2, "resonance": 1.35},
        "identity": (
            "deep navy storm lynx-dragon with cyan eyes, organic silver-gray facial "
            "markings and fur spikes, cyan diamond chest core, lightning ears, and "
            "segmented storm tail; sleek original creature"
        ),
    },
    "beautiful": {
        "name": "AERA / 艾拉",
        "directory": "BEAUTIFUL_AERA",
        "heights": {"young": 1.08, "resonance": 1.22},
        "identity": (
            "pearl-white moon-moth deer with violet eyes, lavender forehead tufts, "
            "feathered moth ears, two opalescent pink-lilac wing fins, pink diamond "
            "chest core, and cyan crescent tail plume; graceful original creature"
        ),
    },
}

FORMS: dict[str, dict[str, Any]] = {}
for route_id, route in ROUTES.items():
    for stage in ("young", "resonance"):
        key = f"{route_id}-{stage}"
        reference_root = (
            f"NEXORA_3D_CREATURES/{route['directory']}/evolution/{stage}/reference"
        )
        FORMS[key] = {
            "route": route_id,
            "stage": stage,
            "name": route["name"],
            "slug": key,
            "directory": route["directory"],
            "height_meters": route["heights"][stage],
            "references": [
                f"{reference_root}/front.png",
                f"{reference_root}/side.png",
                f"{reference_root}/back.png",
            ],
            "texture_prompt": (
                f"Exact {stage} evolution of the referenced {route['identity']}. "
                "Preserve the reference silhouette, face, markings, chest core, ears, "
                "hands, feet, and tail across every view. Premium polished stylized "
                "game PBR with crisp material separation, subtle sculpted fur detail, "
                "clean eyes, and no baked lighting. Rig-friendly A-pose with two arms, "
                "two legs, complete separated digits, no merged anatomy, no clothing, "
                "no armor, no props, and no extra limbs."
            ),
        }


def load_env() -> None:
    for name in (".env", ".env.local"):
        path = ROOT / name
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def request_json(
    session: requests.Session,
    method: str,
    endpoint: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 180,
) -> dict[str, Any]:
    response = session.request(method, f"{BASE}{endpoint}", json=payload, timeout=timeout)
    if response.status_code == 401:
        raise RuntimeError("Invalid Meshy API key (401)")
    if response.status_code == 402:
        balance = session.get(f"{BASE}/openapi/v1/balance", timeout=15).json()
        raise RuntimeError(f"Insufficient Meshy credits (402): {balance}")
    if response.status_code == 429:
        print("RATE_LIMITED: waiting 12 seconds", flush=True)
        time.sleep(12)
        return request_json(session, method, endpoint, payload, timeout)
    if response.status_code >= 400:
        raise RuntimeError(
            f"{method} {endpoint} failed: HTTP {response.status_code} {response.text[:1200]}"
        )
    return response.json()


def get_balance(session: requests.Session) -> int:
    return int(request_json(session, "GET", "/openapi/v1/balance", timeout=30).get("balance", 0))


def poll_task(
    session: requests.Session,
    endpoint: str,
    task_id: str,
    label: str,
    timeout: int = 1800,
) -> dict[str, Any]:
    elapsed = 0
    delay = 7
    while elapsed <= timeout:
        task = request_json(session, "GET", f"{endpoint}/{task_id}", timeout=60)
        status = task.get("status", "UNKNOWN")
        progress = int(task.get("progress", 0) or 0)
        print(f"{label}: {task_id[:8]} [{progress:3d}%] {status} ({elapsed}s)", flush=True)
        if status == "SUCCEEDED":
            return task
        if status in {"FAILED", "CANCELED"}:
            error = task.get("task_error") or {}
            raise RuntimeError(f"{label} {status}: {error.get('message', 'Unknown error')}")
        current_delay = 15 if progress >= 95 else delay
        time.sleep(current_delay)
        elapsed += current_delay
        delay = min(int(delay * 1.45), 25)
    raise TimeoutError(f"Timed out waiting for {label} ({task_id})")


def result_object(task: dict[str, Any]) -> dict[str, Any]:
    result = task.get("result")
    return result if isinstance(result, dict) else {}


def model_urls(task: dict[str, Any]) -> dict[str, str]:
    urls = dict(task.get("model_urls") or {})
    result = result_object(task)
    if result.get("rigged_character_glb_url"):
        urls["glb"] = result["rigged_character_glb_url"]
    return urls


def download(session: requests.Session, url: str, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"DOWNLOADING: {destination.relative_to(ROOT)}", flush=True)
    with session.get(url, stream=True, timeout=360) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    return str(destination.relative_to(ROOT))


def publish(source: Path, form: dict[str, Any], filename: str) -> str:
    destination = (
        PUBLISH_ROOT / form["directory"] / "evolution" / form["stage"] / filename
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return str(destination.relative_to(ROOT))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_metadata(project_dir: Path, metadata: dict[str, Any]) -> None:
    metadata["updated_at"] = datetime.now().isoformat()
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (PUBLISH_ROOT / "evolution-metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def record_history(project_dir: Path, metadata: dict[str, Any]) -> None:
    if HISTORY_PATH.exists():
        history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    else:
        history = {"version": 1, "projects": []}
    summary = {
        "folder": project_dir.name,
        "prompt": "nexora six evolution forms",
        "task_type": "multi-image-to-3d-rig",
        "root_task_id": metadata["root_task_id"],
        "created_at": metadata["created_at"],
        "updated_at": metadata["updated_at"],
        "task_count": len(metadata["tasks"]),
    }
    history["projects"] = [
        item for item in history["projects"] if item.get("folder") != project_dir.name
    ]
    history["projects"].append(summary)
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def add_task(
    project_dir: Path,
    metadata: dict[str, Any],
    task_id: str,
    task_type: str,
    form_id: str,
) -> None:
    metadata["tasks"].append(
        {
            "task_id": task_id,
            "type": task_type,
            "form": form_id,
            "status": "CREATED",
            "created_at": datetime.now().isoformat(),
            "files": [],
        }
    )
    save_metadata(project_dir, metadata)
    record_history(project_dir, metadata)


def update_task(
    project_dir: Path,
    metadata: dict[str, Any],
    task: dict[str, Any],
    files: list[str],
) -> None:
    task_id = task.get("id") or task.get("task_id")
    entry = next((item for item in metadata["tasks"] if item["task_id"] == task_id), None)
    if entry:
        entry.update(
            status=task.get("status"),
            progress=task.get("progress"),
            consumed_credits=task.get("consumed_credits"),
            finished_at=task.get("finished_at"),
            files=files,
        )
    save_metadata(project_dir, metadata)
    record_history(project_dir, metadata)


def create_model_task(session: requests.Session, form: dict[str, Any]) -> str:
    references = [ROOT / value for value in form["references"]]
    missing = [path for path in references if not path.exists()]
    if missing:
        raise FileNotFoundError(", ".join(str(path) for path in missing))
    payload = {
        "image_urls": [data_uri(path) for path in references],
        "ai_model": "meshy-6",
        "topology": "quad",
        "target_polycount": 60000,
        "should_remesh": True,
        "save_pre_remeshed_model": True,
        "should_texture": True,
        "enable_pbr": True,
        "hd_texture": True,
        "pose_mode": "a-pose",
        "texture_prompt": form["texture_prompt"],
        "remove_lighting": True,
        "image_enhancement": False,
        "multi_view_thumbnails": True,
        "target_formats": ["glb"],
        "auto_size": True,
        "origin_at": "bottom",
    }
    return request_json(
        session, "POST", "/openapi/v1/multi-image-to-3d", payload
    )["result"]


def create_rig_task(session: requests.Session, form: dict[str, Any], model_task_id: str) -> str:
    payload = {"input_task_id": model_task_id, "height_meters": form["height_meters"]}
    return request_json(session, "POST", "/openapi/v1/rigging", payload)["result"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="Spend the approved Meshy credits.")
    args = parser.parse_args()
    planned_credits = len(FORMS) * (30 + 5)
    print(f"PLANNED_CREDITS: {planned_credits}", flush=True)
    print("OUTPUT_ROOT: meshy_output/", flush=True)
    print("PUBLISH_ROOT: NEXORA_3D_CREATURES/*/evolution/", flush=True)
    if not args.yes:
        print("Dry run only. Add --yes after user confirmation.", flush=True)
        return 0

    load_env()
    api_key = os.environ.get("MESHY_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("ERROR: MESHY_API_KEY not set")
    session = requests.Session()
    session.trust_env = False
    session.headers.update({"Authorization": f"Bearer {api_key}"})

    balance_before = get_balance(session)
    print(f"BALANCE_BEFORE: {balance_before}", flush=True)
    if balance_before < planned_credits:
        raise SystemExit(f"ERROR: need {planned_credits} credits, balance is {balance_before}")

    first_form_id = next(iter(FORMS))
    first_task_id = create_model_task(session, FORMS[first_form_id])
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "-", "nexora-evolution-forms")
    project_dir = OUTPUT_ROOT / f"{timestamp}_{slug}_{first_task_id[:8]}"
    metadata: dict[str, Any] = {
        "project_name": "NEXORA six 3D evolution forms",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "root_task_id": first_task_id,
        "planned_credits": planned_credits,
        "balance_before": balance_before,
        "balance_after": None,
        "actual_credits": None,
        "forms": FORMS,
        "tasks": [],
        "artifacts": [],
    }
    add_task(project_dir, metadata, first_task_id, "multi-image-to-3d", first_form_id)
    print(f"TASK_CREATED: model/{first_form_id} {first_task_id}", flush=True)
    print(f"PROJECT_DIR: {project_dir.relative_to(ROOT)}", flush=True)

    model_tasks = {first_form_id: first_task_id}
    for form_id, form in list(FORMS.items())[1:]:
        task_id = create_model_task(session, form)
        model_tasks[form_id] = task_id
        add_task(project_dir, metadata, task_id, "multi-image-to-3d", form_id)
        print(f"TASK_CREATED: model/{form_id} {task_id}", flush=True)

    for form_id, task_id in model_tasks.items():
        task = poll_task(
            session, "/openapi/v1/multi-image-to-3d", task_id, f"model/{form_id}"
        )
        form = FORMS[form_id]
        source_dir = project_dir / form["slug"]
        files: list[str] = []
        model_url = model_urls(task).get("glb")
        if not model_url:
            raise RuntimeError(f"Missing model GLB for {form_id}")
        model_path = source_dir / "model.glb"
        files.append(download(session, model_url, model_path))
        files.append(publish(model_path, form, "model.glb"))
        thumbnail_url = task.get("thumbnail_url")
        if thumbnail_url:
            thumbnail_path = source_dir / "thumbnail.png"
            files.append(download(session, thumbnail_url, thumbnail_path))
            files.append(publish(thumbnail_path, form, "thumbnail.png"))
        update_task(project_dir, metadata, task, files)

    rig_tasks: dict[str, str] = {}
    for form_id, model_task_id in model_tasks.items():
        task_id = create_rig_task(session, FORMS[form_id], model_task_id)
        rig_tasks[form_id] = task_id
        add_task(project_dir, metadata, task_id, "rigging", form_id)
        print(f"TASK_CREATED: rig/{form_id} {task_id}", flush=True)

    for form_id, task_id in rig_tasks.items():
        task = poll_task(session, "/openapi/v1/rigging", task_id, f"rig/{form_id}")
        form = FORMS[form_id]
        source_dir = project_dir / form["slug"]
        files: list[str] = []
        rigged_url = model_urls(task).get("glb")
        if not rigged_url:
            raise RuntimeError(f"Missing rigged GLB for {form_id}")
        rigged_path = source_dir / "rigged.glb"
        files.append(download(session, rigged_url, rigged_path))
        files.append(publish(rigged_path, form, "rigged.glb"))
        basics = result_object(task).get("basic_animations") or {}
        for filename, key in (
            ("walk.glb", "walking_glb_url"),
            ("run.glb", "running_glb_url"),
        ):
            if basics.get(key):
                path = source_dir / filename
                files.append(download(session, basics[key], path))
        update_task(project_dir, metadata, task, files)

    artifacts = []
    for form in FORMS.values():
        stage_root = PUBLISH_ROOT / form["directory"] / "evolution" / form["stage"]
        for path in sorted(stage_root.glob("*.glb")):
            artifacts.append(
                {
                    "file": str(path.relative_to(ROOT)),
                    "bytes": path.stat().st_size,
                    "sha256": sha256(path),
                }
            )
    balance_after = get_balance(session)
    metadata["artifacts"] = artifacts
    metadata["balance_after"] = balance_after
    metadata["actual_credits"] = balance_before - balance_after
    save_metadata(project_dir, metadata)
    record_history(project_dir, metadata)
    print(f"BALANCE_AFTER: {balance_after}", flush=True)
    print(f"ACTUAL_CREDITS: {balance_before - balance_after}", flush=True)
    print(f"PROJECT_DIR: {project_dir.relative_to(ROOT)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
