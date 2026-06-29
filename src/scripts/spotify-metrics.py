import json
import os
import sqlite3
import sys
from datetime import datetime, date, timedelta

try:
    from spotifyconnector import SpotifyConnector
except Exception as exc:  # pragma: no cover - runtime dependency guard
    print(json.dumps({"message": f"spotifyconnector is unavailable: {exc}"}))
    sys.exit(1)


def compact(value):
    if isinstance(value, dict):
        return {key: compact(val) for key, val in value.items()}
    if isinstance(value, list):
        return [compact(item) for item in value]
    return value


def first_number(*values):
    for value in values:
        if isinstance(value, (int, float)):
            return float(value)
    return None


def percent_change(current, previous):
    if current is None or previous is None:
        return None
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 2)


def extract_metric(payload, *keys):
    if not isinstance(payload, dict):
        return None
    for key in keys:
        if key in payload:
            value = payload[key]
            if isinstance(value, (int, float)):
                return float(value)
    for value in payload.values():
        if isinstance(value, dict):
            metric = extract_metric(value, *keys)
            if metric is not None:
                return metric
    return None


def extract_nested_metric(payload, *path):
    current = payload
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    if isinstance(current, (int, float)):
        return float(current)
    return None


def first_numeric(payload):
    if isinstance(payload, (int, float)):
        return float(payload)
    if isinstance(payload, dict):
        for value in payload.values():
            metric = first_numeric(value)
            if metric is not None:
                return metric
    if isinstance(payload, list):
        for value in payload:
            metric = first_numeric(value)
            if metric is not None:
                return metric
    return None


def count_followers(metadata):
    if not isinstance(metadata, dict):
        return None
    for key in ("followers", "followerCount", "followersCount"):
        value = metadata.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, dict):
            nested = extract_metric(value, "total", "count", "value")
            if nested is not None:
                return nested
    return first_numeric(metadata)


def choose_metric(payload, candidates):
    for candidate in candidates:
        if isinstance(candidate, tuple):
            metric = extract_nested_metric(payload, *candidate)
        else:
            metric = extract_metric(payload, candidate)
        if metric is not None:
            return metric
    return None


def choose_metric_with_scoped_fallback(payload, candidates, scopes):
    metric = choose_metric(payload, candidates)
    if metric is not None:
        return metric
    if isinstance(payload, dict):
        for scope in scopes:
            if scope in payload:
                scoped = first_numeric(payload[scope])
                if scoped is not None:
                    return scoped
    return first_numeric(payload)


def resolve_metric_with_source(payload, candidates, scopes):
    metric = choose_metric(payload, candidates)
    if metric is not None:
        return metric, "direct"
    if isinstance(payload, dict):
        for scope in scopes:
            if scope in payload and isinstance(payload[scope], dict):
                nested = choose_metric(payload[scope], candidates)
                if nested is not None:
                    return nested, scope
    fallback = first_numeric(payload)
    if fallback is not None:
        return fallback, "first_numeric"
    return None, None


def resolve_metric(payload, candidates, scopes):
    resolved = choose_metric(payload, candidates)
    if resolved is not None:
        return resolved
    if isinstance(payload, dict):
        for scope in scopes:
            if scope in payload and isinstance(payload[scope], dict):
                nested = choose_metric(payload[scope], candidates)
                if nested is not None:
                    return nested
    return first_numeric(payload)


def collect_numeric_paths(payload, prefix=""):
    result = {}
    if isinstance(payload, (int, float)):
        result[prefix.rstrip(".")] = float(payload)
        return result
    if isinstance(payload, dict):
        for key, value in payload.items():
            child_prefix = f"{prefix}{key}."
            result.update(collect_numeric_paths(value, child_prefix))
    elif isinstance(payload, list):
        for index, value in enumerate(payload):
            child_prefix = f"{prefix}[{index}]."
            result.update(collect_numeric_paths(value, child_prefix))
    return result


def sum_detailed_streams(payload):
    if not isinstance(payload, dict):
        return None
    detailed = payload.get("detailedStreams")
    if not isinstance(detailed, list) or not detailed:
        return None
    totals = []
    for item in detailed:
        if not isinstance(item, dict):
            continue
        starts = item.get("starts")
        if isinstance(starts, (int, float)):
            totals.append(float(starts))
    if not totals:
        return None
    return float(sum(totals))


def sum_detailed_streams_excluding_last(payload):
    if not isinstance(payload, dict):
        return None
    detailed = payload.get("detailedStreams")
    if not isinstance(detailed, list) or len(detailed) < 2:
        return None
    totals = []
    for item in detailed[:-1]:
        if not isinstance(item, dict):
            continue
        starts = item.get("starts")
        if isinstance(starts, (int, float)):
            totals.append(float(starts))
    if not totals:
        return None
    return float(sum(totals))


def last_detailed_stream_delta(payload):
    if not isinstance(payload, dict):
        return None
    detailed = payload.get("detailedStreams")
    if not isinstance(detailed, list) or not detailed:
        return None
    last = detailed[-1]
    if not isinstance(last, dict):
        return None
    starts = last.get("starts")
    streams = last.get("streams")
    if isinstance(starts, (int, float)) and isinstance(streams, (int, float)):
        return float(starts - streams)
    return None


def detailed_stream_totals(payload):
    if not isinstance(payload, dict):
        return {"starts": None, "streams": None, "delta": None, "last": None}
    detailed = payload.get("detailedStreams")
    if not isinstance(detailed, list) or not detailed:
        return {"starts": None, "streams": None, "delta": None, "last": None}

    starts_total = 0.0
    streams_total = 0.0
    last_item = detailed[-1] if isinstance(detailed[-1], dict) else None
    for item in detailed:
        if not isinstance(item, dict):
            continue
        starts = item.get("starts")
        streams = item.get("streams")
        if isinstance(starts, (int, float)):
            starts_total += float(starts)
        if isinstance(streams, (int, float)):
            streams_total += float(streams)

    last = None
    if isinstance(last_item, dict):
        last = {
            "date": last_item.get("date") or last_item.get("day") or last_item.get("startDate") or last_item.get("period"),
            "starts": last_item.get("starts"),
            "streams": last_item.get("streams"),
            "delta": (
                float(last_item["starts"] - last_item["streams"])
                if isinstance(last_item.get("starts"), (int, float)) and isinstance(last_item.get("streams"), (int, float))
                else None
            ),
        }

    return {
        "starts": starts_total,
        "streams": streams_total,
        "delta": starts_total - streams_total,
        "last": last,
    }


def summarize_numeric_paths(payload, prefixes):
    if not isinstance(payload, dict):
        return {}
    result = {}
    for key, value in payload.items():
        if key not in prefixes:
            continue
        result[key] = collect_numeric_paths(value, f"{key}.") if isinstance(value, (dict, list)) else value
    return result


def summarize_detailed_streams(payload):
    if not isinstance(payload, dict):
        return []
    detailed = payload.get("detailedStreams")
    if not isinstance(detailed, list):
        return []
    summary = []
    for index, item in enumerate(detailed):
        if not isinstance(item, dict):
            continue
        summary.append(
            {
                "index": index,
                "date": item.get("date") or item.get("day") or item.get("startDate") or item.get("period"),
                "starts": item.get("starts"),
                "streams": item.get("streams"),
            }
        )
    return summary


def summarize_listener_counts(payload):
    if not isinstance(payload, dict):
        return []
    counts = payload.get("counts")
    if not isinstance(counts, list):
        return []
    summary = []
    for index, item in enumerate(counts):
        if not isinstance(item, dict):
            continue
        summary.append(
            {
                "index": index,
                "date": item.get("date") or item.get("day") or item.get("startDate") or item.get("period"),
                "count": item.get("count"),
                "listeners": item.get("listeners"),
                "unique": item.get("unique"),
            }
        )
    return summary


def summarize_object_shape(payload, keys):
    if not isinstance(payload, dict):
        return {}
    result = {}
    for key in keys:
        value = payload.get(key)
        if isinstance(value, (int, float, str, bool)) or value is None:
            result[key] = value
        elif isinstance(value, dict):
            result[key] = {
                nested_key: nested_value
                for nested_key, nested_value in value.items()
                if isinstance(nested_value, (int, float, str, bool)) or nested_value is None
            }
        elif isinstance(value, list):
            result[key] = {
                "length": len(value),
                "first": value[0] if value else None,
            }
    return result


def summarize_metadata_shape(payload):
    if not isinstance(payload, dict):
        return {}
    return {
        key: (
            {
                nested_key: nested_value
                for nested_key, nested_value in value.items()
                if isinstance(nested_value, (int, float, str, bool)) or nested_value is None
            }
            if isinstance(value, dict)
            else ({
                "length": len(value),
                "first": value[0] if value else None,
            }
            if isinstance(value, list)
            else value)
        )
        for key, value in payload.items()
        if isinstance(value, (int, float, str, bool, dict, list)) or value is None
    }


def summarize_sample_performance(payload):
    if not isinstance(payload, dict):
        return {}
    result = {}
    for key, value in payload.items():
        if isinstance(value, (int, float, str, bool)) or value is None:
            result[key] = value
        elif isinstance(value, dict):
            result[key] = {
                nested_key: nested_value
                for nested_key, nested_value in value.items()
                if isinstance(nested_value, (int, float, str, bool)) or nested_value is None
            }
        elif isinstance(value, list):
            result[key] = {
                "length": len(value),
                "first": value[0] if value else None,
            }
    return result


def connector_get(connector, *path, params=None):
    return compact(connector._request(connector._build_url(*path), params=params))


def date_params(start, end):
    return {"start": start.isoformat(), "end": end.isoformat()}


def fetch_show_metadata(connector, start=None, end=None):
    if start is None or end is None:
        return compact(connector.metadata())
    return connector_get(
        connector,
        "shows",
        connector.podcast_id,
        "metadata",
        params=date_params(start, end),
    )


def fetch_scoped_metric(connector, network_id, endpoint, start, end):
    params = date_params(start, end)
    if network_id:
        try:
            return connector_get(connector, "networks", network_id, endpoint, params=params), "network"
        except Exception:
            pass

    if endpoint == "detailedStreams":
        return compact(connector.streams(start=start, end=end)), "show"
    if endpoint == "listeners":
        return compact(connector.listeners(start=start, end=end)), "show"
    if endpoint == "aggregate":
        return compact(connector.aggregate(start=start, end=end)), "show"
    if endpoint == "followers":
        return compact(connector.followers(start=start, end=end)), "show"
    return connector_get(connector, "shows", connector.podcast_id, endpoint, params=params), "show"


def numeric_field(payload, key):
    if not isinstance(payload, dict):
        return None
    value = payload.get(key)
    if isinstance(value, (int, float)):
        return float(value)
    return None


def get_metric_db_path():
    return os.environ.get("SQLITE_PATH") or os.path.join(os.getcwd(), "data", "dragaocareca-admin.sqlite")


def ensure_metric_db():
    db_path = get_metric_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS spotify_metric_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id TEXT NOT NULL,
          sample_date TEXT NOT NULL,
          network_id TEXT,
          starts INTEGER NOT NULL,
          streams INTEGER NOT NULL,
          listeners INTEGER NOT NULL,
          followers INTEGER NOT NULL,
          fetched_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(show_id, sample_date)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_spotify_metric_samples_show_date
          ON spotify_metric_samples(show_id, sample_date)
        """
    )
    return conn


def upsert_metric_sample(conn, show_id, sample_date, network_id, metadata, fetched_at):
    payload = json.dumps(compact(metadata), ensure_ascii=False)
    starts = int(numeric_field(metadata, "starts") or 0)
    streams = int(numeric_field(metadata, "streams") or 0)
    listeners = int(numeric_field(metadata, "listeners") or 0)
    followers = int(numeric_field(metadata, "followers") or 0)
    conn.execute(
        """
        INSERT INTO spotify_metric_samples (
          show_id, sample_date, network_id, starts, streams, listeners, followers, fetched_at, payload_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(show_id, sample_date) DO UPDATE SET
          network_id = excluded.network_id,
          starts = excluded.starts,
          streams = excluded.streams,
          listeners = excluded.listeners,
          followers = excluded.followers,
          fetched_at = excluded.fetched_at,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
        """,
        (show_id, sample_date, network_id, starts, streams, listeners, followers, fetched_at, payload, fetched_at, fetched_at),
    )


def load_metric_sample(conn, show_id, target_date):
    row = conn.execute(
        """
        SELECT sample_date, starts, streams, listeners, followers, fetched_at
        FROM spotify_metric_samples
        WHERE show_id = ? AND sample_date <= ?
        ORDER BY sample_date DESC
        LIMIT 1
        """,
        (show_id, target_date),
    ).fetchone()
    if row is None:
        return None
    return {
        "sampleDate": row[0],
        "starts": row[1],
        "streams": row[2],
        "listeners": row[3],
        "followers": row[4],
        "fetchedAt": row[5],
    }


def load_metric_samples(conn, show_id, limit_days=None):
    query = """
        SELECT sample_date, starts, streams, listeners, followers, fetched_at
        FROM spotify_metric_samples
        WHERE show_id = ?
        ORDER BY sample_date ASC
    """
    params = [show_id]
    if limit_days:
        query = """
            SELECT sample_date, starts, streams, listeners, followers, fetched_at
            FROM spotify_metric_samples
            WHERE show_id = ? AND sample_date >= date(?, ?)
            ORDER BY sample_date ASC
        """
        params = [show_id, date.today().isoformat(), f"-{int(limit_days)} days"]
    rows = conn.execute(query, params).fetchall()
    return [
        {
            "date": row[0],
            "starts": row[1],
            "streams": row[2],
            "listeners": row[3],
            "followers": row[4],
            "fetchedAt": row[5],
        }
        for row in rows
    ]


def metadata_window_summary(connector, metric_db, show_id, end, window_days, metadata):
    start = end - timedelta(days=window_days - 1)
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=window_days - 1)
    current_metadata = fetch_show_metadata(connector, start, end)
    previous_metadata = fetch_show_metadata(connector, previous_start, previous_end)
    current_starts = numeric_field(current_metadata, "starts")
    previous_starts = numeric_field(previous_metadata, "starts")
    current_listeners = numeric_field(current_metadata, "listeners")
    previous_listeners = numeric_field(previous_metadata, "listeners")
    return {
        "range": {
            "currentStart": start.isoformat(),
            "currentEnd": end.isoformat(),
            "previousStart": previous_start.isoformat(),
            "previousEnd": previous_end.isoformat(),
        },
        "plays": {
            "current": current_starts,
            "previous": previous_starts,
            "deltaPercent": percent_change(current_starts, previous_starts),
            "currentSource": "metadata.starts",
            "previousSource": "metadata.starts",
        },
        "publicValue": {
            "current": current_listeners,
            "previous": previous_listeners,
            "deltaPercent": percent_change(current_listeners, previous_listeners),
            "source": "metadata.listeners",
        },
        "followers": follower_summary_from_samples(metric_db, show_id, end, previous_end, metadata),
    }


def follower_summary_from_samples(conn, show_id, current_end, previous_end, metadata):
    current_sample = load_metric_sample(conn, show_id, current_end.isoformat())
    previous_sample = load_metric_sample(conn, show_id, previous_end.isoformat())
    current_value = None
    previous_value = None
    source = "spotify_metric_samples.followers"

    if current_sample and current_sample.get("followers") is not None:
        current_value = float(current_sample["followers"])
    else:
        current_value = numeric_field(metadata, "followers")
        source = "metadata.followers"

    if previous_sample and previous_sample.get("followers") is not None:
        previous_value = float(previous_sample["followers"])
    else:
        previous_value = current_value

    return {
        "current": current_value,
        "previous": previous_value,
        "deltaPercent": percent_change(current_value, previous_value),
        "source": source,
    }


def main():
    try:
        window_days = int(os.environ.get("SPOTIFY_METRICS_DAYS", "30"))
    except (TypeError, ValueError):
        window_days = 30
    window_days = max(window_days, 1)

    connector = SpotifyConnector(
        base_url=os.environ["SPOTIFY_METRICS_BASE_URL"],
        client_id=os.environ["SPOTIFY_CLIENT_ID"],
        podcast_id=os.environ["SPOTIFY_PODCAST_ID"],
        sp_dc=os.environ["SPOTIFY_SP_DC"],
        sp_key=os.environ["SPOTIFY_SP_KEY"],
    )

    end = date.today()
    start = end - timedelta(days=window_days - 1)
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=window_days - 1)

    metadata = fetch_show_metadata(connector)
    use_network_metrics = os.environ.get("SPOTIFY_METRICS_USE_NETWORK", "").lower() == "true"
    network_id = os.environ.get("SPOTIFY_NETWORK_ID") if use_network_metrics else None
    if use_network_metrics and not network_id and isinstance(metadata, dict) and isinstance(metadata.get("network"), dict):
        network_id = metadata["network"].get("id")

    current_streams, current_streams_scope = fetch_scoped_metric(connector, network_id, "detailedStreams", start, end)
    previous_streams, previous_streams_scope = fetch_scoped_metric(connector, network_id, "detailedStreams", previous_start, previous_end)
    current_aggregate, current_aggregate_scope = fetch_scoped_metric(connector, network_id, "aggregate", start, end)
    current_listeners, current_listeners_scope = fetch_scoped_metric(connector, network_id, "listeners", start, end)
    previous_aggregate, previous_aggregate_scope = fetch_scoped_metric(connector, network_id, "aggregate", previous_start, previous_end)
    previous_listeners, previous_listeners_scope = fetch_scoped_metric(connector, network_id, "listeners", previous_start, previous_end)
    current_period_metadata = fetch_show_metadata(connector, start, end)
    previous_period_metadata = fetch_show_metadata(connector, previous_start, previous_end)
    episodes = compact(list(connector.episodes(start=start, end=end)))
    sample_episode_id = None
    if episodes and isinstance(episodes[0], dict):
        sample_episode_id = episodes[0].get("id") or episodes[0].get("episode_id") or episodes[0].get("episodeId")
    sample_performance = compact(connector.performance(sample_episode_id)) if sample_episode_id else None

    metric_db = ensure_metric_db()
    fetched_at = datetime.utcnow().isoformat() + "Z"
    show_id = str(metadata.get("id") or os.environ["SPOTIFY_PODCAST_ID"])
    network_id_for_sample = network_id
    upsert_metric_sample(metric_db, show_id, end.isoformat(), network_id_for_sample, metadata, fetched_at)
    metric_db.commit()

    current_starts, current_starts_source = resolve_metric_with_source(
        current_streams,
        [
            ("streams",),
            ("starts",),
            ("stats", "streams"),
            ("stats", "starts"),
            ("totals", "streams"),
            ("totals", "starts"),
            ("plays",),
            ("summary", "streams"),
            ("summary", "starts"),
            ("summary", "plays"),
            ("public", "streams"),
            ("public", "starts"),
            ("public", "plays"),
            ("public", "total"),
            ("public", "value"),
        ],
        ("public", "stats", "totals", "streams", "plays", "summary"),
    )
    previous_starts, previous_starts_source = resolve_metric_with_source(
        previous_streams,
        [
            ("streams",),
            ("starts",),
            ("stats", "streams"),
            ("stats", "starts"),
            ("totals", "streams"),
            ("totals", "starts"),
            ("plays",),
            ("summary", "streams"),
            ("summary", "starts"),
            ("summary", "plays"),
            ("public", "streams"),
            ("public", "starts"),
            ("public", "plays"),
            ("public", "total"),
            ("public", "value"),
        ],
        ("public", "stats", "totals", "streams", "plays", "summary"),
    )
    current_detailed_starts = sum_detailed_streams(current_streams)
    previous_detailed_starts = sum_detailed_streams(previous_streams)
    current_detailed_starts_excluding_last = sum_detailed_streams_excluding_last(current_streams)
    current_last_delta = last_detailed_stream_delta(current_streams)
    current_detailed_totals = detailed_stream_totals(current_streams)
    previous_detailed_totals = detailed_stream_totals(previous_streams)
    metadata_current_starts = numeric_field(current_period_metadata, "starts")
    metadata_previous_starts = numeric_field(previous_period_metadata, "starts")
    if metadata_current_starts is not None:
        current_starts = metadata_current_starts
        current_starts_source = "metadata.starts"
    elif current_detailed_starts is not None:
        current_starts = current_detailed_starts
        current_starts_source = "detailedStreams.starts.sum"
    if metadata_previous_starts is not None:
        previous_starts = metadata_previous_starts
        previous_starts_source = "metadata.starts"
    elif previous_detailed_starts is not None:
        previous_starts = previous_detailed_starts
        previous_starts_source = "detailedStreams.starts.sum"
    current_listening_time = choose_metric(
        current_aggregate,
        [
            ("consumingTime",),
            ("consuming_time",),
            ("totals", "consumingTime"),
            ("stats", "consumingTime"),
            ("listeningTime",),
            ("timeListening",),
            ("public", "consumingTime"),
        ],
    )
    previous_listening_time = choose_metric(
        previous_aggregate,
        [
            ("consumingTime",),
            ("consuming_time",),
            ("totals", "consumingTime"),
            ("stats", "consumingTime"),
            ("listeningTime",),
            ("timeListening",),
            ("public", "consumingTime"),
        ],
    )
    if current_listening_time is None:
        current_listening_time = choose_metric(
            current_listeners,
            [
                ("consumingTime",),
                ("consuming_time",),
                ("listeningTime",),
                ("timeListening",),
                ("total",),
                ("count",),
                ("public", "consumingTime"),
            ],
        )
    if previous_listening_time is None:
        previous_listening_time = choose_metric(
            previous_listeners,
            [
                ("consumingTime",),
                ("consuming_time",),
                ("listeningTime",),
                ("timeListening",),
                ("total",),
                ("count",),
                ("public", "consumingTime"),
            ],
        )
    followers = count_followers(metadata)
    followers_summary = follower_summary_from_samples(metric_db, show_id, end, previous_end, metadata)
    metric_samples = load_metric_samples(metric_db, show_id, 4000)
    current_public = numeric_field(current_period_metadata, "listeners")
    previous_public = numeric_field(previous_period_metadata, "listeners")
    preset_summaries = {}
    if window_days >= 90:
        for preset_days in (7, 30, 90):
            preset_summaries[str(preset_days)] = metadata_window_summary(connector, metric_db, show_id, end, preset_days, metadata)
    debug = {
        "metadataShape": summarize_metadata_shape(metadata),
        "samplePerformanceShape": summarize_sample_performance(sample_performance),
        "currentStreamsSummary": summarize_detailed_streams(current_streams),
        "previousStreamsSummary": summarize_detailed_streams(previous_streams),
        "currentListenersSummary": summarize_listener_counts(current_listeners),
        "previousListenersSummary": summarize_listener_counts(previous_listeners),
        "currentListenersShape": summarize_object_shape(current_listeners, ("summary", "totals", "counts", "public", "unique", "listeners")),
        "previousListenersShape": summarize_object_shape(previous_listeners, ("summary", "totals", "counts", "public", "unique", "listeners")),
        "currentDetailedTotals": current_detailed_totals,
        "previousDetailedTotals": previous_detailed_totals,
        "networkId": network_id,
        "metricScopes": {
            "currentStreams": current_streams_scope,
            "previousStreams": previous_streams_scope,
            "currentAggregate": current_aggregate_scope,
            "previousAggregate": previous_aggregate_scope,
            "currentListeners": current_listeners_scope,
            "previousListeners": previous_listeners_scope,
        },
        "currentPeriodMetadataSummary": summarize_metadata_shape(current_period_metadata),
        "previousPeriodMetadataSummary": summarize_metadata_shape(previous_period_metadata),
        "metricSamples": metric_samples,
        "presetSummaries": preset_summaries,
        "currentAggregateSummary": summarize_numeric_paths(current_aggregate, ("public", "totals", "stats", "summary")),
        "previousAggregateSummary": summarize_numeric_paths(previous_aggregate, ("public", "totals", "stats", "summary")),
        "currentStreams": collect_numeric_paths(current_streams),
        "previousStreams": collect_numeric_paths(previous_streams),
        "currentAggregate": collect_numeric_paths(current_aggregate),
        "previousAggregate": collect_numeric_paths(previous_aggregate),
        "currentListeners": collect_numeric_paths(current_listeners),
        "previousListeners": collect_numeric_paths(previous_listeners),
    }

    metric_db.close()

    print(json.dumps({
        "source": "spotify-connector",
        "fetchedAt": fetched_at,
        "range": {
            "currentStart": start.isoformat(),
            "currentEnd": end.isoformat(),
            "previousStart": previous_start.isoformat(),
            "previousEnd": previous_end.isoformat(),
        },
        "metadata": metadata,
        "current": {
            "streams": current_streams,
            "aggregate": current_aggregate,
            "listeners": current_listeners,
            "metadata": current_period_metadata,
        },
        "previous": {
            "streams": previous_streams,
            "aggregate": previous_aggregate,
            "listeners": previous_listeners,
            "metadata": previous_period_metadata,
        },
        "summary": {
            "plays": {
                "current": current_starts,
                "previous": previous_starts,
                "deltaPercent": percent_change(current_starts, previous_starts),
                "currentSource": current_starts_source,
                "previousSource": previous_starts_source,
            },
            "publicValue": {
                "current": float(current_public) if isinstance(current_public, (int, float)) else None,
                "previous": float(previous_public) if isinstance(previous_public, (int, float)) else None,
                "deltaPercent": percent_change(
                    float(current_public) if isinstance(current_public, (int, float)) else None,
                    float(previous_public) if isinstance(previous_public, (int, float)) else None,
                ),
                "source": "metadata.listeners",
            },
            "consumingTime": {
                "current": current_listening_time,
                "previous": previous_listening_time,
                "deltaPercent": percent_change(current_listening_time, previous_listening_time),
            },
            "followers": followers_summary,
            "followersCurrent": followers,
        },
        "episodes": episodes,
        "samplePerformance": sample_performance,
        "debug": debug,
    }))


if __name__ == "__main__":
    main()
