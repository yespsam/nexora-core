import * as THREE from '../desktop-wallpaper/vendor/three.module.js';
import { GLTFLoader } from '../desktop-wallpaper/vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../desktop-wallpaper/vendor/meshopt_decoder.module.js';
import {
  creature3DEntry,
  creatureActionForPhase,
  creatureActionProfiles
} from './creature-3d-data.mjs?v=16';

const PROCEDURAL_BONES = Object.freeze([
  'Hips',
  'Spine',
  'Spine01',
  'Spine02',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot'
]);

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
    this.proceduralBones = new Map();
    this.proceduralPose = new Map();
    this.proceduralTransitionPose = new Map();
    this.rawModelHeight = 1;
    this.motionRoot = null;
    this.animatedRoot = null;
    this.hips = null;
    this.actionHipsYaw = 0;
    this.actionMotion = creatureActionProfiles.idle;
    this.actionStartedAt = 0;
    this.hipsEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.proceduralEuler = new THREE.Euler(0, 0, 0, 'XYZ');
    this.proceduralQuaternion = new THREE.Quaternion();
    this.hipsWorldPosition = new THREE.Vector3();
    this.hipsLocalPosition = new THREE.Vector3();
    this.compensatedHipsPosition = new THREE.Vector3();
    this.upAxis = new THREE.Vector3(0, 1, 0);
    this.actionHipsPosition = new THREE.Vector3();
    this.motionResidualX = 0;
    this.motionResidualZ = 0;
    this.motionResidualYaw = 0;
    this.hipsWorldQuaternion = new THREE.Quaternion();
    this.rootWorldQuaternion = new THREE.Quaternion();
    this.hipsLocalQuaternion = new THREE.Quaternion();
    this.modelBaseY = 0;
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
    const key = `${entry.id}:${entry.actions[action]}`;
    if (this.clipCache.has(key)) return this.clipCache.get(key);
    if (this.clipPromises.has(key)) return this.clipPromises.get(key);
    const promise = this.loader.loadAsync(entry.actions[action]).then((gltf) => {
      const clip = gltf.animations[0];
      if (!clip) {
        disposeObject(gltf.scene);
        throw new Error(`Missing animation clip: ${entry.id}:${action}`);
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
    this.animatedRoot = animatedModel;
    this.motionRoot.add(animatedModel);
    this.model.add(this.motionRoot);
    this.model.scale.setScalar(scale);
    this.model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    this.modelBaseY = this.model.position.y;
    this.stage.add(this.model);
    this.hips = animatedModel.getObjectByName('Hips');
    this.proceduralBones = new Map(PROCEDURAL_BONES
      .map((name) => [name, animatedModel.getObjectByName(name)])
      .filter(([, bone]) => Boolean(bone)));
    this.captureMotionAnchor();
  }

  playClip(action, clip, fadeDuration = 0.24) {
    if (!this.mixer || !clip) return;
    window.clearTimeout(this.actionStopTimer);
    const outgoingPose = new Map();
    for (const [name, bone] of this.proceduralBones) {
      outgoingPose.set(name, bone.quaternion.clone());
    }
    this.actionMotion = creatureActionProfiles[action] || creatureActionProfiles.idle;
    this.motionRoot?.position.set(0, 0, 0);
    this.motionRoot?.rotation.set(0, 0, 0);
    if (this.actionMotion.freezePose) {
      for (const [name, bone] of this.proceduralBones) {
        const bind = this.bindPose.get(name);
        if (bind) bone.quaternion.copy(bind.quaternion);
      }
    }
    const nextAction = this.mixer.clipAction(clip);
    const previousAction = this.activeMixerAction;
    const freezePose = Boolean(this.actionMotion.freezePose);
    const loopOnce = Boolean(this.actionMotion.loopOnce);
    nextAction.enabled = true;
    nextAction.reset();
    nextAction.setEffectiveTimeScale(this.actionMotion.timeScale || 1);
    nextAction.setEffectiveWeight(1);
    nextAction.setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, loopOnce ? 1 : Infinity);
    nextAction.clampWhenFinished = loopOnce;
    nextAction.play();
    if (freezePose && previousAction && previousAction !== nextAction) {
      previousAction.stop();
    } else if (previousAction && previousAction !== nextAction && fadeDuration > 0) {
      previousAction.crossFadeTo(nextAction, fadeDuration, true);
      this.actionStopTimer = window.setTimeout(() => {
        if (this.activeMixerAction !== previousAction) previousAction.stop();
      }, fadeDuration * 1000 + 80);
    } else if (previousAction && previousAction !== nextAction) {
      previousAction.stop();
    }
    this.activeMixerAction = nextAction;
    this.mixer.update(0.0001);
    nextAction.paused = freezePose;
    this.actionStartedAt = performance.now();
    this.captureProceduralPose();
    this.proceduralTransitionPose = outgoingPose;
  }

  captureProceduralPose() {
    this.proceduralPose.clear();
    for (const [name, bone] of this.proceduralBones) {
      this.proceduralPose.set(name, bone.quaternion.clone());
    }
  }

  applyBoneDelta(name, x = 0, y = 0, z = 0, transitionWeight = 1) {
    const bone = this.proceduralBones.get(name);
    const base = this.proceduralPose.get(name);
    if (!bone || !base) return;
    const outgoing = this.proceduralTransitionPose.get(name);
    if (outgoing && transitionWeight < 1) bone.quaternion.copy(outgoing).slerp(base, transitionWeight);
    else bone.quaternion.copy(base);
    this.proceduralEuler.set(x, y, z);
    this.proceduralQuaternion.setFromEuler(this.proceduralEuler);
    bone.quaternion.multiply(this.proceduralQuaternion);
  }

  updateProceduralMotion(now) {
    const motion = this.actionMotion?.procedural;
    if (!motion || !this.proceduralPose.size) return;
    const elapsed = Math.max(0, now - this.actionStartedAt);
    const localTime = elapsed * 0.001;
    const rawWeight = Math.min(1, elapsed / 320);
    const weight = rawWeight * rawWeight * (3 - 2 * rawWeight);
    const breath = Math.sin(localTime * 1.7);
    const gesture = Math.sin(localTime * 5.2);
    const wave = Math.sin(Math.max(0, localTime - 0.38) * 8.6);
    const apply = (name, x = 0, y = 0, z = 0) => {
      this.applyBoneDelta(name, x * weight, y * weight, z * weight, weight);
    };

    for (const [name, bone] of this.proceduralBones) {
      const base = this.proceduralPose.get(name);
      const outgoing = this.proceduralTransitionPose.get(name);
      if (!base) continue;
      if (outgoing && weight < 1) bone.quaternion.copy(outgoing).slerp(base, weight);
      else bone.quaternion.copy(base);
    }

    apply('Spine02', breath * 0.012, 0, breath * 0.006);
    apply('Head', breath * 0.008, 0, -breath * 0.006);

    if (motion === 'listening') {
      apply('Spine02', -0.035 + breath * 0.012, 0, 0.025);
      apply('Head', -0.055 + breath * 0.01, 0, 0.09);
    } else if (motion === 'nod') {
      apply('Spine02', gesture * 0.045, 0, 0);
      apply('Head', gesture * 0.28, 0, Math.sin(localTime * 2.6) * 0.012);
    } else if (motion === 'affection') {
      const approach = Math.sin(Math.min(1, localTime / 0.52) * Math.PI * 0.5);
      const reach = approach * (0.96 + Math.sin(localTime * 2.4) * 0.04);
      apply('Spine02', -0.16 * reach + breath * 0.012, 0, breath * 0.006);
      apply('Head', -0.12 * reach + breath * 0.008, 0, -0.04 * reach);
      apply('LeftArm', -0.88 * reach, -0.24 * reach, -0.52 * reach);
      apply('RightArm', -0.88 * reach, 0.24 * reach, 0.52 * reach);
      apply('LeftForeArm', -0.18 * reach, -0.18 * reach, 0.62 * reach);
      apply('RightForeArm', -0.18 * reach, 0.18 * reach, -0.62 * reach);
      apply('LeftHand', -0.08 * reach, 0, 0.12 * reach);
      apply('RightHand', -0.08 * reach, 0, -0.12 * reach);
    } else if (motion === 'wave') {
      const lift = Math.sin(Math.min(1, localTime / 0.42) * Math.PI * 0.5);
      const evolvedUpperBody = this.loadedStage !== 'seed' && this.loadedStarter !== 'cute';
      const aeraUpperBody = evolvedUpperBody && this.loadedStarter === 'beautiful';
      const veyrUpperBody = evolvedUpperBody && this.loadedStarter === 'cool';
      const shoulderLift = veyrUpperBody ? 2.18 : 1.25;
      const shoulderSweep = aeraUpperBody ? -0.8 : 0.5;
      const elbowFold = veyrUpperBody ? 1.32 : -0.5;
      apply('Spine02', 0, 0, -0.045 * lift);
      apply('Head', 0, 0, 0.07 * lift);
      apply('RightArm', (veyrUpperBody ? -1.15 : -1.25) * lift, shoulderSweep * lift,
        (shoulderLift + wave * 0.08) * lift);
      apply('RightForeArm', (veyrUpperBody ? -0.16 : -0.28) * lift,
        0.5 * lift,
        (elbowFold + wave * (veyrUpperBody ? 0.22 : 0.34)) * lift);
      apply('RightHand', -0.2 * lift, -0.35 * lift,
        (0.25 + wave * (veyrUpperBody ? 0.58 : 0.48)) * lift);
    } else if (motion === 'speaking') {
      apply('Spine02', breath * 0.018, gesture * 0.018, 0);
      apply('Head', gesture * 0.025, Math.sin(localTime * 2.4) * 0.025, 0);
      apply('LeftArm', 0, 0, 0.04 + gesture * 0.035);
      apply('RightArm', 0, 0, -0.04 - gesture * 0.035);
      apply('LeftForeArm', 0.04 + gesture * 0.025, 0, 0);
      apply('RightForeArm', 0.04 - gesture * 0.025, 0, 0);
    } else if (motion === 'walk' || motion === 'run') {
      const running = motion === 'run';
      const rate = running ? 6.2 : 3.6;
      const stride = Math.sin(localTime * rate);
      const strideOpposite = -stride;
      const leftLift = Math.max(0, stride);
      const rightLift = Math.max(0, strideOpposite);
      const legSwing = running ? 0.38 : 0.24;
      const kneeBend = running ? 0.52 : 0.3;
      const armSwing = running ? 0.28 : 0.17;
      const torsoSway = Math.sin(localTime * rate * 0.5) * (running ? 0.025 : 0.014);
      apply('Spine01', running ? -0.045 : -0.012, 0, torsoSway);
      apply('Spine02', running ? -0.035 : -0.008, 0, -torsoSway * 0.75);
      apply('Head', running ? 0.04 : 0.012, 0, torsoSway * 0.35);
      apply('LeftUpLeg', stride * legSwing, 0, 0);
      apply('RightUpLeg', strideOpposite * legSwing, 0, 0);
      apply('LeftLeg', -leftLift * kneeBend, 0, 0);
      apply('RightLeg', -rightLift * kneeBend, 0, 0);
      apply('LeftFoot', leftLift * (running ? 0.2 : 0.11), 0, 0);
      apply('RightFoot', rightLift * (running ? 0.2 : 0.11), 0, 0);
      apply('LeftArm', strideOpposite * armSwing, 0, 0.025);
      apply('RightArm', stride * armSwing, 0, -0.025);
      apply('LeftForeArm', 0.08 + rightLift * (running ? 0.18 : 0.08), 0, 0);
      apply('RightForeArm', 0.08 + leftLift * (running ? 0.18 : 0.08), 0, 0);
    } else if (motion === 'charging') {
      apply('Spine02', breath * 0.016, 0, 0);
      apply('Head', -0.025 + breath * 0.008, 0, 0);
    } else if (motion === 'low-power') {
      apply('Spine01', 0.055, 0, 0);
      apply('Spine02', 0.085, 0, 0.025);
      apply('Head', 0.12 + breath * 0.006, 0, -0.035);
      apply('LeftArm', 0.04, 0, 0.055);
      apply('RightArm', 0.04, 0, -0.055);
    } else if (motion === 'sleep') {
      apply('Spine01', 0.08, 0, 0.035);
      apply('Spine02', 0.13, 0, 0.075);
      apply('Head', 0.2 + breath * 0.004, 0, 0.12);
      apply('LeftArm', 0.07, 0, 0.08);
      apply('RightArm', 0.07, 0, -0.08);
    }
  }

  captureMotionAnchor() {
    if (!this.hips || !this.animatedRoot) return;
    this.animatedRoot.updateMatrixWorld(true);
    this.hips.getWorldPosition(this.hipsWorldPosition);
    this.hipsLocalPosition.copy(this.hipsWorldPosition);
    this.animatedRoot.worldToLocal(this.hipsLocalPosition);
    this.actionHipsPosition.copy(this.hipsLocalPosition);

    this.hips.getWorldQuaternion(this.hipsWorldQuaternion);
    this.animatedRoot.getWorldQuaternion(this.rootWorldQuaternion);
    this.hipsLocalQuaternion
      .copy(this.rootWorldQuaternion)
      .invert()
      .multiply(this.hipsWorldQuaternion);
    this.hipsEuler.setFromQuaternion(this.hipsLocalQuaternion, 'YXZ');
    this.actionHipsYaw = this.hipsEuler.y;
  }

  updateMotionStabilization(now) {
    if (!this.motionRoot || !this.hips || !this.animatedRoot) return;
    const profile = this.actionMotion || creatureActionProfiles.idle;
    this.animatedRoot.updateMatrixWorld(true);
    this.hips.getWorldPosition(this.hipsWorldPosition);
    this.hipsLocalPosition.copy(this.hipsWorldPosition);
    this.animatedRoot.worldToLocal(this.hipsLocalPosition);
    this.hips.getWorldQuaternion(this.hipsWorldQuaternion);
    this.animatedRoot.getWorldQuaternion(this.rootWorldQuaternion);
    this.hipsLocalQuaternion
      .copy(this.rootWorldQuaternion)
      .invert()
      .multiply(this.hipsWorldQuaternion);
    this.hipsEuler.setFromQuaternion(this.hipsLocalQuaternion, 'YXZ');

    if (profile.stabilizeYaw) {
      const deltaYaw = Math.atan2(
        Math.sin(this.hipsEuler.y - this.actionHipsYaw),
        Math.cos(this.hipsEuler.y - this.actionHipsYaw)
      );
      this.motionRoot.rotation.y = -deltaYaw;
    } else {
      this.motionRoot.rotation.y = 0;
    }

    if (profile.stabilizeXZ) {
      this.compensatedHipsPosition
        .copy(this.hipsLocalPosition)
        .applyAxisAngle(this.upAxis, this.motionRoot.rotation.y);
      this.motionRoot.position.x = this.actionHipsPosition.x - this.compensatedHipsPosition.x;
      this.motionRoot.position.z = this.actionHipsPosition.z - this.compensatedHipsPosition.z;
    } else {
      this.motionRoot.position.x = 0;
      this.motionRoot.position.z = 0;
    }

    this.motionRoot.rotation.x = Number(profile.lean || 0);
    this.motionRoot.rotation.z = Math.sin(now * 0.00145) * Number(profile.sway || 0);
    this.model.updateMatrixWorld(true);
    this.hips.getWorldPosition(this.hipsWorldPosition);
    this.hipsLocalPosition.copy(this.hipsWorldPosition);
    this.model.worldToLocal(this.hipsLocalPosition);
    this.motionResidualX = this.hipsLocalPosition.x - this.actionHipsPosition.x;
    this.motionResidualZ = this.hipsLocalPosition.z - this.actionHipsPosition.z;
    this.hips.getWorldQuaternion(this.hipsWorldQuaternion);
    this.model.getWorldQuaternion(this.rootWorldQuaternion);
    this.hipsLocalQuaternion
      .copy(this.rootWorldQuaternion)
      .invert()
      .multiply(this.hipsWorldQuaternion);
    this.hipsEuler.setFromQuaternion(this.hipsLocalQuaternion, 'YXZ');
    this.motionResidualYaw = Math.atan2(
      Math.sin(this.hipsEuler.y - this.actionHipsYaw),
      Math.cos(this.hipsEuler.y - this.actionHipsYaw)
    );
  }

  setPhase(phase) {
    return this.load(this.starter, creatureActionForPhase[phase] || 'idle', this.stageId);
  }

  resetView() {
    this.targetYaw = 0;
  }

  getState() {
    const motionValues = [
      this.motionResidualX,
      this.motionResidualZ,
      this.motionResidualYaw
    ];
    return {
      status: this.host.dataset.modelState || 'idle',
      starter: this.loadedStarter || this.starter,
      stage: this.loadedStage || this.stageId,
      action: this.host.dataset.modelAction || this.action,
      modelGeneration: this.modelGeneration,
      cachedClips: this.clipCache.size,
      motion: {
        procedural: this.actionMotion?.procedural || null,
        native: !this.actionMotion?.procedural,
        loopOnce: Boolean(this.actionMotion?.loopOnce),
        stabilized: Boolean(this.actionMotion?.stabilizeXZ && this.actionMotion?.stabilizeYaw),
        finite: motionValues.every(Number.isFinite),
        offsetX: motionValues[0],
        offsetZ: motionValues[1],
        yaw: motionValues[2]
      }
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
    const now = performance.now();
    this.updateProceduralMotion(now);
    this.updateMotionStabilization(now);
    if (this.model) {
      const bobRate = Number(this.actionMotion?.bobRate || 1.7);
      const bobPhase = now * 0.001 * bobRate;
      const bobWave = this.actionMotion?.bobMode === 'step'
        ? Math.abs(Math.sin(bobPhase))
        : Math.sin(bobPhase);
      this.model.position.y = this.modelBaseY
        + bobWave * Number(this.actionMotion?.bob || 0);
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
