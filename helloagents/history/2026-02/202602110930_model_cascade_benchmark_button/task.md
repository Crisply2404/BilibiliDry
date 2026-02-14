[√] 目标：在 Dashboard「开发者模式」里提供一个按钮，一键自动跑“另一种模式”的对照实验，并把结果写入 runs，方便 latest vs prev 直接对比。

[√] 按钮行为：
  - 当前 latest 是 cheap+strong → 按钮自动跑“只用 strong”对照组
  - 当前 latest 是只用 strong → 按钮自动跑“cheap+strong”对照组（需要配置 cheapModel/strongModel）

[√] 对比口径：
  - 成本/耗时：复用现有 runs.metrics（calls / ms / reqChars / respChars）
  - 质量：复用 Reflection Gate 统计（pass/weak/fail/repaired + avgScore）

[√] 安全与体验：
  - 仅在 developerMode 开启时显示按钮
  - Benchmark 运行期间展示进度与当前模式
  - Benchmark 不写 segments，不覆盖用户现有分析结果（只写 runs）

[?] 验证：
  - 点击按钮后 Dashboard 显示进度
  - 结束后 latest/prev 出现两次不同 cascadeEnabled 的 run
  - Overlay/历史 segments 不受影响
