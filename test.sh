#!/usr/bin/env bash
# Read-only lookups for the sim-translation question; saves everything to test.log next to this file and prints it.
#   bash test.sh ["<SDK folder>" ["<MSFS install Packages folder>"]]
# SDK default: $MSFS2024_SDK, then G:/MSFS 2024 SDK, C:/MSFS 2024 SDK.  Packages folder: the one that holds Official\ (pass it if not found).
cd "$(dirname "$0")" || exit 1
LOG="test.log"
exec > >(tee "$LOG") 2>&1

first_dir() { for d in "$@"; do [ -n "$d" ] && [ -d "$d" ] && { echo "$d"; return; }; done; }
SDK=$(first_dir "$1" "$MSFS2024_SDK" "G:/MSFS 2024 SDK" "C:/MSFS 2024 SDK")
PKG=$(first_dir "$2" "$LOCALAPPDATA/Packages/Microsoft.Limitless_8wekyb3d8bbwe/LocalCache/Packages" "$APPDATA/Microsoft Flight Simulator 2024/Packages" "C:/Program Files (x86)/Steam/steamapps/common/MicrosoftFlightSimulator2024/Packages" "G:/MSFS 2024/Packages")

echo "date: $(date)"
echo "SDK folder: ${SDK:-NOT FOUND}"
echo "Packages folder: ${PKG:-NOT FOUND (pass it as the 2nd argument)}"

echo; echo "== 1. How the SDK's own samples declare a Localization asset group (xml files mentioning Localization) =="
if [ -n "$SDK" ]; then
  grep -rIn --include=*.xml -i -B2 -A6 "<Type>Localization" "$SDK" 2>/dev/null | head -80
  echo "-- any other xml line mentioning Localization:"
  grep -rIn --include=*.xml -i "Localization" "$SDK" 2>/dev/null | head -30
  echo "-- .loc / .locPak files in the SDK:"
  find "$SDK" \( -iname "*.loc" -o -iname "*.locpak" \) 2>/dev/null | head -20
fi

echo; echo "== 2. How the stock UI turns TT: keys into text (js files) =="
if [ -n "$PKG" ]; then
  grep -rIn --include=*.js -E 'Utils\.Translate|Coherent\.translate|\.translate\(|LocalizationManager|"TT:|'"'"'TT:' "$PKG/Official" 2>/dev/null | head -40
fi
echo; echo "== 3. Same search in the SDK (its EFB sample and docs js) =="
[ -n "$SDK" ] && grep -rIn --include=*.js -E 'Utils\.Translate|Coherent\.translate|\.translate\(|LocalizationManager|TT:' "$SDK" 2>/dev/null | head -30

echo; echo "== 4a. How the EFB sample turns its @fs-base,TT: strings into text: context and users =="
EFB="$SDK/Samples/DevmodeProjects/EFB"
if [ -d "$EFB" ]; then
  sed -n '385,398p;433,445p' "$EFB/PackageSources/efb_api/dist/index.js" 2>/dev/null | cut -c1-200
  echo "-- what reads those arrays / any translate-like call in the sample (all js):"
  grep -rIn --include=*.js -E 'Locale|Localiz|translate|Translate|SUNDAY|monthShort|TT:' "$EFB" 2>/dev/null | grep -v 'TIME\.[A-Za-z]*",\?$' | cut -c1-240 | head -60
  echo "-- the sample's own package definition and every AssetGroup Type used by SDK sample projects:"
  find "$EFB" -name "*.xml" -path "*PackageDefinitions*" 2>/dev/null | head
  grep -rIh --include=*.xml -o "<Type>[A-Za-z]*</Type>" "$SDK/Samples" 2>/dev/null | sort | uniq -c
fi

echo; echo "== 4b. What the sim's own UI package looks like (ui js that mentions TT: or translate) =="
if [ -n "$PKG" ]; then
  ls "$PKG/Official" 2>/dev/null | head
  find "$PKG/Official" -maxdepth 3 -iname "*html_ui*" 2>/dev/null | head -5
  find "$PKG/Official" -iname "*.locpak" 2>/dev/null | head -5
fi

echo; echo "== 5. The asset group type names the package tool knows (strings in the SDK tool binaries) =="
if [ -n "$SDK" ]; then
  find "$SDK/Tools" -maxdepth 2 \( -iname "fspackagetool*" -o -iname "*ProjectEditor*" -o -iname "*PackageTool*" \) \( -name "*.exe" -o -name "*.dll" \) 2>/dev/null | head -8 | while IFS= read -r f; do
    echo "-- $f"
    tr -d '\000' < "$f" | grep -a -o -E '[A-Za-z_.]*[Ll]ocali[sz]ation[A-Za-z_.]*|[A-Za-z_.]*[Ll]ocPak[A-Za-z_.]*|\.loc\b' | sort -u | head -40
  done
fi

echo; echo "== 5b. Which SDK tool files mention locPak or a Localization asset type (file names only) =="
[ -n "$SDK" ] && grep -rlaiP 'l\x00?o\x00?c\x00?P\x00?a\x00?k|L\x00?o\x00?c\x00?a\x00?l\x00?i\x00?z\x00?a\x00?t\x00?i\x00?o\x00?n\x00?A\x00?s\x00?s\x00?e\x00?t' "$SDK/Tools" --include=*.exe --include=*.dll --include=*.xml --include=*.json --include=*.config 2>/dev/null | head -20

echo; echo "== 6. Fonts: which font-family the SDK's EFB sample and the sim's own UI use, and font files that ship =="
if [ -n "$SDK" ]; then
  echo "-- font-family / @font-face in the EFB sample (css, and html/js strings):"
  grep -rIhoE --include=*.css --include=*.scss --include=*.html "font-family:[^;}]*|@font-face[^}]*src:[^;}]*" "$SDK/Samples/DevmodeProjects/EFB" 2>/dev/null | sort | uniq -c | sort -rn | head -25
  echo "-- font files in the SDK samples:"
  find "$SDK/Samples" \( -iname "*.ttf" -o -iname "*.otf" -o -iname "*.woff" -o -iname "*.woff2" \) 2>/dev/null | head -20
fi
if [ -n "$PKG" ]; then
  echo "-- font files / font css in the sim's Official packages:"
  find "$PKG/Official" \( -iname "*.ttf" -o -iname "*.otf" -o -iname "*.woff" -o -iname "*.woff2" \) 2>/dev/null | head -30
  grep -rIhoE --include=*.css "font-family:[^;}]*" "$PKG/Official" 2>/dev/null | sort | uniq -c | sort -rn | head -25
fi

echo; echo "== 7. Every font-family named anywhere in the SDK or the sim's UI (css, js, html), most common first =="
for root in "$SDK" "$PKG/Official"; do
  [ -n "$root" ] && [ -d "$root" ] || continue
  echo "-- under $root:"
  grep -rIhoE --include=*.css --include=*.js --include=*.html --include=*.scss "font-family: *[^;}\"']*" "$root" 2>/dev/null | sed 's/  */ /g' | sort | uniq -c | sort -rn | head -25
done

echo; echo "== 4. Is our .loc / .locPak in the built package? =="
find Packages -iname "*.loc" -o -iname "*.locpak" 2>/dev/null
echo "done: $LOG"
