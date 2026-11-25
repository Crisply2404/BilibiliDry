import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'BilibiliDry - B站视频AI脱水助手',
  short_name: 'BilibiliDry',
  description: 'B 站长视频 AI 助手：干货热力图、一键/自动跳过注水、带时间戳出处的视频问答、跨视频知识库。自带 Key，数据只存本地。',
  version: pkg.version,
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  permissions: ['storage', 'tabs'],
  host_permissions: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://*.hdslb.com/*'],
  // Model endpoints are user-chosen; access is requested at runtime for the one origin the user configures.
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  action: { default_title: 'BilibiliDry', default_popup: 'popup.html', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } },
  options_page: 'options.html',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['https://www.bilibili.com/video/*'],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle'
    }
  ]
});
