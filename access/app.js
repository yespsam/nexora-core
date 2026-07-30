const $ = (selector) => document.querySelector(selector);
const forms = [...document.querySelectorAll('[data-mode]')];
const status = $('#access-status');
const stateLabel = $('#access-state');
const title = $('#form-title');
const copy = $('#form-copy');

const modeContent = {
  login: ['验证身份', '使用受邀邮箱进入内部测试环境。'],
  invite: ['接受邀请', '设置密码后，这台设备会建立加密会话。'],
  'recovery-request': ['找回访问', '重置链接只会发送到已受邀的邮箱。'],
  'recovery-complete': ['设置新密码', '更新完成后会直接返回私有测试环境。'],
  processing: ['验证链接', '正在确认这次安全请求。']
};

let activeToken = '';

function nextPath() {
  const raw = new URL(location.href).searchParams.get('next') || '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  return raw.slice(0, 1200);
}

function setStatus(message, success = false) {
  status.textContent = message;
  status.classList.toggle('success', success);
}

function setMode(mode) {
  const content = modeContent[mode] || modeContent.login;
  title.textContent = content[0];
  copy.textContent = content[1];
  forms.forEach((form) => { form.hidden = form.dataset.mode !== mode; });
  setStatus('');
}

async function clearPrivateCaches() {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
}

async function api(route, payload = {}) {
  const response = await fetch(`/api/access/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'request_failed'), { status: response.status });
  return body;
}

function authError(error) {
  if (error?.message === 'invalid_credentials') return '邮箱或密码不正确。';
  if (error?.message === 'invalid_or_expired_link') return '链接无效或已经过期，请重新申请。';
  if (error?.message === 'invalid_request') return '请检查填写内容。';
  return '身份服务暂时不可用，请稍后重试。';
}

async function submitWithLock(form, operation) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  stateLabel.textContent = 'VERIFYING';
  setStatus('正在建立安全会话…');
  try {
    const result = await operation();
    stateLabel.textContent = 'AUTHORIZED';
    setStatus('验证通过，正在进入。', true);
    if (result?.next) location.replace(result.next);
  } catch (error) {
    stateLabel.textContent = 'LOCKED';
    setStatus(authError(error));
  } finally {
    button.disabled = false;
  }
}

$('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  submitWithLock(event.currentTarget, () => api('login', {
    email: data.get('email'),
    password: data.get('password'),
    next: nextPath()
  }));
});

$('#invite-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  if (data.get('password') !== data.get('confirm')) {
    setStatus('两次输入的密码不一致。');
    return;
  }
  submitWithLock(event.currentTarget, () => api('invite', {
    token: activeToken,
    password: data.get('password'),
    next: nextPath()
  }));
});

$('#recovery-request-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  submitWithLock(event.currentTarget, async () => {
    await api('recovery-request', { email: data.get('email') });
    stateLabel.textContent = 'SENT';
    setStatus('如果邮箱已获授权，重置链接已经发出。', true);
    return null;
  });
});

$('#recovery-complete-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  if (data.get('password') !== data.get('confirm')) {
    setStatus('两次输入的密码不一致。');
    return;
  }
  submitWithLock(event.currentTarget, () => api('recovery-complete', {
    token: activeToken,
    password: data.get('password'),
    next: nextPath()
  }));
});

$('#recovery-open').addEventListener('click', () => setMode('recovery-request'));
document.querySelectorAll('[data-back-login]').forEach((button) => {
  button.addEventListener('click', () => setMode('login'));
});

async function initialize() {
  await clearPrivateCaches().catch(() => {});
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const inviteToken = hash.get('invite_token');
  const recoveryToken = hash.get('recovery_token');
  const confirmationToken = hash.get('confirmation_token');
  history.replaceState(null, '', `${location.pathname}${location.search}`);

  if (inviteToken) {
    activeToken = inviteToken;
    stateLabel.textContent = 'INVITED';
    setMode('invite');
    return;
  }
  if (recoveryToken) {
    activeToken = recoveryToken;
    stateLabel.textContent = 'RECOVERY';
    setMode('recovery-complete');
    return;
  }
  if (confirmationToken) {
    setMode('processing');
    try {
      const result = await api('confirm', { token: confirmationToken, next: nextPath() });
      location.replace(result.next);
    } catch (error) {
      stateLabel.textContent = 'LOCKED';
      setStatus(authError(error));
    }
    return;
  }

  if (new URL(location.href).searchParams.has('signedOut')) {
    stateLabel.textContent = 'SIGNED OUT';
    setStatus('已安全退出，设备缓存已经清理。', true);
  }
  try {
    const response = await fetch('/api/access/status', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const current = await response.json();
    if (current.authenticated) {
      location.replace(nextPath());
      return;
    }
  } catch (error) {
    setStatus('身份服务尚未连接。');
  }
  if (!new URL(location.href).searchParams.has('signedOut')) stateLabel.textContent = 'LOCKED';
}

initialize();
