#!/usr/bin/env python3
"""Generate, rig, animate, and publish the three NEXORA creature starters."""

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

CREATURES = {
    "cute": {
        "display": "LUMO / 露莫",
        "slug": "cute-lumo",
        "directory": "CUTE_LUMO",
        "height_meters": 0.72,
        "references": [
            "NEXORA_3D_CREATURES/CUTE_LUMO/reference/front.png",
            "NEXORA_3D_CREATURES/CUTE_LUMO/reference/side.png",
            "NEXORA_3D_CREATURES/CUTE_LUMO/reference/back.png",
        ],
        "texture_prompt": (
            "Exact original LUMO cloud-fox creature from the three orthographic "
            "references. Preserve the cream-white sculpted fur, coral inner ears "
            "and paw pads, amber eyes, cyan faceted heart energy core, curled cloud "
            "forelock, split fluffy tail, four paw digits, compact bipedal anatomy, "
            "and clear arms and legs. Premium cel-shaded game PBR, clean material "
            "separation, no baked lighting, no clothing, no props."
        ),
    },
    "cool": {
        "display": "VEYR / 维尔",
        "slug": "cool-veyr",
        "directory": "COOL_VEYR",
        "height_meters": 1.05,
        "references": [
            "NEXORA_3D_CREATURES/COOL_VEYR/reference/front.png",
            "NEXORA_3D_CREATURES/COOL_VEYR/reference/side.png",
            "NEXORA_3D_CREATURES/COOL_VEYR/reference/back.png",
        ],
        "texture_prompt": (
            "Exact original VEYR storm-lynx dragon creature from the three "
            "orthographic references. Preserve midnight indigo sculpted fur planes, "
            "cyan luminous eyes and chest core, silver-white angular markings, long "
            "lightning ears, segmented lightning tail, four claw digits, athletic "
            "bipedal anatomy, and clear arms and digitigrade legs. Premium cel-shaded "
            "game PBR, crisp edges, no baked lighting, no armor, clothing, or props."
        ),
    },
    "beautiful": {
        "display": "AERA / 艾拉",
        "slug": "beautiful-aera",
        "directory": "BEAUTIFUL_AERA",
        "height_meters": 0.94,
        "references": [
            "NEXORA_3D_CREATURES/BEAUTIFUL_AERA/reference/front.png",
            "NEXORA_3D_CREATURES/BEAUTIFUL_AERA/reference/side.png",
            "NEXORA_3D_CREATURES/BEAUTIFUL_AERA/reference/back.png",
        ],
        "texture_prompt": (
            "Exact original AERA moon-moth deer spirit from the three orthographic "
            "references. Preserve the pearl-white smooth body, subtle short fur at "
            "neck and joints, violet eyes, blush opal chest core, long leaf ears, two "
            "translucent pink-violet wing fins, teal crescent tail tip, four paw "
            "digits, graceful bipedal anatomy, and clear arms and digitigrade legs. "
            "Premium cel-shaded game PBR, translucent materials only on fins, no "
            "baked lighting, no clothing or props."
        ),
    },
}

ACTIONS = {
    "idle": {"action_id": 0, "library_name": "Idle"},
    "nod": {"action_id": 25, "library_name": "Agree_Gesture"},
    "affection": {"action_id": 27, "library_name": "Big_Heart_Gesture"},
    "wave": {"action_id": 28, "library_name": "Big_Wave_Hello"},
    "speaking": {"action_id": 56, "library_name": "Stand_and_Chat"},
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
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def request_json(
    session: requests.Session,
    method: str,
    endpoint: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 120,
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
            f"{method} {endpoint} failed: HTTP {response.status_code} "
            f"{response.text[:1200]}"
        )
    return response.json()


def get_balance(session: requests.Session) -> int:
    return int(request_json(session, "GET", "/openapi/v1/balance").get("balance", 0))


def poll_task(
    session: requests.Session,
    endpoint: str,
    task_id: str,
    label: str,
    timeout: int = 1500,
) -> dict[str, Any]:
    elapsed = 0
    delay = 6
    while elapsed <= timeout:
        task = request_json(session, "GET", f"{endpoint}/{task_id}", timeout=45)
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


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(session: requests.Session, url: str, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"DOWNLOADING: {destination.relative_to(ROOT)}", flush=True)
    with session.get(url, stream=True, timeout=300) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    relative = str(destination.relative_to(ROOT))
    print(f"DOWNLOADED: {relative} ({destination.stat().st_size / 1024 / 1024:.1f} MB)", flush=True)
    return relative


def publish(source: Path, creature: dict[str, Any], group: str, filename: str) -> str:
    destination = PUBLISH_ROOT / creature["directory"] / group / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return str(destination.relative_to(ROOT))


def result_object(task: dict[str, Any]) -> dict[str, Any]:
    result = task.get("result")
    return result if isinstance(result, dict) else {}


def model_urls(task: dict[str, Any]) -> dict[str, str]:
    urls = dict(task.get("model_urls") or {})
    result = result_object(task)
    if result.get("rigged_character_glb_url"):
        urls["glb"] = result["rigged_character_glb_url"]
    if result.get("rigged_character_fbx_url"):
        urls["fbx"] = result["rigged_character_fbx_url"]
    return urls


def save_metadata(project_dir: Path, metadata: dict[str, Any]) -> None:
    metadata["updated_at"] = datetime.now().isoformat()
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (PUBLISH_ROOT / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def record_history(project_dir: Path, metadata: dict[str, Any]) -> None:
    if HISTORY_PATH.exists():
        history = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    else:
        history = {"version": 1, "projects": []}
    summary = {
        "folder": project_dir.name,
        "prompt": "nexora original 3d creature starters",
        "task_type": "multi-image-to-3d-rig-animation",
        "root_task_id": metadata["root_task_id"],
        "created_at": metadata["created_at"],
        "updated_at": metadata["updated_at"],
        "task_count": len(metadata["tasks"]),
    }
    existing = next(
        (item for item in history["projects"] if item.get("folder") == project_dir.name),
        None,
    )
    if existing:
        existing.update(summary)
    else:
        history["projects"].append(summary)
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def add_task(
    project_dir: Path,
    metadata: dict[str, Any],
    task_id: str,
    task_type: str,
    creature_id: str,
    action: str = "",
) -> None:
    metadata["tasks"].append(
        {
            "task_id": task_id,
            "type": task_type,
            "creature": creature_id,
            "action": action,
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
    if not entry:
        return
    entry.update(
        {
            "status": task.get("status"),
            "progress": task.get("progress"),
            "consumed_credits": task.get("consumed_credits"),
            "finished_at": task.get("finished_at"),
            "files": files,
        }
    )
    save_metadata(project_dir, metadata)
    record_history(project_dir, metadata)


def create_model_task(session: requests.Session, creature: dict[str, Any]) -> str:
    references = [ROOT / value for value in creature["references"]]
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
        "texture_prompt": creature["texture_prompt"],
        "remove_lighting": True,
        "image_enhancement": False,
        "multi_view_thumbnails": True,
        "target_formats": ["glb", "fbx"],
        "auto_size": True,
        "origin_at": "bottom",
    }
    response = request_json(
        session, "POST", "/openapi/v1/multi-image-to-3d", payload, timeout=180
    )
    return response["result"]


def create_rig_task(
    session: requests.Session, creature: dict[str, Any], model_task_id: str
) -> str:
    response = request_json(
        session,
        "POST",
        "/openapi/v1/rigging",
        {"input_task_id": model_task_id, "height_meters": creature["height_meters"]},
    )
    return response["result"]


def create_animation_task(
    session: requests.Session, rig_task_id: str, action: dict[str, Any]
) -> str:
    response = request_json(
        session,
        "POST",
        "/openapi/v1/animations",
        {
            "rig_task_id": rig_task_id,
            "action_id": action["action_id"],
            "post_process": {"operation_type": "change_fps", "fps": 30},
        },
    )
    return response["result"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="Spend the approved Meshy credits.")
    args = parser.parse_args()
    planned_credits = len(CREATURES) * (30 + 5 + len(ACTIONS) * 3)
    print(f"PLANNED_CREDITS: {planned_credits}", flush=True)
    print("OUTPUT_ROOT: meshy_output/", flush=True)
    print("PUBLISH_ROOT: NEXORA_3D_CREATURES/", flush=True)
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

    first_id = next(iter(CREATURES))
    first_task = create_model_task(session, CREATURES[first_id])
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "-", "nexora-original-3d-creatures")
    project_dir = OUTPUT_ROOT / f"{timestamp}_{slug}_{first_task[:8]}"
    metadata: dict[str, Any] = {
        "project_name": "NEXORA original 3D creature starters",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "root_task_id": first_task,
        "planned_credits": planned_credits,
        "balance_before": balance_before,
        "balance_after": None,
        "actual_credits": None,
        "creatures": CREATURES,
        "actions": ACTIONS,
        "tasks": [],
        "artifacts": [],
    }
    add_task(project_dir, metadata, first_task, "multi-image-to-3d", first_id)
    print(f"TASK_CREATED: model/{first_id} {first_task}", flush=True)
    print(f"PROJECT_DIR: {project_dir.relative_to(ROOT)}", flush=True)

    model_tasks = {first_id: first_task}
    for creature_id, creature in list(CREATURES.items())[1:]:
        task_id = create_model_task(session, creature)
        model_tasks[creature_id] = task_id
        add_task(project_dir, metadata, task_id, "multi-image-to-3d", creature_id)
        print(f"TASK_CREATED: model/{creature_id} {task_id}", flush=True)

    for creature_id, task_id in model_tasks.items():
        task = poll_task(
            session, "/openapi/v1/multi-image-to-3d", task_id, f"model/{creature_id}"
        )
        creature = CREATURES[creature_id]
        source_dir = project_dir / creature["slug"]
        files: list[str] = []
        urls = model_urls(task)
        for extension in ("glb", "fbx"):
            if not urls.get(extension):
                continue
            source = source_dir / f"model.{extension}"
            files.append(download(session, urls[extension], source))
            files.append(publish(source, creature, "model", f"model.{extension}"))
        thumbnail_url = task.get("thumbnail_url")
        if thumbnail_url:
            source = source_dir / "thumbnail.png"
            files.append(download(session, thumbnail_url, source))
            files.append(publish(source, creature, "model", "thumbnail.png"))
        update_task(project_dir, metadata, task, files)

    rig_tasks: dict[str, str] = {}
    for creature_id, model_task_id in model_tasks.items():
        creature = CREATURES[creature_id]
        task_id = create_rig_task(session, creature, model_task_id)
        rig_tasks[creature_id] = task_id
        add_task(project_dir, metadata, task_id, "rigging", creature_id)
        print(f"TASK_CREATED: rig/{creature_id} {task_id}", flush=True)

    for creature_id, task_id in rig_tasks.items():
        task = poll_task(session, "/openapi/v1/rigging", task_id, f"rig/{creature_id}")
        creature = CREATURES[creature_id]
        source_dir = project_dir / creature["slug"]
        files: list[str] = []
        urls = model_urls(task)
        if not urls.get("glb"):
            raise RuntimeError(f"Missing rigged GLB for {creature_id}")
        source = source_dir / "rigged.glb"
        files.append(download(session, urls["glb"], source))
        files.append(publish(source, creature, "model", "rigged.glb"))
        basics = result_object(task).get("basic_animations") or {}
        for filename, key in (("walk.glb", "walking_glb_url"), ("run.glb", "running_glb_url")):
            if basics.get(key):
                source = source_dir / filename
                files.append(download(session, basics[key], source))
                files.append(publish(source, creature, "animations", filename))
        update_task(project_dir, metadata, task, files)

    animation_tasks: list[tuple[str, str, str]] = []
    for creature_id, rig_task_id in rig_tasks.items():
        for action_name, action in ACTIONS.items():
            task_id = create_animation_task(session, rig_task_id, action)
            animation_tasks.append((creature_id, action_name, task_id))
            add_task(project_dir, metadata, task_id, "animation", creature_id, action_name)
            print(f"TASK_CREATED: animation/{creature_id}/{action_name} {task_id}", flush=True)

    for creature_id, action_name, task_id in animation_tasks:
        task = poll_task(
            session,
            "/openapi/v1/animations",
            task_id,
            f"animation/{creature_id}/{action_name}",
            timeout=900,
        )
        animation_url = result_object(task).get("animation_glb_url")
        if not animation_url:
            raise RuntimeError(f"Missing animation GLB for {creature_id}/{action_name}")
        creature = CREATURES[creature_id]
        source = project_dir / creature["slug"] / f"{action_name}.glb"
        files = [download(session, animation_url, source)]
        files.append(publish(source, creature, "animations", f"{action_name}.glb"))
        update_task(project_dir, metadata, task, files)

    artifacts = []
    for path in sorted(PUBLISH_ROOT.glob("**/*.glb")):
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
    for creature_id, creature in CREATURES.items():
        per_creature = dict(metadata)
        per_creature["creature"] = creature_id
        per_creature["tasks"] = [
            task for task in metadata["tasks"] if task["creature"] == creature_id
        ]
        per_creature["artifacts"] = [
            item for item in artifacts if creature["directory"] in item["file"]
        ]
        (PUBLISH_ROOT / creature["directory"] / "metadata.json").write_text(
            json.dumps(per_creature, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print(f"BALANCE_AFTER: {balance_after}", flush=True)
    print(f"ACTUAL_CREDITS: {balance_before - balance_after}", flush=True)
    print(f"PROJECT_DIR: {project_dir.relative_to(ROOT)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
