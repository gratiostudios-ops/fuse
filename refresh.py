#!/usr/bin/env python3
"""
Search YouTube for multiple comma-separated topics using YouTube Data API v3.

Setup:
    python -m pip install requests

Run:
    python youtube_multi_search.py
    python youtube_multi_search.py --topics "Python tutorials,AI news,cricket highlights" --results 25
    python youtube_multi_search.py --topics "Python,AI" --results 10 --output youtube_results.csv

Notes:
- `--results` is the maximum results PER topic (up to 50 per API request).
- This exports all fields returned by the search API that are useful for each video.
- Search API results do not include view counts, likes, or comments. The script makes a
  second API request for video statistics and duration when possible.
- Keep your API key private. Prefer setting YOUTUBE_API_KEY as an environment variable.
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests

API_BASE = "https://www.googleapis.com/youtube/v3"
SEARCH_FIELDS = (
    "items(id/videoId,snippet(title,description,channelId,channelTitle,"
    "publishedAt,thumbnails,liveBroadcastContent)),nextPageToken"
)


def parse_topics(raw: str) -> list[str]:
    """Split comma-separated topics, trim whitespace, and remove duplicates."""
    seen = set()
    topics = []
    for item in raw.split(","):
        topic = item.strip()
        key = topic.casefold()
        if topic and key not in seen:
            topics.append(topic)
            seen.add(key)
    return topics


def api_get(endpoint: str, params: dict, timeout: int = 30) -> dict:
    """Call YouTube API and raise a readable error if the request fails."""
    response = requests.get(
        f"{API_BASE}/{endpoint}",
        params=params,
        timeout=timeout,
    )
    try:
        data = response.json()
    except ValueError:
        response.raise_for_status()
        raise RuntimeError("YouTube API returned a non-JSON response.")

    if not response.ok or "error" in data:
        error = data.get("error", {})
        message = error.get("message", response.text)
        reasons = [
            item.get("reason", "")
            for item in error.get("errors", [])
            if item.get("reason")
        ]
        detail = f" (reason: {', '.join(reasons)})" if reasons else ""
        raise RuntimeError(f"YouTube API error {response.status_code}: {message}{detail}")

    return data


def search_topic(api_key: str, topic: str, max_results: int, order: str):
    """Fetch up to max_results video search items for one topic, paging as needed."""
    collected = []
    page_token = None
    while len(collected) < max_results:
        page_size = min(50, max_results - len(collected))
        params = {
            "key": api_key,
            "part": "snippet",
            "q": topic,
            "type": "video",
            "maxResults": page_size,
            "order": order,
            "safeSearch": "none",
            "fields": SEARCH_FIELDS,
        }
        if page_token:
            params["pageToken"] = page_token

        data = api_get("search", params)
        items = data.get("items", [])
        if not items:
            break

        collected.extend(items)
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return collected[:max_results]


def get_video_details(api_key: str, video_ids: list[str]) -> dict:
    """Fetch statistics, duration, and category for batches of up to 50 video IDs."""
    details = {}
    for start in range(0, len(video_ids), 50):
        batch = video_ids[start:start + 50]
        data = api_get(
            "videos",
            {
                "key": api_key,
                "part": "statistics,contentDetails,status",
                "id": ",".join(batch),
                "maxResults": 50,
                "fields": (
                    "items(id,statistics(viewCount,likeCount,commentCount),"
                    "contentDetails(duration,definition,caption),status(privacyStatus,embeddable))"
                ),
            },
        )
        for item in data.get("items", []):
            details[item["id"]] = item
    return details


def thumbnail_url(thumbnails: dict) -> str:
    """Prefer the highest-quality thumbnail available."""
    for size in ("maxres", "standard", "high", "medium", "default"):
        image = thumbnails.get(size)
        if image and image.get("url"):
            return image["url"]
    return ""


def iso_duration_to_readable(value: str) -> str:
    """Convert an ISO-8601 YouTube duration such as PT1H2M3S to HH:MM:SS."""
    import re
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value or "")
    if not match:
        return value or ""
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def flatten_result(topic: str, item: dict, detail: dict | None) -> dict:
    video_id = item.get("id", {}).get("videoId", "")
    snippet = item.get("snippet", {})
    stats = (detail or {}).get("statistics", {})
    content = (detail or {}).get("contentDetails", {})
    status = (detail or {}).get("status", {})
    thumbs = snippet.get("thumbnails", {})

    return {
        "searched_topic": topic,
        "video_id": video_id,
        "title": snippet.get("title", ""),
        "video_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else "",
        "channel_title": snippet.get("channelTitle", ""),
        "channel_id": snippet.get("channelId", ""),
        "published_at": snippet.get("publishedAt", ""),
        "description": snippet.get("description", ""),
        "thumbnail_url": thumbnail_url(thumbs),
        "live_broadcast_content": snippet.get("liveBroadcastContent", ""),
        "default_language": snippet.get("defaultLanguage", ""),
        "default_audio_language": snippet.get("defaultAudioLanguage", ""),
        "view_count": stats.get("viewCount", ""),
        "like_count": stats.get("likeCount", ""),
        "comment_count": stats.get("commentCount", ""),
        "duration": iso_duration_to_readable(content.get("duration", "")),
        "definition": content.get("definition", ""),
        "captions_available": content.get("caption", ""),
        "privacy_status": status.get("privacyStatus", ""),
        "embeddable": status.get("embeddable", ""),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Search YouTube for comma-separated topics and export complete video results."
    )
    parser.add_argument(
        "--topics",
        help='Comma-separated topics, e.g. "Python,AI news,cricket"',
    )
    parser.add_argument(
        "--results",
        type=int,
        default=25,
        help="Maximum number of videos PER topic (default: 25; maximum: 500)",
    )
    parser.add_argument(
        "--output",
        default="youtube_search_results.csv",
        help="CSV output filename (default: youtube_search_results.csv)",
    )
    parser.add_argument(
        "--order",
        choices=("relevance", "date", "viewCount", "rating", "title"),
        default="relevance",
        help="Sort order for each topic (default: relevance)",
    )
    parser.add_argument(
        "--no-details",
        action="store_true",
        help="Skip extra request for view counts, likes, comments, and duration",
    )
    args = parser.parse_args()

    raw_topics = args.topics
    if not raw_topics:
        raw_topics = input("Enter topics separated by commas: ").strip()

    topics = parse_topics(raw_topics)
    if not topics:
        parser.error("Please enter at least one non-empty topic.")
    if not 1 <= args.results <= 500:
        parser.error("--results must be between 1 and 500.")

    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        # Convenient interactive fallback; environment variable is safer.
        api_key = input("Enter your YouTube API key: ").strip()
    if not api_key:
        parser.error("API key is required. Set YOUTUBE_API_KEY or enter it when prompted.")

    all_rows = []
    errors = []
    seen_video_ids = set()
    print(f"\nSearching {len(topics)} topic(s), up to {args.results} result(s) per topic...\n")

    for index, topic in enumerate(topics, start=1):
        print(f"[{index}/{len(topics)}] Searching: {topic}")
        try:
            items = search_topic(api_key, topic, args.results, args.order)
            for item in items:
                video_id = item.get("id", {}).get("videoId", "")
                # Preserve a row per topic, even when the same video appears for multiple topics.
                if video_id:
                    seen_video_ids.add(video_id)
                all_rows.append(flatten_result(topic, item, None))
            print(f"    Found {len(items)} video(s).")
        except (requests.RequestException, RuntimeError) as exc:
            message = f"{topic}: {exc}"
            errors.append(message)
            print(f"    ERROR: {exc}", file=sys.stderr)
        time.sleep(0.1)

    if not all_rows:
        print("\nNo results were collected. Check the API key, API enablement, quota, and network.")
        sys.exit(1)

    if not args.no_details:
        print(f"\nFetching statistics/details for {len(seen_video_ids)} unique video(s)...")
        try:
            details = get_video_details(api_key, list(seen_video_ids))
            for row in all_rows:
                video_id = row["video_id"]
                # Merge the detail fields into the corresponding topic row.
                detail_row = flatten_result(
                    row["searched_topic"],
                    {
                        "id": {"videoId": video_id},
                        "snippet": {
                            "title": row["title"],
                            "description": row["description"],
                            "channelId": row["channel_id"],
                            "channelTitle": row["channel_title"],
                            "publishedAt": row["published_at"],
                            "thumbnails": {"default": {"url": row["thumbnail_url"]}} if row["thumbnail_url"] else {},
                            "liveBroadcastContent": row["live_broadcast_content"],
                            "defaultLanguage": row["default_language"],
                            "defaultAudioLanguage": row["default_audio_language"],
                        },
                    },
                    details.get(video_id),
                )
                row.update({
                    key: detail_row[key]
                    for key in (
                        "view_count", "like_count", "comment_count", "duration",
                        "definition", "captions_available", "privacy_status", "embeddable"
                    )
                })
        except (requests.RequestException, RuntimeError) as exc:
            errors.append(f"Video details: {exc}")
            print(f"Warning: couldn't fetch some video details: {exc}", file=sys.stderr)

    fieldnames = list(all_rows[0].keys())
    output_path = os.path.abspath(args.output)
    try:
        with open(output_path, "w", newline="", encoding="utf-8-sig") as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(all_rows)
    except OSError as exc:
        print(f"Could not write output file: {exc}", file=sys.stderr)
        sys.exit(1)

    print("\nDone!")
    print(f"Topics searched: {len(topics)}")
    print(f"Rows exported: {len(all_rows)}")
    print(f"Unique video IDs: {len(seen_video_ids)}")
    print(f"CSV file: {output_path}")
    if errors:
        print("\nSome errors occurred:")
        for error in errors:
            print(f" - {error}")
    print("\nNote: results reflect YouTube API search output at the time of the request.")


if __name__ == "__main__":
    main()