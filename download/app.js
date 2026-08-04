const releaseBase = 'https://github.com/yespsam/nexora-core/releases/download/nexora-core-v0.3.0-internal';

const downloads = {
  windows: {
    href: `${releaseBase}/NEXORA-Bridge-Windows-x64.zip`,
    label: '下载 Windows x64',
    note: '适用于普通 Intel / AMD 电脑 · ZIP 免安装版'
  },
  'windows-arm': {
    href: `${releaseBase}/NEXORA-Bridge-Windows-ARM64.zip`,
    label: '下载 Windows ARM64',
    note: '适用于 Snapdragon Windows 电脑 · ZIP 免安装版'
  },
  macos: {
    href: `${releaseBase}/NEXORA-Bridge-macOS.dmg`,
    label: '下载 macOS',
    note: '适用于 Apple Silicon 与 Intel Mac · DMG'
  }
};

function detectedPlatform() {
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  const architecture = String(navigator.userAgentData?.architecture || '').toLowerCase();
  if (platform.includes('mac')) return 'macos';
  if (platform.includes('win') && architecture.includes('arm')) return 'windows-arm';
  return 'windows';
}

const platform = detectedPlatform();
const selected = downloads[platform];
const recommended = document.querySelector('#recommended-download');
const label = document.querySelector('#recommended-label');
const note = document.querySelector('#recommended-note');

if (recommended && label && note && selected) {
  recommended.href = selected.href;
  label.textContent = selected.label;
  note.textContent = selected.note;
  document.querySelector(`[data-platform="${platform}"]`)?.setAttribute('data-recommended', 'true');
}
