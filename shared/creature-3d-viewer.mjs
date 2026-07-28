import * as THREE from '../desktop-wallpaper/vendor/three.module.js';
import { GLTFLoader } from '../desktop-wallpaper/vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../desktop-wallpaper/vendor/meshopt_decoder.module.js';
import { creature3DEntry, creatureActionForPhase } from './creature-3d-data.mjs';

const disposeMaterial = (material) => {
  for (const value of Object.values(material || {})) {
    if (value?.isTexture) value.dispose();
  }
  material?.dispose?.();
};

const disposeObject = (root) => {
  root?.traverse?.((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
    else disposeMaterial(object.material);
  });
};

export class Creature3DViewer {
  constructor(host, options = {}) {
    if (!host) throw new Error('Creature3DViewer requires a host element.');
    this.host = host;
    this.options = options;
    this.starter = 'cute';
    this.stageId = 'seed';
    this.action = 'idle';
    this.identity = '';
    this.requestId = 0;
    this.model = null;
    this.mixer = null;
    this.activeMixerAction = null;
    this.actionStopTimer = 0;
    this.modelGeneration = 0;
    this.loadedStarter = '';
    this.loadedStage = '';
    this.clipCache = new Map();
    this.clipPromises = new Map();
    this.retargetedClipCache = new Map();
    this.bindPose = new Map();
    this.rawModelHeight = 1;
    this.motionRoot = null;
    this.hips = null;
    this.baseHipsYaw = 0;
    this.hipsEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.modelBaseY = 0;
    this.proceduralIdle = false;
    this.yaw = 0;
    this.targetYaw = 0;
    this.baseYaw = options.baseYaw ?? 0;
    this.formYaw = 0;
    this.dragStart = null;
    this.didDrag = false;
    this.disposed = false;

    this.canvas = document.createElement('canvas');
    this.canvas.className = options.canvasClass || 'creature-3d-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.prepend(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.exposure || 0.96;

    this.scene = new THREE.Scene();
    this.frustumHeight = options.frustumHeight || (options.compact ? 3.1 : 3.35);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    this.camera.position.set(0, 0.05, options.cameraDistance || 6);
    this.camera.lookAt(0, 0, 0);
    this.stage = new THREE.Group();
    this.scene.add(this.stage);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa9b9bd, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.85);
    key.position.set(3.5, 5, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x77dce5, 1.05);
    rim.position.set(-4, 2.5, -3);
    this.scene.add(rim);

    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.clock = new THREE.Clock();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.bindPointer();
    this.resize();
    this.tick();
  }

  bindPointer() {
    this.host.addEventListener('pointerdown', (event) => {
      this.dragStart = { x: event.clientX, yaw: this.targetYaw };
      this.didDrag = false;
    });
    this.host.addEventListener('pointermove', (event) => {
      if (!this.dragStart) return;
      if (Math.abs(event.clientX - this.dragStart.x) > 5) this.didDrag = true;
      this.targetYaw = Math.max(-0.75, Math.min(0.75,
        this.dragStart.yaw + (event.clientX - this.dragStart.x) * 0.008));
    });
    const release = () => { this.dragStart = null; };
    this.host.addEventListener('pointerup', release);
    this.host.addEventListener('pointercancel', release);
    this.host.addEventListener('pointerleave', release);
    this.host.addEventListener('click', (event) => {
      if (!this.didDrag) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.didDrag = false;
    }, true);
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.options.compact ? 1.35 : 1.75);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    const halfHeight = this.frustumHeight / 2;
    const halfWidth = halfHeight * (width / height);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  async load(starter = this.starter, action = 'idle', stage = this.stageId) {
    const entry = creature3DEntry(starter, stage);
    const safeAction = entry.actions[action] ? action : 'idle';
    const identity = `${entry.id}:${entry.stage}:${safeAction}`;
    if (identity === this.identity) return true;
    const formChanged = this.loadedStarter !== entry.id || this.loadedStage !== entry.stage || !this.model;
    this.starter = entry.id;
    this.stageId = entry.stage;
    this.formYaw = entry.yaw || 0;
    this.action = safeAction;
    const requestId = ++this.requestId;
    if (formChanged) this.host.dataset.modelState = 'loading';
    else this.host.dataset.modelState = 'transitioning';
    try {
      if (formChanged) {
        const [gltf, clip] = await Promise.all([
          this.loader.loadAsync(entry.model),
          this.loadClip(entry, safeAction)
        ]);
        if (this.disposed || requestId !== this.requestId) {
          disposeObject(gltf.scene);
          return false;
        }
        this.replaceModel(gltf, entry.id, entry.stage);
        this.playClip(safeAction, this.retargetClip(entry, safeAction, clip), 0);
      } else {
        const clip = await this.loadClip(entry, safeAction);
        if (this.disposed || requestId !== this.requestId) return false;
        this.playClip(safeAction, this.retargetClip(entry, safeAction, clip));
      }
      this.identity = identity;
      this.host.dataset.modelState = 'ready';
      this.host.dataset.modelAction = safeAction;
      this.host.dataset.modelStage = entry.stage;
      this.options.onLoad?.({ starter: entry.id, stage: entry.stage, action: safeAction });
      return true;
    } catch (error) {
      if (requestId !== this.requestId) return false;
      this.host.dataset.modelState = this.model ? 'ready' : 'error';
      this.options.onError?.(error);
      return false;
    }
  }

  async loadClip(entry, action) {
    const key = `${entry.id}:${action}`;
    if (this.clipCache.has(key)) return this.clipCache.get(key);
    if (this.clipPromises.has(key)) return this.clipPromises.get(key);
    const promise = this.loader.loadAsync(entry.actions[action]).then((gltf) => {
      const clip = gltf.animations[0];
      if (!clip) {
        disposeObject(gltf.scene);
        throw new Error(`Missing animation clip: ${key}`);
      }
      gltf.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
      const size = bounds.getSize(new THREE.Vector3());
      const bindPose = new Map();
      gltf.scene.traverse((object) => {
        if (!object.name) return;
        bindPose.set(object.name, {
          position: object.position.clone(),
          quaternion: object.quaternion.clone()
        });
      });
      const source = { clip, bindPose, height: Math.max(size.y, 0.0001) };
      this.clipCache.set(key, source);
      disposeObject(gltf.scene);
      return source;
    }).finally(() => {
      this.clipPromises.delete(key);
    });
    this.clipPromises.set(key, promise);
    return promise;
  }

  preload(starter = this.starter, actions = ['nod', 'speaking'], stage = this.stageId) {
    const entry = creature3DEntry(starter, stage);
    return Promise.allSettled(actions
      .filter((action) => action !== this.action && entry.actions[action])
      .map(async (action) => {
        const source = await this.loadClip(entry, action);
        if (this.loadedStarter === entry.id && this.loadedStage === entry.stage) {
          this.retargetClip(entry, action, source);
        }
      }));
  }

  retargetClip(entry, action, source) {
    const key = `${entry.id}:${entry.stage}:${action}`;
    if (this.retargetedClipCache.has(key)) return this.retargetedClipCache.get(key);
    const positionScale = this.rawModelHeight / source.height;
    const sourceRestInverse = new THREE.Quaternion();
    const sourcePose = new THREE.Quaternion();
    const delta = new THREE.Quaternion();
    const targetPose = new THREE.Quaternion();
    const tracks = source.clip.tracks.map((track) => {
      const next = track.clone();
      const separator = track.name.lastIndexOf('.');
      if (separator < 0) return next;
      const rawNodeName = track.name.slice(0, separator);
      const bracketName = rawNodeName.match(/\[([^\]]+)\]$/)?.[1];
      const nodeName = bracketName || rawNodeName.split('/').at(-1);
      const property = track.name.slice(separator + 1);
      const from = source.bindPose.get(nodeName);
      const to = this.bindPose.get(nodeName);
      if (!from || !to) return next;
      if (property === 'quaternion') {
        sourceRestInverse.copy(from.quaternion).invert();
        for (let index = 0; index < next.values.length; index += 4) {
          sourcePose.fromArray(next.values, index);
          delta.copy(sourceRestInverse).multiply(sourcePose);
          targetPose.copy(to.quaternion).multiply(delta).normalize().toArray(next.values, index);
        }
      } else if (property === 'position') {
        for (let index = 0; index < next.values.length; index += 3) {
          next.values[index] = to.position.x + (next.values[index] - from.position.x) * positionScale;
          next.values[index + 1] = to.position.y + (next.values[index + 1] - from.position.y) * positionScale;
          next.values[index + 2] = to.position.z + (next.values[index + 2] - from.position.z) * positionScale;
        }
      }
      return next;
    });
    const clip = new THREE.AnimationClip(
      `${source.clip.name || action}-${entry.stage}`,
      source.clip.duration,
      tracks,
      source.clip.blendMode
    );
    this.retargetedClipCache.set(key, clip);
    return clip;
  }

  replaceModel(gltf, starter, stage) {
    if (this.model) {
      this.stage.remove(this.model);
      disposeObject(this.model);
    }
    window.clearTimeout(this.actionStopTimer);
    this.mixer?.stopAllAction();
    this.activeMixerAction = null;
    const animatedModel = gltf.scene;
    animatedModel.traverse((object) => {
      if (!object.isMesh) return;
      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = false;
    });

    this.mixer = new THREE.AnimationMixer(animatedModel);
    this.modelGeneration += 1;
    this.loadedStarter = starter;
    this.loadedStage = stage;
    animatedModel.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(animatedModel, true);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    this.rawModelHeight = Math.max(size.y, 0.0001);
    this.bindPose = new Map();
    animatedModel.traverse((object) => {
      if (!object.name) return;
      this.bindPose.set(object.name, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone()
      });
    });
    const targetHeight = this.options.compact ? 1.6 : 1.8;
    const aspect = Math.max(0.5, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    const targetWidth = this.frustumHeight * aspect * (this.options.compact ? 1.45 : 0.9);
    const scale = Math.min(
      targetHeight / Math.max(size.y, 0.0001),
      targetWidth / Math.max(size.x, 0.0001)
    );
    this.model = new THREE.Group();
    this.motionRoot = new THREE.Group();
    this.motionRoot.add(animatedModel);
    this.model.add(this.motionRoot);
    this.model.scale.setScalar(scale);
    this.model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    this.modelBaseY = this.model.position.y;
    this.stage.add(this.model);
    this.hips = animatedModel.getObjectByName('Hips');
    if (this.hips) {
      this.hipsEuler.setFromQuaternion(this.hips.quaternion, 'YXZ');
      this.baseHipsYaw = this.hipsEuler.y;
    }
  }

  playClip(action, clip, fadeDuration = 0.24) {
    if (!this.mixer || !clip) return;
    window.clearTimeout(this.actionStopTimer);
    const nextAction = this.mixer.clipAction(clip);
    const previousAction = this.activeMixerAction;
    nextAction.enabled = true;
    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    nextAction.setLoop(THREE.LoopRepeat, Infinity);
    nextAction.play();
    if (previousAction && previousAction !== nextAction && fadeDuration > 0) {
      previousAction.crossFadeTo(nextAction, fadeDuration, true);
      this.actionStopTimer = window.setTimeout(() => {
        if (this.activeMixerAction !== previousAction) previousAction.stop();
      }, fadeDuration * 1000 + 80);
    } else if (previousAction && previousAction !== nextAction) {
      previousAction.stop();
    }
    this.activeMixerAction = nextAction;
    this.proceduralIdle = action === 'idle';
    this.mixer.update(0.0001);
  }

  setPhase(phase) {
    return this.load(this.starter, creatureActionForPhase[phase] || 'idle', this.stageId);
  }

  resetView() {
    this.targetYaw = 0;
  }

  getState() {
    return {
      status: this.host.dataset.modelState || 'idle',
      starter: this.loadedStarter || this.starter,
      stage: this.loadedStage || this.stageId,
      action: this.host.dataset.modelAction || this.action,
      modelGeneration: this.modelGeneration,
      cachedClips: this.clipCache.size
    };
  }

  samplePixels() {
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 16) {
      if (pixels[index] > 8) opaque += 1;
    }
    return { width, height, opaque };
  }

  tick = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.tick);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.mixer?.update(delta);
    if (this.model) {
      this.model.position.y = this.modelBaseY + (this.proceduralIdle
        ? Math.sin(performance.now() * 0.0017) * 0.018
        : 0);
    }
    if (this.hips && this.motionRoot) {
      this.hipsEuler.setFromQuaternion(this.hips.quaternion, 'YXZ');
      this.motionRoot.rotation.y = this.baseHipsYaw - this.hipsEuler.y;
    }
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, delta * 8);
    this.stage.rotation.y = this.baseYaw + this.formYaw + this.yaw;
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    this.disposed = true;
    this.requestId += 1;
    window.clearTimeout(this.actionStopTimer);
    this.resizeObserver.disconnect();
    this.mixer?.stopAllAction();
    disposeObject(this.model);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
