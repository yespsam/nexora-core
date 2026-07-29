import {
  SOULMATE_HISTORY_KEY,
  SOULMATE_STORAGE_KEY,
  createSoulmateProfile,
  defaultVoiceForStarter,
  normalizeSoulmateProfile,
  stageProgress
} from '../shared/soulmate-profile.mjs';
import { creatureVoiceResources } from '../shared/companion-data.mjs';

const RELEASE_ID = 'cross-device-continuity-v1';
const FRAME_READY_TIMEOUT_MS = 30000;
let frameRun = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const phoneFrame = $('#phone-frame');
const desktopFrame = $('#desktop-frame');
const pendantFrame = $('#pendant-frame');
const runButton = $('#run-button');
const resetButton = $('#reset-button');
const summary = $('#summary');
const eventLog = $('#event-log');
const testRows = [...document.querySelectorAll('[data-test]')];

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (error) { return null; }
}

function seedDemoProfile(force = false) {
  const saved = normalizeSoulmateProfile(readJson(SOULMATE_STORAGE_KEY));
  if (saved && !force) return saved;
  const profile = createSoulmateProfile({
    name: '星澜',
    birthday: new Date().toISOString().slice(0, 10),
    gender: 'neutral',
    starter: 'cute',
    temperament: 'warm',
    voice: defaultVoiceForStarter('cute'),
    voiceCustomized: false
  });
  profile.bond = 88;
  profile.interactions = 11;
  localStorage.setItem(SOULMATE_STORAGE_KEY, JSON.stringify(profile));
  localStorage.setItem(SOULMATE_HISTORY_KEY, JSON.stringify([
    { role: 'assistant', content: '测试台已经准备好，我会跟着你的每一次互动同步到项链。' }
  ]));
  return profile;
}

function loadFrames() {
  const runId = `${Date.now()}-${frameRun += 1}`;
  phoneFrame.src = `../soulmate/?lab=1&surface=phone&release=${RELEASE_ID}&run=${runId}`;
  desktopFrame.src = `../soulmate/?lab=1&surface=desktop&release=${RELEASE_ID}&run=${runId}`;
  pendantFrame.src = `../pendant-display/?lab=1&state=idle&release=${RELEASE_ID}&run=${runId}`;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(read, timeout = FRAME_READY_TIMEOUT_MS, interval = 100) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(interval);
  }
  const detail = String(lastError?.message || '').slice(0, 36);
  throw new Error(detail ? `双端加载超时：${detail}` : '双端加载超过 30 秒');
}

function setResult(id, status, detail) {
  const row = $(`[data-test="${id}"]`);
  row.dataset.status = status;
  $('output', row).textContent = detail;
}

function addLog(text) {
  const item = document.createElement('li');
  item.textContent = text;
  eventLog.appendChild(item);
  eventLog.scrollTop = eventLog.scrollHeight;
}

async function check(id, label, task) {
  setResult(id, 'running', '测试中');
  try {
    const detail = await task();
    setResult(id, 'pass', detail || '通过');
    addLog(`${label}：${detail || '通过'}`);
    return true;
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 64);
    setResult(id, 'fail', detail);
    addLog(`${label}：失败，${detail}`);
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectPendantState(pendant, state) {
  const snapshot = await waitFor(() => {
    const current = pendant.getSnapshot();
    return current?.state === state ? current : null;
  }, 3000);
  return snapshot;
}

async function waitForPendantAction(pendant, action, timeout = 20000) {
  const started = Date.now();
  let current = null;
  while (Date.now() - started < timeout) {
    current = pendant.getModelState();
    if (current?.error) throw new Error(`${action} 动作失败：${current.error}`);
    if (current?.status === 'ready' && current.action === action) return current;
    await delay(100);
  }
  const status = current ? `${current.status || '未知'}/${current.action || '未知'}` : '无模型状态';
  throw new Error(`${action} 动作 20 秒未就绪，当前 ${status}`);
}

async function runAllTests() {
  runButton.disabled = true;
  runButton.textContent = '正在测试';
  summary.dataset.status = 'running';
  summary.textContent = '运行中';
  eventLog.textContent = '';
  testRows.forEach((row) => {
    row.dataset.status = 'idle';
    $('output', row).textContent = '等待';
  });

  let phone;
  let desktop;
  let pendant;
  let phoneModelGeneration = 0;
  const results = [];
  results.push(await check('views', '三端界面加载', async () => {
    [phone, desktop, pendant] = await Promise.all([
      waitFor(() => phoneFrame.contentWindow?.__NEXORA_LAB__),
      waitFor(() => desktopFrame.contentWindow?.__NEXORA_LAB__),
      waitFor(() => pendantFrame.contentWindow?.__NEXORA_PENDANT_LAB__)
    ]);
    assert(phone.getState().profile, '手机端没有伴侣资料');
    assert(desktop.getState().profile, '电脑端没有伴侣资料');
    return '手机 / 电脑 / 项链就绪';
  }));

  results.push(await check('assets', '角色资源与圆屏尺寸', async () => {
    const roundDisplay = pendantFrame.contentDocument.querySelector('#round-display');
    const imageFallback = phoneFrame.contentDocument.querySelector(
      '#companion-image, #birth-visual-image, img[src*="/assets/starters/"]'
    );
    assert(!imageFallback, '手机端仍包含 2D 角色图片');
    await waitFor(() => {
      const phonePixels = phone.sampleModel();
      const pendantPixels = pendant.sampleModel();
      return phonePixels?.opaque > 100 && pendantPixels?.opaque > 100;
    });
    const manifestResponse = await fetch(`../NEXORA_3D_CREATURES/asset-manifest.json?release=${RELEASE_ID}`);
    assert(manifestResponse.ok, `形态清单返回 ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const formCount = Object.values(manifest.creatures || {})
      .reduce((total, creature) => total + Object.keys(creature.forms || {}).length, 0);
    assert(manifest.version >= 2 && formCount === 9, `仅发现 ${formCount} 个原生形态`);
    phoneModelGeneration = phone.getModelState().modelGeneration;
    const size = roundDisplay.getBoundingClientRect();
    assert(Math.abs(size.width - 240) <= 2 && Math.abs(size.height - 240) <= 2, `圆屏为 ${Math.round(size.width)}×${Math.round(size.height)}`);
    return '9 个原生 3D 形态 / 240×240';
  }));

  results.push(await check('pair', '虚拟蓝牙连接', async () => {
    const phoneState = phone.getState();
    const expectedStage = stageProgress(phoneState.profile).stage.id;
    await phone.connectPendant();
    await waitFor(() => phone.getState().pendantConnected);
    await waitFor(() => {
      const current = pendant.getSnapshot();
      return current?.connected
        && current.companion?.name === phoneState.profile.name
        && current.companion?.starter === phoneState.profile.starter
        && current.companion?.stage === expectedStage;
    }, 5000);
    return 'NC-01 已连接并收到资料';
  }));

  results.push(await check('identity', '身份同步', async () => {
    const phoneState = phone.getState();
    const snapshot = await waitFor(() => {
      const current = pendant.getSnapshot();
      return current?.companion?.name === phoneState.profile.name ? current : null;
    });
    assert(snapshot.companion.bond === phoneState.profile.bond, '共鸣值没有同步');
    assert(snapshot.companion.stage === stageProgress(phoneState.profile).stage.id, '成长形态没有同步');
    assert(
      phoneState.profile.voice === defaultVoiceForStarter(phoneState.profile.starter),
      '初始形象与默认声线不匹配'
    );
    return `${snapshot.companion.name} / ${snapshot.companion.stageName}`;
  }));

  results.push(await check('poses', '3D 互动动作', async () => {
    const started = performance.now();
    pendant.setState('affection');
    const affection = await expectPendantState(pendant, 'affection');
    assert(affection.companion.pose === 'affection', '单击没有切换亲近姿势');
    await waitForPendantAction(pendant, 'affection');
    pendant.setState('happy');
    const happy = await expectPendantState(pendant, 'happy');
    assert(happy.companion.pose === 'happy', '双击没有切换开心姿势');
    await waitForPendantAction(pendant, 'wave');
    pendant.setState('idle');
    return `亲近 / 开心独立动作 · ${((performance.now() - started) / 1000).toFixed(1)} 秒`;
  }));

  for (const [id, label, phase] of [
    ['listening', '倾听状态', 'listening'],
    ['thinking', '思考状态', 'thinking'],
    ['speaking', '说话状态', 'speaking']
  ]) {
    results.push(await check(id, label, async () => {
      phone.setPhase(phase);
      await expectPendantState(pendant, phase);
      const expectedAction = { listening: 'idle', thinking: 'nod', speaking: 'speaking' }[phase];
      await waitFor(() => {
        const model = phone.getModelState();
        return model.status === 'ready' && model.action === expectedAction;
      });
      assert(phone.getModelState().modelGeneration === phoneModelGeneration, '动作切换重新创建了整套模型');
      return `手机与圆屏一致 / ${expectedAction}`;
    }));
  }

  results.push(await check('power', '电源状态', async () => {
    pendant.setBattery(8);
    pendant.setState('idle');
    await expectPendantState(pendant, 'low-power');
    pendant.setBattery(76);
    pendant.setState('charging');
    await expectPendantState(pendant, 'charging');
    pendant.setState('sleep');
    await expectPendantState(pendant, 'sleep');
    pendant.setState('idle');
    return '低电量 / 充电 / 休眠';
  }));

  results.push(await check('chat', '连续对话与人格成长', async () => {
    const before = phone.getState();
    await phone.sendMessage('今天有点累，想和你待一会儿');
    const after = phone.getState();
    assert(after.history.at(-2)?.role === 'user', '用户消息没有写入记录');
    assert(after.history.at(-1)?.role === 'assistant', '回答没有写入记录');
    assert(after.profile.bond === before.profile.bond + 8, '对话没有增加共鸣');
    return `已回答 / 共鸣 +${after.profile.bond - before.profile.bond}`;
  }));

  results.push(await check('continuity', '跨端身份连续', async () => {
    const phoneState = phone.getState();
    await waitFor(() => {
      const desktopState = desktop.getState();
      return desktopState.profile?.id === phoneState.profile.id
        && desktopState.profile.bond === phoneState.profile.bond
        && desktopState.history.at(-1)?.content === phoneState.history.at(-1)?.content;
    }, 5000);
    desktop.interact('care');
    const synchronized = await waitFor(() => {
      const nextPhone = phone.getState();
      const nextDesktop = desktop.getState();
      const nextPendant = pendant.getSnapshot();
      return nextPhone.profile.bond === phoneState.profile.bond + 5
        && nextDesktop.profile.bond === nextPhone.profile.bond
        && nextPendant?.companion?.bond === nextPhone.profile.bond
        ? nextPhone
        : null;
    }, 5000);
    assert(synchronized.profile.name === phoneState.profile.name, '伙伴名字发生变化');
    return `${synchronized.profile.name} / 记忆与共鸣三端一致`;
  }));

  results.push(await check('voice', '真实声线接口', async () => {
    let totalBytes = 0;
    for (const cast of creatureVoiceResources) {
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '我在这里，慢慢说。',
          persona: `creature:${cast.starter}`,
          relationship: 'companion',
          mood: 'calm',
          archetype: cast.archetype,
          starter: cast.starter
        })
      });
      const type = response.headers.get('content-type') || '';
      assert(response.ok, `${cast.name}接口返回 ${response.status}`);
      assert(type.includes('audio'), `${cast.name}没有返回音频`);
      assert(response.headers.get('x-qiban-archetype') === cast.archetype, `${cast.name}路由错误`);
      assert(response.headers.get('x-qiban-voice') === cast.voice, `${cast.name}声线错误`);
      const audio = await response.blob();
      assert(audio.size > 1000, `${cast.name}音频内容为空`);
      totalBytes += audio.size;
    }
    return `三路线匹配 / ${Math.round(totalBytes / 1024)} KB 音频`;
  }));

  results.push(await check('disconnect', '断连显示', async () => {
    pendant.setConnected(false);
    const snapshot = await waitFor(() => pendant.getSnapshot()?.connected === false && pendant.getSnapshot());
    assert(snapshot.connected === false, '断连状态未生效');
    return '离线标记正常';
  }));

  const passed = results.filter(Boolean).length;
  summary.dataset.status = passed === results.length ? 'pass' : 'fail';
  summary.textContent = `${passed} / ${results.length} 通过`;
  runButton.disabled = false;
  runButton.textContent = '重新运行';
}

runButton.addEventListener('click', () => {
  loadFrames();
  runAllTests();
});
resetButton.addEventListener('click', () => {
  if (!window.confirm('这会将当前浏览器里的伴侣替换为电脑测试资料。确定继续吗？')) return;
  seedDemoProfile(true);
  location.reload();
});

seedDemoProfile();
loadFrames();
if (new URLSearchParams(location.search).get('autorun') === '1') {
  runAllTests();
}
