# twitterapi-news references

官方文档：

- Advanced search: https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
- Batch user info by IDs: https://docs.twitterapi.io/api-reference/endpoint/batch_get_user_by_userids
- User last tweets: https://docs.twitterapi.io/api-reference/endpoint/user_last_tweets

## 当前技能使用的接口

### Advanced tweet search

- Path: `/twitter/tweet/advanced_search`
- 参数：`query`、`queryType`（`Latest` / `Top`）、`cursor`

常用 query：

- `(OpenAI OR Anthropic) -is:reply -is:retweet`
- `TSMC AI since_time:1713312000 until_time:1713398400 -is:reply`
- `(NVIDIA OR NVDA) lang:en -is:retweet`
- `from:OpenAI GPT -is:reply`

### Batch user info by ids

- Path: `/twitter/user/batch_info_by_ids`
- 参数：`userIds`，逗号分隔 user id

### User last tweets

- Path: `/twitter/user/last_tweets`
- 参数：`userId`、`userName`、`includeReplies`、`cursor`

## 输出字段

新闻简报优先保留：`createdAt`、`url`、`author.name` / `author.userName`、`text`、`likeCount`、`retweetCount`、`replyCount`、`viewCount`。

## 风险

Twitter/X 是快线索源，不是最终单一信源。单条帖文可能误传、断章取义或只是二手搬运；对外发送前尽量用官方公告、公司博客、监管文件或主流媒体二次确认。
