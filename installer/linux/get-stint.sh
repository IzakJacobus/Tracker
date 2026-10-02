#!/usr/bin/env bash
# One-command install (or upgrade) of Stint Server on Linux with systemd:
#
#   curl -fsSL https://github.com/IzakJacobus/Tracker/releases/latest/download/get-stint.sh | sudo bash
#
# Downloads the latest release for this computer (x64 or arm64), checks it against the
# release's SHA256SUMS.txt, then runs its install.sh. Extra options are passed to install.sh:
#
#   curl -fsSL …/get-stint.sh | sudo bash -s -- --no-firewall
#
# Environment: STINT_VERSION=0.1.0 installs that version instead of the latest.
set -euo pipefail

REPO="${STINT_REPO:-IzakJacobus/Tracker}"
BASE="${STINT_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this with sudo, e.g.  curl -fsSL …/get-stint.sh | sudo bash"
for tool in curl tar sha256sum; do
  command -v "$tool" >/dev/null || die "$tool is missing. Install it first: sudo apt install -y $tool"
done

case "$(uname -m)" in
  x86_64 | amd64) target=linux-x64 ;;
  aarch64 | arm64) target=linux-arm64 ;;
  *) die "Stint Server is built for x64 and arm64 computers; this one is $(uname -m)." ;;
esac

version="${STINT_VERSION:-}"
if [ -z "$version" ]; then
  # github.com/<repo>/releases/latest redirects to …/releases/tag/v<version>
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" ||
    die "couldn't reach GitHub to find the latest version. Check the internet connection."
  version="${latest##*/v}"
  case "$version" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) die "no published Stint release found yet at https://github.com/$REPO/releases." ;;
  esac
fi
version="${version#v}"

file="stint-server-$version-$target.tar.gz"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

say "Downloading Stint Server $version ($target)…"
curl -fL --progress-bar "$BASE/v$version/$file" -o "$work/$file" ||
  die "couldn't download $file from release v$version."
curl -fsSL "$BASE/v$version/SHA256SUMS.txt" -o "$work/SHA256SUMS.txt" ||
  die "couldn't download the release's checksums (SHA256SUMS.txt), so the download can't be verified."

say "Checking the download…"
(cd "$work" && grep " $file\$" SHA256SUMS.txt | sha256sum -c --status) ||
  die "the download doesn't match the release's checksum. Nothing was installed. Try again."

tar -xzf "$work/$file" -C "$work"
dir="$work/stint-server-$version-$target"
[ -x "$dir/install.sh" ] || die "the download doesn't contain install.sh."
bash "$dir/install.sh" --binary "$dir/stint-server" "$@"
