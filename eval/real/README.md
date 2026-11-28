# 真实视频评测数据

- `labels/<BV号>.json`：我们写的标注（注水段、模糊段、关键段、问题和参考答案），进仓库。
- `data/videos.json`：8 个视频的字幕、B 站 AI 总结和弹幕，属于原作者，只放本地（已在 `.gitignore` 里）。
- `run.ts`：评测脚本，`npm run eval:real`。

## `data/videos.json` 的格式

一个数组，每个视频一项：

```json
{
  "bvid": "BV…", "aid": 1, "cid": 2, "mid": 3,
  "title": "…", "owner": "…", "duration": 469, "tname": "", "desc": "…",
  "summary": "B 站 AI 总结",
  "outline": [{ "title": "…", "t": 1, "points": [[10, "要点"]] }],
  "lines": [[0, 2, "字幕一行"], [2, 3, "下一行"]],
  "danmaku": [[12.3, "弹幕内容"]]
}
```

## 怎么重新拉取

字幕要登录 B 站才能拿到，而且必须用和视频绑定的那份（不签名的播放器接口会返回别的视频的字幕）。做法：

1. 在登录了 B 站的浏览器里打开任意 B 站页面。
2. 对每个 `labels/` 里的 BV 号，按 `src/core/bilibili/api.ts` 的方式请求：先 `x/web-interface/view` 拿 `cid` 和 UP 主 `mid`，再用 WBI 签名请求 `x/web-interface/view/conclusion/get`。`model_result.subtitle` 是字幕，`summary` 和 `outline` 是 AI 总结。
3. 每次请求之间隔几秒。连续请求太快会被 B 站限流（HTTP 412），要等十几分钟才恢复。
4. 按上面的格式存成 `data/videos.json`。

B 站会更新 AI 字幕，重新拉取的字幕和标注时可能有出入。标注里的时间以 2026-11-28 拉取的版本为准。
