export const DEVICE_COMMAND_VERSION = 1;

const applicationNames = Object.freeze({
  safari: Object.freeze({ id: 'safari', label: 'Safari' }),
  '浏览器': Object.freeze({ id: 'safari', label: 'Safari' }),
  '音乐': Object.freeze({ id: 'music', label: '音乐' }),
  '日历': Object.freeze({ id: 'calendar', label: '日历' }),
  '备忘录': Object.freeze({ id: 'notes', label: '备忘录' }),
  '计算器': Object.freeze({ id: 'calculator', label: '计算器' })
});

function compact(value) {
  return String(value || '').trim().replace(/[\s，。！？,.!?]/g, '').toLowerCase();
}

function command(target, action, parameters, label) {
  return Object.freeze({
    version: DEVICE_COMMAND_VERSION,
    target,
    action,
    parameters: Object.freeze(parameters || {}),
    label
  });
}

function volumeCommand(text) {
  const level = text.match(/^(?:请|帮我|麻烦)?(?:把)?(?:电脑)?音量(?:调到|设置到|设置为|设为)(\d{1,3})%?$/)?.[1];
  if (level !== undefined) {
    const bounded = Math.max(0, Math.min(100, Number(level)));
    return command('computer', 'volume.set', { level: bounded }, `电脑音量已设为 ${bounded}%`);
  }
  if (/^(?:请|帮我|麻烦)?(?:把)?(?:电脑)?(?:静音|关掉声音)$/.test(text)) {
    return command('computer', 'volume.mute', {}, '电脑已静音');
  }
  if (/^(?:请|帮我|麻烦)?(?:把)?(?:电脑)?(?:取消静音|恢复声音)$/.test(text)) {
    return command('computer', 'volume.unmute', {}, '电脑声音已恢复');
  }
  if (/^(?:请|帮我|麻烦)?(?:把)?(?:电脑)?音量(?:调大|大一点|加大)$/.test(text)) {
    return command('computer', 'volume.change', { delta: 10 }, '电脑音量已调高');
  }
  if (/^(?:请|帮我|麻烦)?(?:把)?(?:电脑)?音量(?:调小|小一点|降低)$/.test(text)) {
    return command('computer', 'volume.change', { delta: -10 }, '电脑音量已调低');
  }
  return null;
}

function mediaCommand(text) {
  if (/^(?:请|帮我|麻烦)?(?:播放|继续播放)(?:音乐)?$/.test(text)) {
    return command('computer', 'media.play', {}, '音乐已开始播放');
  }
  if (/^(?:请|帮我|麻烦)?(?:暂停|暂停播放)(?:音乐)?$/.test(text)) {
    return command('computer', 'media.pause', {}, '音乐已暂停');
  }
  if (/^(?:请|帮我|麻烦)?(?:下一首|切到下一首)$/.test(text)) {
    return command('computer', 'media.next', {}, '已经切到下一首');
  }
  if (/^(?:请|帮我|麻烦)?(?:上一首|切到上一首)$/.test(text)) {
    return command('computer', 'media.previous', {}, '已经切到上一首');
  }
  return null;
}

function applicationCommand(text) {
  const requested = text.match(/^(?:请|帮我|麻烦)?打开(.+)$/)?.[1];
  const app = requested ? applicationNames[requested] : null;
  return app
    ? command('computer', 'app.open', { app: app.id }, `正在打开${app.label}`)
    : null;
}

function homeCommand(text) {
  const lightTrailing = text.match(/^(?:请|帮我|麻烦)?(?:把)?(客厅|卧室|书房)?(?:的)?灯(?:光)?(打开|开启|关掉|关闭)$/);
  const lightLeading = text.match(/^(?:请|帮我|麻烦)?(打开|开启|关掉|关闭)(客厅|卧室|书房)?(?:的)?灯(?:光)?$/);
  if (lightTrailing || lightLeading) {
    const room = lightTrailing?.[1] || lightLeading?.[2] || '全屋';
    const operation = lightTrailing?.[2] || lightLeading?.[1];
    const on = operation === '打开' || operation === '开启';
    return command('home', on ? 'light.on' : 'light.off', { room }, `${room}灯光已${on ? '打开' : '关闭'}`);
  }
  const curtainTrailing = text.match(/^(?:请|帮我|麻烦)?(?:把)?(客厅|卧室|书房)?(?:的)?窗帘(打开|拉开|关上|关闭)$/);
  const curtainLeading = text.match(/^(?:请|帮我|麻烦)?(打开|拉开|关上|关闭)(客厅|卧室|书房)?(?:的)?窗帘$/);
  if (curtainTrailing || curtainLeading) {
    const room = curtainTrailing?.[1] || curtainLeading?.[2] || '全屋';
    const operation = curtainTrailing?.[2] || curtainLeading?.[1];
    const open = operation === '打开' || operation === '拉开';
    return command('home', open ? 'curtain.open' : 'curtain.close', { room }, `${room}窗帘已${open ? '打开' : '关闭'}`);
  }
  const temperature = text.match(/^(?:请|帮我|麻烦)?(?:把)?(?:空调)?温度(?:调到|设置到|设为)(\d{1,2})度?$/)?.[1];
  if (temperature !== undefined) {
    const degrees = Math.max(16, Math.min(30, Number(temperature)));
    return command('home', 'climate.set', { degrees }, `空调温度已设为 ${degrees} 度`);
  }
  return null;
}

export function parseDeviceCommand(value) {
  const text = compact(value);
  if (!text) return null;
  return homeCommand(text) || volumeCommand(text) || mediaCommand(text) || applicationCommand(text);
}

export function normalizeDeviceCommand(value) {
  if (!value || value.version !== DEVICE_COMMAND_VERSION) return null;
  const target = value.target === 'computer' || value.target === 'home' ? value.target : '';
  const action = String(value.action || '');
  const parameters = value.parameters && typeof value.parameters === 'object' ? value.parameters : {};
  if (!target) return null;
  if (target === 'computer' && action === 'volume.set') {
    const level = Number(parameters.level);
    if (!Number.isInteger(level) || level < 0 || level > 100) return null;
    return command(target, action, { level }, `电脑音量已设为 ${level}%`);
  }
  if (target === 'computer' && action === 'volume.change') {
    const delta = Number(parameters.delta);
    if (delta !== -10 && delta !== 10) return null;
    return command(target, action, { delta }, `电脑音量已调${delta > 0 ? '高' : '低'}`);
  }
  const computerActions = {
    'volume.mute': '电脑已静音',
    'volume.unmute': '电脑声音已恢复',
    'media.play': '音乐已开始播放',
    'media.pause': '音乐已暂停',
    'media.next': '已经切到下一首',
    'media.previous': '已经切到上一首'
  };
  if (target === 'computer' && computerActions[action]) {
    return command(target, action, {}, computerActions[action]);
  }
  if (target === 'computer' && action === 'app.open') {
    const app = Object.values(applicationNames).find((entry) => entry.id === parameters.app);
    return app ? command(target, action, { app: app.id }, `正在打开${app.label}`) : null;
  }
  if (target === 'home' && ['light.on', 'light.off', 'curtain.open', 'curtain.close'].includes(action)) {
    const room = ['客厅', '卧室', '书房', '全屋'].includes(parameters.room) ? parameters.room : '';
    if (!room) return null;
    const labels = {
      'light.on': `${room}灯光已打开`,
      'light.off': `${room}灯光已关闭`,
      'curtain.open': `${room}窗帘已打开`,
      'curtain.close': `${room}窗帘已关闭`
    };
    return command(target, action, { room }, labels[action]);
  }
  if (target === 'home' && action === 'climate.set') {
    const degrees = Number(parameters.degrees);
    if (!Number.isInteger(degrees) || degrees < 16 || degrees > 30) return null;
    return command(target, action, { degrees }, `空调温度已设为 ${degrees} 度`);
  }
  return null;
}
