#!/usr/bin/env bash
# rr.sh — drive the running RapidRAW window on macOS (activate / observe / act loop).
# Wraps the verified osascript + screencapture + CGWindowList primitives so callers
# don't recompute window origin or Retina scale on every step. See ../SKILL.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROC="RapidRAW"
STATE="/tmp/rr_nav_state"        # cached: WIN_X WIN_Y WIN_W WIN_H SCALE WID
SHOT="/tmp/rapidraw.png"

die() { echo "rr.sh: $*" >&2; exit 1; }

# cmd shift opt ctrl  ->  " using {command down, shift down}"  (empty if none)
mods_to_applescript() {
  local out=() m
  for m in "$@"; do
    case "$m" in
      cmd|command) out+=("command down");;
      shift)       out+=("shift down");;
      opt|alt|option) out+=("option down");;
      ctrl|control) out+=("control down");;
      *) die "unknown modifier: $m (use cmd|shift|opt|ctrl)";;
    esac
  done
  if [ ${#out[@]} -eq 0 ]; then echo ""; else
    local joined; joined=$(IFS=, ; echo "${out[*]}")
    echo " using {${joined}}"
  fi
}

cmd_activate() {
  osascript <<OSA
tell application "System Events"
  set frontmost of (first process whose name is "$PROC") to true
  delay 0.4
end tell
OSA
  echo "activated $PROC"
}

cmd_bounds() { swift "$SCRIPT_DIR/rr-bounds.swift"; }   # prints: X Y W H WID (points)

cmd_shot() {
  local out="${1:-$SHOT}" WX WY WW WH WID
  read -r WX WY WW WH WID < <(cmd_bounds) || die "could not read window bounds"
  [ -n "${WID:-}" ] || die "no window id"
  screencapture -x -o -l"$WID" "$out" \
    || die "screencapture failed — grant Screen Recording to the host app (VS Code) and restart it. See SKILL.md."
  local pw ph scale="1.0"
  pw=$(sips -g pixelWidth "$out" 2>/dev/null | awk '/pixelWidth/{print $2}')
  ph=$(sips -g pixelHeight "$out" 2>/dev/null | awk '/pixelHeight/{print $2}')
  if [ -n "${pw:-}" ] && [ "$WW" -gt 0 ]; then
    scale=$(awk "BEGIN{printf \"%.4f\", $pw/$WW}")
  fi
  printf '%s %s %s %s %s %s\n' "$WX" "$WY" "$WW" "$WH" "$scale" "$WID" > "$STATE"
  echo "saved $out (${pw:-?}x${ph:-?}px) | window ${WW}x${WH}pt @ ${WX},${WY} | scale ${scale}"
}

# loads WX WY WW WH SCALE WID from cache, refreshing origin/size from a live bounds read
load_state() {
  local s_scale="2.0"
  [ -f "$STATE" ] && s_scale=$(awk '{print $5}' "$STATE")
  read -r WX WY WW WH WID < <(cmd_bounds) || die "could not read window bounds; is the app running?"
  SCALE="$s_scale"
  if [ ! -f "$STATE" ]; then
    echo "rr.sh: no prior screenshot; assuming scale ${SCALE}. Run 'shot' for an exact value." >&2
  fi
}

do_click() {  # global point coords
  local gx="$1" gy="$2"
  osascript <<OSA
tell application "System Events"
  set frontmost of (first process whose name is "$PROC") to true
  delay 0.3
  click at {$gx, $gy}
end tell
OSA
}

cmd_clickpx() {   # coords read off the screenshot PNG (Retina pixels), in-window
  local px="$1" py="$2" gx gy; load_state
  gx=$(awk "BEGIN{printf \"%d\", $WX + $px/$SCALE}")
  gy=$(awk "BEGIN{printf \"%d\", $WY + $py/$SCALE}")
  do_click "$gx" "$gy"
  echo "clicked png px ($px,$py) -> global ($gx,$gy) [scale $SCALE, origin $WX,$WY]"
}

cmd_click() {     # in-window POINT coords
  local wx="$1" wy="$2"; load_state
  do_click $((WX + wx)) $((WY + wy))
  echo "clicked window pt ($wx,$wy) -> global ($((WX + wx)),$((WY + wy)))"
}

cmd_key() {
  local char="$1"; shift || true
  local using; using=$(mods_to_applescript "$@")
  osascript <<OSA
tell application "System Events"
  set frontmost of (first process whose name is "$PROC") to true
  delay 0.2
  keystroke "$char"$using
end tell
OSA
  echo "key '$char' ${*:-(no mods)}"
}

cmd_keycode() {
  local code="$1"; shift || true
  local using; using=$(mods_to_applescript "$@")
  osascript <<OSA
tell application "System Events"
  set frontmost of (first process whose name is "$PROC") to true
  delay 0.2
  key code $code$using
end tell
OSA
  echo "key code $code ${*:-(no mods)}"
}

usage() {
  cat >&2 <<USAGE
rr.sh — drive the running RapidRAW window (macOS)
  rr.sh activate            bring RapidRAW frontmost
  rr.sh bounds              print: X Y W H WINDOWID  (points)
  rr.sh shot [out.png]      screenshot the window (default $SHOT) + cache origin/scale
  rr.sh key <char> [mods]   keystroke; mods = cmd shift opt ctrl   e.g. key s cmd
  rr.sh keycode <n> [mods]  special key: 53=Esc 36=Return 48=Tab 49=Space 51=Del 123-126=L/R/Dn/Up
  rr.sh clickpx <px> <py>   click at coords read off the screenshot PNG (Retina-aware) -- preferred
  rr.sh click <wx> <wy>     click at in-window POINT coords
Loop: activate -> shot -> Read the PNG -> key/clickpx -> shot to confirm. Prefer keys over clicks.
USAGE
}

case "${1:-}" in
  activate) cmd_activate;;
  bounds)   cmd_bounds;;
  shot)     shift; cmd_shot "${1:-}";;
  key)      shift; [ $# -ge 1 ] || die "usage: key <char> [mods...]"; cmd_key "$@";;
  keycode)  shift; [ $# -ge 1 ] || die "usage: keycode <n> [mods...]"; cmd_keycode "$@";;
  clickpx)  shift; [ $# -ge 2 ] || die "usage: clickpx <px> <py>"; cmd_clickpx "$1" "$2";;
  click)    shift; [ $# -ge 2 ] || die "usage: click <wx> <wy>"; cmd_click "$1" "$2";;
  *) usage; exit 1;;
esac
