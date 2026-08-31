#!/bin/sh
#
# Install Roster into /Applications.
#
#   curl -fsSL https://raw.githubusercontent.com/jwnwilson/roster/main/scripts/install.sh | sh
#
# Roster ships unsigned — there is no Developer ID — so macOS quarantines the
# downloaded disk image and refuses to open what comes out of it. Everything
# here is ordinary "mount, copy, unmount" apart from the final xattr, which is
# the step this script exists to save you typing.
#
# Environment overrides:
#   ROSTER_VERSION   install a specific version (e.g. 0.1.2) instead of latest
#   ROSTER_APP_DIR   install somewhere other than /Applications

set -eu

REPO="jwnwilson/roster"
APP_DIR="${ROSTER_APP_DIR:-/Applications}"
APP="$APP_DIR/Roster.app"
CHECKSUMS="SHASUMS256.txt"

WORK=""
MOUNT=""

# Runs on every exit path, so a failure midway never leaves a mounted image
# or a temp directory behind.
cleanup() {
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  [ -n "$WORK" ] && rm -rf "$WORK" || true
}
trap cleanup EXIT INT TERM

die() {
  echo "install: $1" >&2
  exit 1
}

step() {
  echo "==> $1"
}

[ "$(uname -s)" = "Darwin" ] || die "Roster is macOS only (this is $(uname -s))."

# Must match artifactName in package.json: ${productName}-${version}-${arch}.${ext}
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) die "unsupported architecture $(uname -m); Roster builds arm64 and x64 only." ;;
esac

# Refuse to replace a bundle that is currently executing — deleting it out from
# under a running app corrupts the session rather than upgrading it.
if pgrep -x Roster >/dev/null 2>&1; then
  die "Roster is running. Quit it (Cmd-Q) and run this again."
fi

if [ -n "${ROSTER_VERSION:-}" ]; then
  VERSION="${ROSTER_VERSION#v}"
else
  step "Finding the latest release"
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep -m1 '"tag_name"' \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/') \
    || die "could not reach the GitHub releases API."
  [ -n "$TAG" ] || die "no release found for $REPO (the API may be rate-limiting you)."
  VERSION="${TAG#v}"
fi

DMG="Roster-$VERSION-$ARCH.dmg"
BASE="https://github.com/$REPO/releases/download/v$VERSION"

WORK=$(mktemp -d) || die "could not create a temporary directory."

step "Downloading $DMG"
curl -fL --progress-bar -o "$WORK/$DMG" "$BASE/$DMG" \
  || die "could not download $DMG — is v$VERSION a published release?"

# The only integrity check available to someone who piped this script into a
# shell, so a missing checksum file is a hard failure rather than a shrug.
step "Verifying checksum"
curl -fsSL -o "$WORK/$CHECKSUMS" "$BASE/$CHECKSUMS" \
  || die "no $CHECKSUMS published for v$VERSION; refusing to install unverified."
( cd "$WORK" && grep " $DMG\$" "$CHECKSUMS" | shasum -a 256 -c --status - ) \
  || die "checksum mismatch for $DMG. The download is corrupt or tampered with; nothing was installed."

step "Mounting the disk image"
MOUNT=$(hdiutil attach "$WORK/$DMG" -nobrowse -readonly -quiet -mountpoint "$WORK/mnt" >/dev/null \
        && echo "$WORK/mnt") \
  || die "could not mount $DMG."
[ -d "$MOUNT/Roster.app" ] || die "$DMG does not contain Roster.app."

step "Installing to $APP_DIR"
[ -d "$APP_DIR" ] || die "$APP_DIR does not exist."
rm -rf "$APP" || die "could not remove the existing $APP (try again with sudo)."
# ditto rather than cp -R: it preserves the ad-hoc code signature and extended
# attributes, and an arm64 bundle whose signature is broken will not launch.
ditto "$MOUNT/Roster.app" "$APP" || die "could not copy Roster.app into $APP_DIR."

hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
MOUNT=""

step "Clearing the quarantine flag"
xattr -dr com.apple.quarantine "$APP" \
  || die "could not clear com.apple.quarantine on $APP; macOS will refuse to open it."

echo
echo "Roster $VERSION installed to $APP"

if [ -t 0 ]; then
  open -a "$APP" || echo "Launch it from $APP_DIR."
else
  echo "Launch it from $APP_DIR, or run: open -a Roster"
fi
