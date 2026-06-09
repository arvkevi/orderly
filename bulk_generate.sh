#!/bin/bash
# Bulk generate events across many categories.
# Usage: ./bulk_generate.sh
#
# Requires: pip install anthropic
# Set ANTHROPIC_API_KEY in your environment.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

categories=(
    # Pop culture & entertainment
    "90s movies"
    "2000s movies"
    "2010s movies"
    "horror movies"
    "animated movies"
    "documentary films"
    "Broadway musicals"
    "stand-up comedy"
    "reality TV"
    "anime"
    "award shows"
    "celebrity scandals"

    # Music sub-genres
    "hip hop"
    "rock and roll"
    "country music"
    "electronic music"
    "K-pop"
    "punk rock"
    "jazz"
    "classical music"
    "music festivals"
    "one-hit wonders"

    # Sports deep dives
    "nfl"
    "Olympic records"
    "boxing"
    "tennis"
    "golf"
    "Formula 1"
    "cricket"
    "esports"
    "extreme sports"
    "women in sports"
    "sports scandals"

    # Tech sub-areas
    "artificial intelligence"
    "cybersecurity"
    "mobile phones"
    "social media"
    "cryptocurrency"
    "open source software"
    "video game consoles"
    "internet memes"
    "robots and automation"
    "electric vehicles"

    # History themes
    "us history"
    "civil rights"
    "space exploration"
    "Cold War"
    "ancient history"
    "medieval history"
    "World War I"
    "World War II"
    "revolutions"
    "famous speeches"
    "assassination attempts"

    # Science & discovery
    "Nobel Prize winners"
    "medical breakthroughs"
    "dinosaur discoveries"
    "particle physics"
    "climate and weather"
    "ocean exploration"
    "archaeology"
    "genetics and DNA"

    # Regional / themed
    "NYC history"
    "London history"
    "Tokyo history"
    "famous disasters"
    "aviation milestones"
    "food and cuisine"
    "fashion history"
    "photography milestones"
    "architecture landmarks"
    "theme parks"

    # Niche / fun
    "board games and toys"
    "comic books"
    "podcasts"
    "true crime"
    "royal family"
    "presidential elections"
    "Supreme Court decisions"
    "famous heists"
    "urban legends debunked"
)

echo "=== Orderly Bulk Event Generator ==="
echo "Categories to process: ${#categories[@]}"
echo ""

for category in "${categories[@]}"; do
    echo "--- Generating: $category ---"
    python3 generate_events.py generate --category "$category" --count 100
    echo ""
    # Small delay to avoid rate limits
    sleep 2
done

echo ""
echo "=== Done! ==="
python3 generate_events.py stats
