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

export class Creature3DViewer {
  constructor(host, options = {}) {
    if (!host) throw new Error('Creature3DViewer requires a host element.');
    this.host = host;
    this.options = options;
    this.starter = 'cute';
    this.action = 'idle';
    this.identity = '';
    this.requestId = 0;
    this.model = null;
    this.mixer = null;
    this.motionRoot = null;
    this.hips = null;
    this.baseHipsYaw = 0;
    this.hipsEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.modelBaseY = 0;
    this.proceduralIdle = false;
    this.yaw = 0;
    this.targetYaw = 0;
    this.baseYaw = options.baseYaw ?? 0;
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

  async load(starter = this.starter, action = 'idle') {
    const entry = creature3DEntry(starter);
    const safeAction = entry.actions[action] ? action : 'idle';
    const identity = `${entry.id}:${safeAction}`;
    if (identity === this.identity) return true;
    this.starter = entry.id;
    this.action = safeAction;
    const requestId = ++this.requestId;
    this.host.dataset.modelState = 'loading';
    try {
      const gltf = await this.loader.loadAsync(entry.actions[safeAction]);
      if (this.disposed || requestId !== this.requestId) return false;
      this.replaceModel(gltf);
      this.identity = identity;
      this.host.dataset.modelState = 'ready';
      this.options.onLoad?.({ starter: entry.id, action: safeAction });
      return true;
    } catch (error) {
      if (requestId !== this.requestId) return false;
      this.host.dataset.modelState = 'error';
      this.options.onError?.(error);
      return false;
    }
  }

  replaceModel(gltf) {
    if (this.model) {
      this.stage.remove(this.model);
      this.model.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
        else disposeMaterial(object.material);
      });
    }
    this.mixer?.stopAllAction();
    const animatedModel = gltf.scene;
    animatedModel.traverse((object) => {
      if (!object.isMesh) return;
      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = false;
    });

    this.mixer = new THREE.AnimationMixer(animatedModel);
    this.proceduralIdle = false;
    if (gltf.animations[0]) {
      const clip = this.mixer.clipAction(gltf.animations[0]);
      clip.setLoop(THREE.LoopRepeat, Infinity);
      clip.play();
      this.mixer.update(0.0001);
      this.proceduralIdle = this.action === 'idle';
      if (this.proceduralIdle) clip.paused = true;
    }
    animatedModel.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(animatedModel, true);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const targetHeight = this.options.compact ? 1.82 : 1.8;
    const scale = targetHeight / Math.max(size.y, 0.0001);
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

  setPhase(phase) {
    return this.load(this.starter, creatureActionForPhase[phase] || 'idle');
  }

  resetView() {
    this.targetYaw = 0;
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
    this.stage.rotation.y = this.baseYaw + this.yaw;
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    this.disposed = true;
    this.requestId += 1;
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
