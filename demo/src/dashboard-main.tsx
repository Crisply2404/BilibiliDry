import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { Dashboard } from '../../src/dashboard/Dashboard';
import { boot, videoPageUrl } from './boot';
import { DEMO_VIDEOS } from './videos';

void (async () => {
  await boot({ onOpenOptions: () => alert('真实扩展里这里会打开设置页（选服务商、填 API Key）。演示固定使用模拟模型。') });
  createRoot(document.getElementById('root')!).render(
    <>
      <Dashboard />
      <a
        href={videoPageUrl(DEMO_VIDEOS[0].bvid)}
        style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 50, padding: '6px 12px', borderRadius: 999, background: '#18191C', color: '#fff', fontSize: 12, textDecoration: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}
      >
        在线演示 · 数据来自模拟模型 · 返回视频页
      </a>
    </>
  );
})();
