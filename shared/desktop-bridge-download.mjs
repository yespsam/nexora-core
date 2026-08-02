export const DESKTOP_BRIDGE_RELEASE_TAG = 'bridge-v0.2.1-internal';

const releaseBase = `https://github.com/yespsam/nexora-core/releases/download/${DESKTOP_BRIDGE_RELEASE_TAG}`;
const releasePage = `https://github.com/yespsam/nexora-core/releases/tag/${DESKTOP_BRIDGE_RELEASE_TAG}`;

export const DESKTOP_BRIDGE_DOWNLOADS = Object.freeze({
  macos: Object.freeze({
    id: 'macos',
    label: 'macOS 通用版',
    shortLabel: 'macOS',
    file: 'NEXORA-Bridge-macOS.dmg',
    href: `${releaseBase}/NEXORA-Bridge-macOS.dmg`
  }),
  'windows-x64': Object.freeze({
    id: 'windows-x64',
    label: 'Windows x64',
    shortLabel: 'Win x64',
    file: 'NEXORA-Bridge-Windows-x64.zip',
    href: `${releaseBase}/NEXORA-Bridge-Windows-x64.zip`
  }),
  'windows-arm64': Object.freeze({
    id: 'windows-arm64',
    label: 'Windows ARM64',
    shortLabel: 'Win ARM',
    file: 'NEXORA-Bridge-Windows-ARM64.zip',
    href: `${releaseBase}/NEXORA-Bridge-Windows-ARM64.zip`
  })
});

function platformText(navigatorValue) {
  return [
    navigatorValue?.userAgentData?.platform,
    navigatorValue?.platform,
    navigatorValue?.userAgent
  ].filter(Boolean).join(' ');
}

function isMobileNavigator(navigatorValue) {
  if (navigatorValue?.userAgentData?.mobile === true) return true;
  const value = platformText(navigatorValue);
  if (/android|iphone|ipod/i.test(value)) return true;
  return /ipad/i.test(value)
    || (/MacIntel/i.test(String(navigatorValue?.platform || '')) && Number(navigatorValue?.maxTouchPoints) > 1);
}

export async function detectDesktopBridgePlatform(navigatorValue = globalThis.navigator) {
  if (!navigatorValue || isMobileNavigator(navigatorValue)) return 'mobile';
  const value = platformText(navigatorValue);
  if (/windows|win32|win64/i.test(value)) {
    let architecture = String(navigatorValue?.userAgentData?.architecture || '');
    if (typeof navigatorValue?.userAgentData?.getHighEntropyValues === 'function') {
      try {
        const hints = await navigatorValue.userAgentData.getHighEntropyValues(['architecture', 'bitness']);
        architecture = `${hints?.architecture || architecture} ${hints?.bitness || ''}`;
      } catch (error) {
        // Browser privacy settings may decline high entropy client hints.
      }
    }
    return /arm|aarch/i.test(`${architecture} ${value}`) ? 'windows-arm64' : 'windows-x64';
  }
  if (/macintosh|macintel|mac os/i.test(value)) return 'macos';
  return 'unknown';
}

export function desktopBridgeDownloadView(platformValue) {
  const platform = String(platformValue || 'unknown');
  const download = DESKTOP_BRIDGE_DOWNLOADS[platform];
  if (download) {
    return Object.freeze({
      platform,
      label: download.label,
      note: '已为当前电脑选择安装包',
      action: '下载',
      href: download.href
    });
  }
  return Object.freeze({
    platform,
    label: platform === 'mobile' ? '在目标电脑安装' : '选择电脑系统',
    note: platform === 'mobile' ? '手机保留配对码，电脑负责运行客户端' : '请选择 macOS 或 Windows 版本',
    action: '查看版本',
    href: releasePage
  });
}
