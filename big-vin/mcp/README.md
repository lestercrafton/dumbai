# Big Vin MCP server (read-only)

Lets any MCP client (Claude, Cursor, ChatGPT connectors, other agents) read Big Vin's board: games, lines, edge rankings, model inputs and graded results. It only reads the live site's public API (https://big-vin-grind-to-win.sunlightisfree.chatgpt.site/api/...). It has no write tools, needs no secrets, and has no npm dependencies (Node 22+).

## Tools

| Tool | What it returns |
|---|---|
| `get_rankings` | Upcoming games ranked by edge (fair spread vs market), NFL + college football by default. Args: `sport?`, `date?`, `limit?` |
| `get_slate` | Games for a league with kickoff in UTC and Central time, teams, venue, status. Args: `sport`, `date?` |
| `get_lines` | First-saved market plus current spread, total and moneyline with timestamps. Args: `sport`, `date?`, `game_id?` |
| `get_game` | One game in full: lines, projection, edge, pick, result. Args: `sport`, `game_id`, `date?` |
| `get_model_inputs` | Model version, tuning parameters, per-game ratings, home and rest adjustments. Args: `sport`, `game_id?` |
| `get_methodology` | Plain-language explanation of the fair line, edge, data sources and grading |
| `get_track_record` | Graded pregame results by model version. Args: `sport` |

`sport` is one of `nfl`, `cfb`, `nba`, `wnba`, `cbb`, `nhl`, `mlb`.

## Run it

```sh
node big-vin/mcp/server.mjs              # stdio
node big-vin/mcp/server.mjs --http 8787  # Streamable HTTP at http://localhost:8787/mcp
```

## Connect

Claude Desktop / Claude Code / Cursor (stdio), e.g. `claude_desktop_config.json` or `.cursor/mcp.json`:

```json
{ "mcpServers": { "big-vin": { "command": "node", "args": ["/path/to/dumbai/big-vin/mcp/server.mjs"] } } }
```

Claude Code one-liner: `claude mcp add big-vin -- node /path/to/dumbai/big-vin/mcp/server.mjs`

HTTP clients and ChatGPT connectors need a public HTTPS URL. Run `--http` on any Node host and point the client at `https://<host>/mcp`. A `/mcp` endpoint on the Big Vin site itself has to be added in the site's own project, which isn't in this repo.

`mcp.json` and `llms.txt` in this folder describe the server for agents that look for a discovery file.
