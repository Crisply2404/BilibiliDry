import type { ManifestV3Export } from '@crxjs/vite-plugin';

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: 'BilibiliDry',
  description: 'B 站长视频智能“脱水”：热力图进度条 + 一键跳过注水 + 导出笔记 + 跨视频搜索（BYOK，本地记忆）',
  version: '0.1.0',
  permissions: ['storage', 'tabs'],
  host_permissions: [
    'https://www.bilibili.com/*',
    'https://api.bilibili.com/*',
    'https://*.hdslb.com/*',
    'https://generativelanguage.googleapis.com/*',
    'https://api.openai.com/*',
    'https://api.x.ai/*',
    'https://api.qnaigc.com/*',
    'https://right.codes/*',
    'https://*.right.codes/*'
  ],
  action: {
    default_title: 'BilibiliDry',
    default_popup: 'index.html'
  },
  options_page: 'options.html',
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['https://www.bilibili.com/video/*'],
      js: ['src/content-script/index.tsx'],
      run_at: 'document_idle'
    }
  ]
};

export default manifest;
