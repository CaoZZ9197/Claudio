# Claudio 歌曲收藏功能设计方案

## 概述

给 Claudio 增加歌曲收藏功能（"喜欢"列表），用户可以在播放器页面一键收藏正在播放的歌曲，并查看喜欢列表。参考网易云音乐的"喜欢"功能。

## 数据层

### liked_songs 表

```sql
CREATE TABLE IF NOT EXISTS liked_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL UNIQUE,
  liked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**设计决策**：
- `source_id UNIQUE`：防止同一首歌重复收藏
- 独立表：与播放历史清晰分离，职责单一

## API 层

### GET /api/liked

获取喜欢列表。

**响应**：
```json
{
  "songs": [
    { "id": 1, "title": "歌曲名", "artist": "艺术家", "album": "专辑", "source_id": "xxx", "liked_at": "2026-05-29T10:00:00" }
  ]
}
```

### POST /api/liked

添加歌曲到喜欢列表。

**请求**：
```json
{ "source_id": "xxx", "title": "歌曲名", "artist": "艺术家", "album": "专辑" }
```

**响应**：
```json
{ "ok": true, "song": { ... } }
```

- 若歌曲已喜欢，返回 `{ "ok": true, "already_liked": true }`
- 若添加失败，返回 `{ "ok": false, "error": "..." }`

### DELETE /api/liked/:sourceId

取消喜欢。

**响应**：
```json
{ "ok": true }
```

- 若歌曲不在列表中，返回 `{ "ok": true }`（幂等）

### GET /api/liked/check/:sourceId

检查指定歌曲是否已喜欢。

**响应**：
```json
{ "liked": true }
```

## 前端 UI

### 播放器区域喜欢按钮

位置：当前播放歌曲封面旁。

**交互**：
- 空心 ❦ 图标 = 未喜欢，点击后变为实心 ♥，并添加到服务器
- 实心 ♥ 图标 = 已喜欢，点击后变为空心 ❦，并从服务器移除
- **乐观更新**：点击即改变 UI，失败时回滚

**状态获取**：页面加载时或切歌时，调用 `GET /api/liked/check/:sourceId` 更新按钮状态。

### 侧边栏抽屉

**触发**：点击心形图标或专用按钮展开右侧抽屉。

**内容**：
- 标题"我喜欢"区域
- 喜欢列表，每项显示：歌曲标题、艺术家
- 点击列表项：直接播放该歌曲
- 列表项操作：左滑或删除图标取消喜欢

**关闭**：点击遮罩层或关闭按钮收起。

## 实现步骤

1. **数据库层**：`db.js` 新增 `liked_songs` 表初始化及相关操作函数
2. **API 层**：`src/api/routes.js` 新增 4 个喜欢相关端点
3. **前端状态**：`src/frontend/app.js` 新增喜欢列表状态管理
4. **UI - 喜欢按钮**：在播放器区域添加心形按钮，实现乐观更新
5. **UI - 侧边栏**：实现喜欢列表抽屉组件

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/db.js` | 新增 liked_songs 表及相关 CRUD 函数 |
| `src/api/routes.js` | 新增 4 个 API 端点 |
| `src/frontend/app.js` | 喜欢按钮、侧边栏抽屉、状态管理 |
| `src/frontend/styles.css` | 侧边栏抽屉样式 |
| `src/frontend/index.html` | 侧边栏抽屉 DOM 结构 |