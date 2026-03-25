---
name: daily-stock-analysis
description: >
  A股/港股/美股智能分析系统。当用户要求分析股票、查看大盘复盘、或生成市场简报时使用。
  支持个股分析（技术面+筹码+舆情+AI决策仪表盘）和大盘复盘（A股/美股/both）。
  触发词：「分析茅台」「analyze AAPL」「帮我看看 600519」「大盘复盘」「美股复盘」「港股分析」「对冲简报」。
metadata:
  version: "1.0.0"
  author: "小龙虾"
  source: "https://github.com/ZhuLinsen/daily_stock_analysis"
---

## 安装位置

- **项目目录**: `/home/xtrao/daily_stock_analysis`
- **Python**: `/usr/local/bin/python3.11`
- **虚拟环境**: `/home/xtrao/daily_stock_analysis/venv`
- **配置文件**: `/home/xtrao/daily_stock_analysis/.env`
- **报告目录**: `/home/xtrao/daily_stock_analysis/reports/`

## 股票代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| A股 | 6位数字 | `600519`、`000001`、`300750` |
| 港股 | hk + 5位数字 | `hk00700`、`hk09988`、`hk01810` |
| 美股 | 1-5字母 | `AAPL`、`TSLA`、`NVDA`、`BRK.B` |
| 美股指数 | 缩写 | `SPX`、`DJI`、`IXIC`、`VIX` |

## 运行命令

所有命令必须先激活虚拟环境：

```bash
cd /home/xtrao/daily_stock_analysis && source venv/bin/activate
```

### 1. 分析指定股票

修改 `.env` 中的 `STOCK_LIST`，然后运行：

```bash
# 编辑 STOCK_LIST（逗号分隔）
# 例如: STOCK_LIST=600519,AAPL,hk00700

python main.py --force-run --no-notify --no-market-review
```

- `--force-run`: 忽略交易日检查（周末/假期也能跑）
- `--no-notify`: 不推送通知（我们自己读报告）
- `--no-market-review`: 跳过大盘复盘（只看个股）

### 2. 仅大盘复盘

```bash
python main.py --market-review --force-run --no-notify
```

复盘区域由 `.env` 中 `MARKET_REVIEW_REGION` 控制：
- `cn` — 仅 A 股
- `us` — 仅美股
- `both` — A 股 + 美股

### 3. 个股 + 大盘复盘（完整模式）

```bash
python main.py --force-run --no-notify
```

### 4. 报告输出

运行完成后，报告文件位于：
- **个股分析**: `reports/report_YYYYMMDD.md`
- **大盘复盘**: `reports/market_review_YYYYMMDD.md`

读取报告后，以简洁的中文格式呈现给用户。

## 操作流程

当用户请求分析股票时：

1. **解析用户意图**：识别股票代码 / 市场 / 是否需要大盘复盘
2. **修改 `.env`**：更新 `STOCK_LIST` 和 `MARKET_REVIEW_REGION`
3. **运行分析**：执行对应命令（注意先 `cd` + `source venv/bin/activate`）
4. **读取报告**：从 `reports/` 目录读取生成的 `.md` 文件
5. **呈现结果**：以简洁格式向用户展示核心结论

## 常见中文名 → 代码映射

| 中文名 | 代码 |
|--------|------|
| 茅台 | 600519 |
| 腾讯 | hk00700 |
| 阿里 / 阿里巴巴 | hk09988 |
| 小米 | hk01810 |
| 平安 / 中国平安 | hk02318 |
| 美团 | hk03690 |
| 比亚迪 | 002594 |
| 宁德时代 | 300750 |

## 注意事项

- 每只股票分析约 **2-3 分钟**，批量分析请预估总时间
- 没有配置 Tavily/SerpAPI 等搜索 key，新闻搜索依赖 SearXNG 公共实例（可能被限速）
- AI 模型使用 **Gemini** (通过 `.env` 中的 `GEMINI_API_KEY`)
- **非交易日**数据为上一交易日收盘价，分析结论仅供参考
- 港股部分数据源（Eastmoney）从 Azure VM 访问可能不稳定，会自动降级到 YFinance
