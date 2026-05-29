# 歌曲推荐去重与质量优化设计

## 1. 问题背景

当前 Claudio 歌曲推荐存在两个问题：

1. **推荐重复歌曲**：去重仅在当前会话内有效（`radio-session.js` 的 `playedIds`），会话结束即丢失；网易云搜索按相关性排序，热门歌曲永远靠前。
2. **推荐到翻唱/低质量歌曲**：Claude 搜索词生成时没有质量约束。

## 2. 解决方案

### 方案 1（采纳）：持久化历史 + Prompt 质量引导

```
数据库层：SQLite 记录播放历史（songId + title + artist + playedAt，保留14天）
去重层：搜索时排除历史记录中的 songId（跨会话有效）
Prompt 层：DJ persona prompt 中加入质量判断指令
```

两层职责互补：
- **数据库层**：解决"同一首歌反复推荐"（历史记录跨会话持久化）
- **Prompt 层**：解决"推荐到翻唱/低质量歌曲"（Claude 推理时判断质量）

## 3. 详细设计

### 3.1 配置项

**`.env.example` 新增**：
```
# 播放历史保留天数（默认14天）
PLAY_HISTORY_DAYS=14
```

**`config.js`**：新增 `playHistoryDays` 配置项，默认 14。

### 3.2 数据库层

**现有 `plays` 表结构已足够**：
- `source_id` → 存储 `originalId`（网易云歌曲唯一标识）
- `timestamp` → 即 `playedAt`
- 已有字段：`title`、`artist`

**新增/修改函数**：

| 函数 | 作用 |
|------|------|
| `getPlayedSongIds(days)` | 返回最近 N 天已播放的 `source_id` 数组 |
| `cleanupOldPlays()` | 删除超过保留天数的记录 |

**触发时机**：服务启动时检查并清理旧记录。

**SQLite 清理语句**：
```sql
DELETE FROM plays WHERE timestamp < datetime('now', '-14 days')
```

### 3.3 搜索去重流程

```
用户请求"推荐轻松的纯音乐"
  ↓
1. 调用 getPlayedSongIds(PLAY_HISTORY_DAYS) → 最近 N 天已播放的 songId 列表
2. 将列表传入 searchSongs() 的 excludeIds 参数
3. 网易云返回的结果自动排除这批 songId
  ↓
返回结果不包含最近播放过的歌曲
```

**注意**：`radio-session.js` 的会话级 `playedIds` 保留，与数据库层去重**互补**：
- 数据库层：跨会话长期去重（14天）
- 会话层：同一次对话内不重复（短期）

### 3.4 播放记录持久化

`router.js` 中 `handleMusicCommand` 播放成功时，`savePlay` 已存在，确保每次播放都调用。

### 3.5 Prompt 质量引导

在 `data/taste.md` 新增 `## 推荐质量原则` 小节：

```
## 推荐质量原则
- 优先选择歌曲的官方版本/原版，避免翻唱
- 搜索词尽量具体（如"轻音乐 钢琴 放松 原版"而非"纯音乐"）
- 关注艺人的热门代表作
```

## 4. 数据流

```
用户请求 → router.js → getPlayedSongIds(14) → searchSongs(excludeIds)
                                              ↓
                                           网易云 API（已过滤）
                                              ↓
                                           播放结果通过 savePlay 写入数据库
```

## 5. 影响范围

| 文件 | 改动 |
|------|------|
| `src/config.js` | 新增 `playHistoryDays` 配置项 |
| `src/db.js` | 新增 `getPlayedSongIds()`、`cleanupOldPlays()` |
| `src/router.js` | 搜索前调用 `getPlayedSongIds()` 传入 `excludeIds` |
| `src/server.js` | 启动时调用 `cleanupOldPlays()` |
| `data/taste.md` | 新增 `## 推荐质量原则` 小节 |
| `.env.example` | 新增 `PLAY_HISTORY_DAYS` |

## 6. 存储估算

以每天播放 20 首、保留 14 天计算：最多约 280 条记录，单条记录 < 200 字节，总存储 < 60KB，可忽略不计。