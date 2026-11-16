import os
import sqlite3
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "races.db"))

app = Flask(__name__, static_folder="static", static_url_path="/static")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS races (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
                maze_size INTEGER NOT NULL,
                robot1_explored INTEGER, robot2_explored INTEGER, robot3_explored INTEGER,
                robot1_path INTEGER, robot2_path INTEGER, robot3_path INTEGER,
                winner INTEGER NOT NULL,
                player_rank INTEGER
            )
            """
        )
        cols = [r[1] for r in conn.execute("PRAGMA table_info(races)")]
        if "player_rank" not in cols:
            conn.execute("ALTER TABLE races ADD COLUMN player_rank INTEGER")


init_db()


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/stats")
def stats_page():
    return send_from_directory("static", "stats.html")


def _int_list(value):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError("3개 값이 필요합니다")
    out = [int(v) for v in value]
    if any(v < 0 or v > 100000 for v in out):
        raise ValueError("범위 오류")
    return out


@app.route("/api/results", methods=["POST"])
def save_result():
    data = request.get_json(silent=True) or {}
    try:
        size = int(data["size"])
        explored = _int_list(data["explored"])
        path = _int_list(data["path"])
        winner = int(data["winner"])
        player_rank = data.get("player_rank")
        if player_rank is not None:
            player_rank = int(player_rank)
            if player_rank not in (1, 2, 3, 4):
                raise ValueError("범위 오류")
        if not (5 <= size <= 101) or winner not in (1, 2, 3):
            raise ValueError("범위 오류")
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "잘못된 요청"}), 400

    with get_db() as conn:
        conn.execute(
            """INSERT INTO races (maze_size, robot1_explored, robot2_explored, robot3_explored,
                                  robot1_path, robot2_path, robot3_path, winner, player_rank)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (size, *explored, *path, winner, player_rank),
        )
    return jsonify({"ok": True}), 201


@app.route("/api/stats")
def get_stats():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM races ORDER BY id").fetchall()

    total = len(rows)
    wins = {1: 0, 2: 0, 3: 0}
    ex_sum = {1: 0, 2: 0, 3: 0}
    path_sum = {1: 0, 2: 0, 3: 0}
    by_size = {}
    for r in rows:
        wins[r["winner"]] += 1
        for k in (1, 2, 3):
            ex_sum[k] += r[f"robot{k}_explored"] or 0
            path_sum[k] += r[f"robot{k}_path"] or 0
        s = by_size.setdefault(r["maze_size"], {"size": r["maze_size"], "total": 0, "wins": [0, 0, 0]})
        s["total"] += 1
        s["wins"][r["winner"] - 1] += 1

    def avg(d):
        return {str(k): (round(v / total, 1) if total else 0) for k, v in d.items()}

    ranks = [r["player_rank"] for r in rows if r["player_rank"] is not None]
    player = {
        "games": len(ranks),
        "wins": sum(1 for x in ranks if x == 1),
        "avg_rank": round(sum(ranks) / len(ranks), 2) if ranks else 0,
    }

    recent = [
        {
            "id": r["id"],
            "created_at": r["created_at"],
            "size": r["maze_size"],
            "explored": [r["robot1_explored"], r["robot2_explored"], r["robot3_explored"]],
            "winner": r["winner"],
            "player_rank": r["player_rank"],
        }
        for r in rows[-10:][::-1]
    ]
    return jsonify(
        {
            "total": total,
            "wins": {str(k): v for k, v in wins.items()},
            "win_rate": {str(k): (round(v * 100 / total, 1) if total else 0) for k, v in wins.items()},
            "avg_explored": avg(ex_sum),
            "avg_path": avg(path_sum),
            "player": player,
            "by_size": sorted(by_size.values(), key=lambda x: x["size"]),
            "recent": recent,
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
