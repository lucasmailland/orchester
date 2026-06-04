#!/usr/bin/env bash
# snap-via-sysevents.sh
#
# Drive the user's already-open Chrome window (the one with the Orchester
# tab active) through 12 URLs and screencapture each viewport.
#
# Why System Events and not `tell application "Google Chrome"`?
#   Chrome's AppleScript dictionary keeps returning 0 windows in this
#   environment (an internal state we couldn't recover). System Events
#   talks to the same Chrome via the macOS Accessibility API and DOES
#   see it. We use it for: position + size + sending keystrokes.
#
# Pre-conditions:
#   - Chrome process PID is auto-detected from the window title prefix
#     "Orchester — AI Agent Platform" so we don't hard-code a PID.
#   - The user is signed in to localhost:3333 in that window.
#   - macOS Screen Recording + Accessibility permission are granted to
#     the calling terminal.

set -euo pipefail

# Empirical offsets for Chrome on macOS Sequoia with the "automation
# banner" visible (Chrome shows it because AppleScript is driving the tab):
#   - 22px title bar + 36px tab strip + 40px URL bar + 40px banner = ~138px
# VIEWPORT_H is intentionally short of 900 so the macOS Dock at the bottom
# of the screen doesn't sneak into the crop.
CHROME_OFFSET_LOGICAL=${CHROME_OFFSET_LOGICAL:-180}
VIEWPORT_W=1440
VIEWPORT_H=740
BASE_URL="${BASE_URL:-http://localhost:3333}"
LOCALE="${LOCALE:-en}"
WORKSPACE="${WORKSPACE:-acme-inc}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/public/screenshots"
mkdir -p "$OUT_DIR"

TOUR=(
  "01-dashboard|/|2000"
  "02-flows-list|/flows|2000"
  "03-flow-editor|/flows/lmcqjhloxqzqektov7sjqp15|3200"
  "04-agents|/agents|2000"
  "05-agent-detail|/agents/pcha7x7m6xrqezk34b5l42k7|2500"
  "06-conversations|/conversations|2000"
  "07-knowledge|/knowledge|2000"
  "08-brain|/brain|2000"
  "09-org|/org|2800"
  "10-usage|/usage|2000"
  "11-integrations|/integrations|2000"
  "12-settings|/settings|2000"
)

# Find the PID of the Chrome process whose front window title starts with
# "Orchester". This sidesteps the "0 windows" issue from the Chrome dict
# AppleScript and survives Chrome restarts.
ORCHESTER_PID="$(
  /usr/bin/osascript <<'APPLESCRIPT'
tell application "System Events"
  repeat with p in (every application process whose name is "Google Chrome")
    try
      repeat with w in windows of p
        if (name of w) contains "Orchester" then
          return (unix id of p as text)
        end if
      end repeat
    end try
  end repeat
  return "0"
end tell
APPLESCRIPT
)"

if [[ "$ORCHESTER_PID" == "0" ]]; then
  echo "✗ No Chrome window with 'Orchester' in its title was found."
  echo "  Open the workspace in Chrome and try again."
  exit 1
fi

echo "▸ Driving Chrome PID $ORCHESTER_PID"

# Bring that Chrome to front and position/size its window predictably.
position_window () {
  /usr/bin/osascript <<APPLESCRIPT >/dev/null
tell application "System Events"
  set p to (first application process whose unix id is ${ORCHESTER_PID})
  set frontmost of p to true
  tell window 1 of p
    set position to {0, 0}
    set size to {${VIEWPORT_W}, $((VIEWPORT_H + CHROME_OFFSET_LOGICAL))}
  end tell
end tell
APPLESCRIPT
}

# Cmd+L (focus URL bar), select all, type URL, press Return.
navigate_to () {
  local url="$1"
  /usr/bin/osascript <<APPLESCRIPT >/dev/null
tell application "System Events"
  set p to (first application process whose unix id is ${ORCHESTER_PID})
  set frontmost of p to true
  delay 0.15
  keystroke "l" using {command down}
  delay 0.1
  keystroke "${url}"
  delay 0.05
  keystroke return
end tell
APPLESCRIPT
}

# Re-assert Chrome as the absolute frontmost window. Other apps (Arc,
# Slack, Notes…) can grab focus during the loop; without this every
# subsequent screencapture would catch whatever was on top instead of
# Chrome — that's how earlier runs accidentally screenshotted Gmail.
ensure_chrome_front () {
  /usr/bin/osascript <<APPLESCRIPT >/dev/null 2>&1
tell application "Google Chrome" to activate
delay 0.25
tell application "System Events"
  try
    set p to (first application process whose unix id is ${ORCHESTER_PID})
    set frontmost of p to true
  end try
end tell
APPLESCRIPT
}

snap_viewport () {
  local out="$1"
  ensure_chrome_front
  /bin/sleep 0.6
  local tmp
  tmp="$(/usr/bin/mktemp -t snap-orchester).png"
  /usr/sbin/screencapture -x -t png "$tmp"
  local off_phys=$((CHROME_OFFSET_LOGICAL * 2))
  local w_phys=$((VIEWPORT_W * 2))
  local h_phys=$((VIEWPORT_H * 2))
  /usr/bin/sips -c "$h_phys" "$w_phys" --cropOffset "$off_phys" 0 "$tmp" --out "$out" >/dev/null
  /bin/rm -f "$tmp"
}

position_window
sleep 0.5

total=${#TOUR[@]}
i=0
for entry in "${TOUR[@]}"; do
  i=$((i + 1))
  IFS='|' read -r slug path settle <<<"$entry"
  url="${BASE_URL}/${LOCALE}/${WORKSPACE}${path}"
  [[ "$path" == "/" ]] && url="${BASE_URL}/${LOCALE}/${WORKSPACE}"
  out="${OUT_DIR}/${slug}.png"

  printf "[%02d/%02d] %-35s → %s … " "$i" "$total" "$slug" "$(basename "$out")"
  navigate_to "$url"
  /bin/sleep "$(awk "BEGIN { print ${settle} / 1000 }")"
  snap_viewport "$out"
  echo "OK"
done

echo
echo "✓ ${total} screenshots in ${OUT_DIR}"
