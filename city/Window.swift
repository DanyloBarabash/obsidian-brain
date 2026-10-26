import Cocoa
import WebKit
import CoreLocation

/// A dedicated local window; Markdown stays behind the loopback server.
final class CityApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate, WKScriptMessageHandler, CLLocationManagerDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let locationManager = CLLocationManager()
    var locationRequested = false
    let port = ProcessInfo.processInfo.environment["BRAIN_CITY_PORT"] ?? "8765"
    /// Polls at 0.2 s; covers a Swift rebuild plus the first vault scan.
    let serverWaitAttempts = 300
    let locationKey = "lastLocation"
    let loadingPage = """
    <!doctype html><html lang="uk"><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0f1c24;color:#d8e6ec;font:15px -apple-system,sans-serif}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
    h1{margin:0;font-size:26px;font-weight:600;letter-spacing:.5px}
    .bar{width:260px;height:4px;border-radius:2px;background:#1f3440;overflow:hidden}
    .bar i{display:block;width:40%;height:100%;background:#5fb3c9;animation:run 1.2s ease-in-out infinite}
    @keyframes run{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
    #status{opacity:.7}
    </style><body><h1>Brain City</h1><div class="bar"><i></i></div><div id="status">Будую місто…</div></body></html>
    """

    func applicationDidFinishLaunching(_ notification: Notification) {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        if let iconPath = Bundle.main.path(forResource: "BrainCity", ofType: "icns"), let icon = NSImage(contentsOfFile: iconPath) {
            app.applicationIconImage = icon
        }
        let menu = NSMenu()
        let item = NSMenuItem()
        let submenu = NSMenu()
        submenu.addItem(withTitle: "Оновити місто", action: #selector(reload), keyEquivalent: "r")
        submenu.items.first?.target = self
        submenu.addItem(NSMenuItem.separator())
        submenu.addItem(withTitle: "Завершити Brain City", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = submenu
        menu.addItem(item)
        app.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 960), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Brain City · місто твоїх знань"
        window.minSize = NSSize(width: 950, height: 680)
        window.backgroundColor = NSColor(red: 0.06, green: 0.11, blue: 0.14, alpha: 1)
        window.delegate = self
        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            window.setContentSize(NSSize(width: min(1440, frame.width - 70), height: min(960, frame.height - 70)))
        }
        window.center()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "cityLocation")
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyKilometer
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps: true)
        checkServer()
    }

    func checkServer() {
        let endpoint = URL(string: "http://127.0.0.1:\(port)/api/city")!
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let data = data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], json["districts"] != nil {
                    // A live server keeps the open page; reloading would drop panels such as the market.
                    if self.webView.url == nil { self.reload() }
                } else {
                    self.startServer()
                }
            }
        }.resume()
    }

    func startServer() {
        let launcher = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Open Brain City.command")
        guard FileManager.default.fileExists(atPath: launcher.path) else {
            showError("Відкрий Open Brain City.command у папці city, щоб запустити локальний сервер.")
            return
        }
        // Run the launcher headless behind a loading screen instead of a Terminal window.
        webView.loadHTMLString(loadingPage, baseURL: nil)
        let log = NSHomeDirectory() + "/.cache/brain-city/launcher.log"
        try? FileManager.default.createDirectory(atPath: (log as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: log, contents: nil)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [launcher.path]
        process.standardOutput = FileHandle(forWritingAtPath: log)
        process.standardError = process.standardOutput
        process.terminationHandler = { finished in
            guard finished.terminationStatus != 0 else { return }
            DispatchQueue.main.async {
                self.showError("Місто не запустилося. Деталі: ~/.cache/brain-city/launcher.log і server-\(self.port).log")
            }
        }
        do { try process.run() } catch { showError("Не вдалося запустити \(launcher.lastPathComponent): \(error.localizedDescription)"); return }
        waitForServer(attempt: 0)
    }

    func waitForServer(attempt: Int) {
        guard attempt < serverWaitAttempts else { showError("Місто не запустилося. Перевір Python 3, шлях до Brain та порт \(port)."); return }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/city")!)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { _, response, _ in
            DispatchQueue.main.async {
                if (response as? HTTPURLResponse)?.statusCode == 200 { self.reload() }
                else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.waitForServer(attempt: attempt + 1) } }
            }
        }.resume()
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Brain City"
        alert.informativeText = message
        alert.runModal()
    }

    @objc func reload() { webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)")!)) }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "cityLocation", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "http", message.frameInfo.securityOrigin.host == "127.0.0.1",
              message.frameInfo.securityOrigin.port == Int(port), message.body as? String == "request" else { return }
        locationRequested = true
        requestSystemLocation()
    }

    func requestSystemLocation() {
        // Sun times need only an approximate place, so one fix is reused instead of asking macOS again.
        if let cached = UserDefaults.standard.dictionary(forKey: locationKey) { sendLocation(cached); return }
        guard CLLocationManager.locationServicesEnabled() else { sendLocation(["error": "Увімкни служби геолокації macOS для дня й ночі за Сонцем."]); return }
        switch locationManager.authorizationStatus {
        case .notDetermined: locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: locationManager.requestLocation()
        default: sendLocation(["error": "Дозволь Brain City доступ до геолокації в налаштуваннях macOS."])
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if locationRequested { requestSystemLocation() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        let fix = ["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude]
        UserDefaults.standard.set(fix, forKey: locationKey)
        sendLocation(fix)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        sendLocation(["error": "Не вдалося отримати системне місце розташування. Спробуй ще раз кнопкою дня / ночі."])
    }

    func sendLocation(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('city-location', {detail: \(json)}));", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "obsidian" { NSWorkspace.shared.open(url); decisionHandler(.cancel) }
        else if url.host == "127.0.0.1" && url.port == Int(port) { decisionHandler(.allow) }
        else if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url); decisionHandler(.cancel) }
        else { decisionHandler(.cancel) }
    }

    /// Links with target=_blank (articles, sources) open in the default browser instead of a new web view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url) }
        return nil
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { checkServer(); return true }
}

let app = NSApplication.shared
let delegate = CityApp()
app.delegate = delegate
app.run()
