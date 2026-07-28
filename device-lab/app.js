import {
  SOULMATE_HISTORY_KEY,
  SOULMATE_STORAGE_KEY,
  createSoulmateProfile,
  normalizeSoulmateProfile,
  stageProgress
} from '../shared/soulmate-profile.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const phoneFrame = $('#phone-frame');
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
    voice: 'soft'
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
  phoneFrame.src = '../soulmate/?lab=1&release=3d-only-v2';
  pendantFrame.src = '../pendant-display/?lab=1&state=idle&release=3d-only-v2';
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(read, timeout = 8000, interval = 50) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = read();
    if (value) return value;
    await delay(interval);
  }
  throw new Error('等待模拟器响应超时');
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
  let pendant;
  const results = [];
  results.push(await check('views', '双端界面加载', async () => {
    phone = await waitFor(() => phoneFrame.contentWindow?.__NEXORA_LAB__);
    pendant = await waitFor(() => pendantFrame.contentWindow?.__NEXORA_PENDANT_LAB__);
    assert(phone.getState().profile, '手机端没有伴侣资料');
    return '双端就绪';
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
    const size = roundDisplay.getBoundingClientRect();
    assert(Math.abs(size.width - 240) <= 2 && Math.abs(size.height - 240) <= 2, `圆屏为 ${Math.round(size.width)}×${Math.round(size.height)}`);
    return '3D 模型正常 / 240×240';
  }));

  results.push(await check('pair', '虚拟蓝牙连接', async () => {
    await phone.connectPendant();
    await waitFor(() => phone.getState().pendantConnected);
    await waitFor(() => pendant.getSnapshot()?.connected);
    return 'NC-01 已连接';
  }));

  results.push(await check('identity', '身份同步', async () => {
    const phoneState = phone.getState();
    const snapshot = await waitFor(() => {
      const current = pendant.getSnapshot();
      return current?.companion?.name === phoneState.profile.name ? current : null;
    });
    assert(snapshot.companion.bond === phoneState.profile.bond, '共鸣值没有同步');
    assert(snapshot.companion.stage === stageProgress(phoneState.profile).stage.id, '成长形态没有同步');
    return `${snapshot.companion.name} / ${snapshot.companion.stageName}`;
  }));

  results.push(await check('poses', '3D 互动动作', async () => {
    pendant.setState('affection');
    const affection = await expectPendantState(pendant, 'affection');
    assert(affection.companion.pose === 'affection', '单击没有切换亲近姿势');
    await waitFor(() => pendant.getModelState().status === 'ready'
      && pendant.getModelState().action === 'affection');
    pendant.setState('happy');
    const happy = await expectPendantState(pendant, 'happy');
    assert(happy.companion.pose === 'happy', '双击没有切换开心姿势');
    await waitFor(() => pendant.getModelState().status === 'ready'
      && pendant.getModelState().action === 'wave');
    pendant.setState('idle');
    return '亲近 / 开心使用独立 3D 动作';
  }));

  for (const [id, label, phase] of [
    ['listening', '倾听状态', 'listening'],
    ['thinking', '思考状态', 'thinking'],
    ['speaking', '说话状态', 'speaking']
  ]) {
    results.push(await check(id, label, async () => {
      phone.setPhase(phase);
      await expectPendantState(pendant, phase);
      return '手机与圆屏一致';
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

  results.push(await check('voice', '真实声线接口', async () => {
    const response = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '我在这里，慢慢说。',
        persona: 'female',
        relationship: 'companion',
        mood: 'calm'
      })
    });
    const type = response.headers.get('content-type') || '';
    assert(response.ok, `接口返回 ${response.status}`);
    assert(type.includes('audio'), '接口没有返回音频');
    const audio = await response.blob();
    assert(audio.size > 1000, '音频内容为空');
    return `${Math.round(audio.size / 1024)} KB 音频`;
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

runButton.addEventListener('click', runAllTests);
resetButton.addEventListener('click', () => {
  if (!window.confirm('这会将当前浏览器里的伴侣替换为电脑测试资料。确定继续吗？')) return;
  seedDemoProfile(true);
  location.reload();
});

seedDemoProfile();
loadFrames();
if (new URLSearchParams(location.search).get('autorun') === '1') {
  Promise.all([
    new Promise((resolve) => phoneFrame.addEventListener('load', resolve, { once: true })),
    new Promise((resolve) => pendantFrame.addEventListener('load', resolve, { once: true }))
  ]).then(() => runAllTests());
}
