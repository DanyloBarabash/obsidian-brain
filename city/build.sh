#!/bin/zsh
set -euo pipefail
CITY_DIR="${0:A:h}"
CITY_APP="$CITY_DIR/build/Brain City.app"
mkdir -p "$CITY_APP/Contents/MacOS" "$CITY_APP/Contents/Resources/web"
if [[ ! -x "$CITY_APP/Contents/MacOS/BrainCity" || "$CITY_DIR/Window.swift" -nt "$CITY_APP/Contents/MacOS/BrainCity" ]]; then
  CITY_SDK="$(xcrun --show-sdk-path)"
  CITY_OS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
  CITY_SYSTEM_SDK="${CITY_SDK:h}/MacOSX${CITY_OS_MAJOR}.sdk"
  # Prefer the installed OS SDK when a newer beta SDK exceeds this compiler.
  [[ ! -d "$CITY_SYSTEM_SDK" ]] || CITY_SDK="$CITY_SYSTEM_SDK"
  swiftc -sdk "$CITY_SDK" "$CITY_DIR/Window.swift" -o "$CITY_APP/Contents/MacOS/BrainCity" -framework Cocoa -framework WebKit -framework CoreLocation
fi
cp "$CITY_DIR/server.py" "$CITY_APP/Contents/Resources/server.py"
cp "$CITY_DIR/city_state.py" "$CITY_APP/Contents/Resources/city_state.py"
cp "$CITY_DIR/preparation.py" "$CITY_APP/Contents/Resources/preparation.py"
cp "$CITY_DIR/classification.py" "$CITY_APP/Contents/Resources/classification.py"
cp "$CITY_DIR/market.py" "$CITY_APP/Contents/Resources/market.py"
cp "$CITY_DIR/library.py" "$CITY_APP/Contents/Resources/library.py"
cp "$CITY_DIR/verify_simulation.py" "$CITY_APP/Contents/Resources/verify_simulation.py"
mkdir -p "$CITY_APP/Contents/Resources/simulation" "$CITY_APP/Contents/Resources/tests" "$CITY_APP/Contents/Resources/build/verification"
cp "$CITY_DIR/simulation/"*.py "$CITY_APP/Contents/Resources/simulation/"
cp "$CITY_DIR/tests/"*.py "$CITY_APP/Contents/Resources/tests/"
mkdir -p "$CITY_APP/Contents/Resources/reader/tests" "$CITY_APP/Contents/Resources/reader/web"
cp "$CITY_DIR/../reader/"*.py "$CITY_DIR/../reader/sources.json" "$CITY_APP/Contents/Resources/reader/"
cp "$CITY_DIR/../reader/tests/"*.py "$CITY_APP/Contents/Resources/reader/tests/"
cp "$CITY_DIR/../reader/web/"* "$CITY_APP/Contents/Resources/reader/web/"
if [[ -f "$CITY_DIR/build/verification/simulation.json" ]]; then
  cp "$CITY_DIR/build/verification/simulation.json" "$CITY_APP/Contents/Resources/build/verification/simulation.json"
fi
cp -R "$CITY_DIR/web/"* "$CITY_APP/Contents/Resources/web/"
rm -f "$CITY_APP/Contents/Resources/web/details.js" "$CITY_APP/Contents/Resources/tests/test_details.js"
cp "$CITY_DIR/assets/BrainCity.icns" "$CITY_APP/Contents/Resources/BrainCity.icns"
cat > "$CITY_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>BrainCity</string>
<key>CFBundleIdentifier</key><string>local.brain.city</string>
<key>CFBundleName</key><string>Brain City</string>
<key>CFBundleIconFile</key><string>BrainCity.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>2</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSLocationUsageDescription</key><string>Місце розташування потрібне, щоб перемикати день і ніч у місті за сходом та заходом Сонця.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Місце розташування потрібне лише для локального визначення світлового дня.</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
touch "$CITY_APP"
echo "$CITY_APP"
