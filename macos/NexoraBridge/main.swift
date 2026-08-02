import AppKit
import CryptoKit
import Foundation
import Security
import WebKit

private let productSite = "https://product-private-cloud-staging--nexora-core-staging.netlify.app"
private let keychainService = "com.nexora.core.bridge"
private let keychainAccount = "desktop-command-agent"

private extension Data {
  init?(base64URL value: String) {
    var base64 = value.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    guard let decoded = Data(base64Encoded: base64) else { return nil }
    self = decoded
  }

  var base64URL: String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

private struct BridgeCredential: Codable, Equatable {
  let version: Int
  let agentId: String
  let vaultId: String
  let secret: String
  let displayName: String?
}

private struct BridgeConfiguration: Codable, Equatable {
  let version: Int
  let siteURL: String
  let credential: BridgeCredential

  enum CodingKeys: String, CodingKey {
    case version
    case siteURL = "siteUrl"
    case credential
  }
}

private enum PairingCode {
  static func parse(_ rawValue: String) -> BridgeConfiguration? {
    let parts = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
      .components(separatedBy: ".")
    guard parts.count == 4, parts[0] == "NXC1" else { return nil }
    guard UUID(uuidString: parts[1]) != nil else { return nil }
    guard parts[2].range(of: "^[A-Za-z0-9_-]{22}$", options: .regularExpression) != nil else {
      return nil
    }
    guard parts[3].range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
          Data(base64URL: parts[3])?.count == 32 else {
      return nil
    }
    return BridgeConfiguration(
      version: 1,
      siteURL: productSite,
      credential: BridgeCredential(
        version: 1,
        agentId: parts[1].lowercased(),
        vaultId: parts[2],
        secret: parts[3],
        displayName: "NEXORA Desktop"
      )
    )
  }

  static func validate(_ configuration: BridgeConfiguration) -> BridgeConfiguration? {
    guard configuration.version == 1, configuration.siteURL == productSite else { return nil }
    let credential = configuration.credential
    return parse("NXC1.\(credential.agentId).\(credential.vaultId).\(credential.secret)")
  }
}

private enum KeychainStore {
  static func save(_ configuration: BridgeConfiguration) throws {
    let data = try JSONEncoder().encode(configuration)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var insert = query
      attributes.forEach { insert[$0.key] = $0.value }
      let insertStatus = SecItemAdd(insert as CFDictionary, nil)
      guard insertStatus == errSecSuccess else { throw KeychainError.status(insertStatus) }
    } else if status != errSecSuccess {
      throw KeychainError.status(status)
    }
  }

  static func load() -> BridgeConfiguration? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data,
          let decoded = try? JSONDecoder().decode(BridgeConfiguration.self, from: data) else {
      return nil
    }
    return PairingCode.validate(decoded)
  }

  static func delete() throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError.status(status)
    }
  }

  private enum KeychainError: Error {
    case status(OSStatus)
  }
}

private enum LegacyPairing {
  static func importIfPresent() -> BridgeConfiguration? {
    let url = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".nexora/bridge.json")
    guard let data = try? Data(contentsOf: url),
          let decoded = try? JSONDecoder().decode(BridgeConfiguration.self, from: data),
          let configuration = PairingCode.validate(decoded),
          (try? KeychainStore.save(configuration)) != nil else {
      return nil
    }
    return configuration
  }
}

private struct CommandPayload: Codable {
  let algorithm: String
  let iv: String
  let ciphertext: String
}

private struct CloudCommand: Codable {
  let commandId: String
  let version: Int
  let agentId: String
  let vaultId: String
  let keyVersion: Int
  let expiresInSeconds: Int
  let createdAt: String
  let expiresAt: String
  let deliveredAt: String
  let payload: CommandPayload
}

private struct ClaimResponse: Decodable {
  let command: CloudCommand?
}

private struct CommandParameters: Codable {
  let level: Int?
  let delta: Int?
  let app: String?
  let room: String?
  let degrees: Int?
}

private struct DeviceCommand: Codable {
  let version: Int
  let target: String
  let action: String
  let parameters: CommandParameters
  let label: String

  var isAllowed: Bool {
    guard version == 1, label.count <= 120 else { return false }
    if target == "computer" {
      switch action {
      case "volume.set":
        return parameters.level.map { (0...100).contains($0) } == true
      case "volume.change":
        return parameters.delta == -10 || parameters.delta == 10
      case "volume.mute", "volume.unmute", "media.play", "media.pause", "media.next", "media.previous":
        return true
      case "app.open":
        return ["safari", "music", "calendar", "notes", "calculator"].contains(parameters.app ?? "")
      default:
        return false
      }
    }
    if target == "home" {
      if ["light.on", "light.off", "curtain.open", "curtain.close"].contains(action) {
        return ["客厅", "卧室", "书房", "全屋"].contains(parameters.room ?? "")
      }
      if action == "climate.set" {
        return parameters.degrees.map { (16...30).contains($0) } == true
      }
    }
    return false
  }
}

private enum CommandCrypto {
  static func additionalData(agentId: String, vaultId: String) -> Data {
    Data("nexora-device-command-v1:\(agentId):\(vaultId)".utf8)
  }

  static func key(for credential: BridgeCredential) throws -> SymmetricKey {
    guard let secret = Data(base64URL: credential.secret), secret.count == 32 else {
      throw CryptoError.invalidCredential
    }
    return HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: secret),
      salt: Data("nexora-device-command-agent-v1".utf8),
      info: additionalData(agentId: credential.agentId, vaultId: credential.vaultId),
      outputByteCount: 32
    )
  }

  static func decrypt(_ envelope: CloudCommand, credential: BridgeCredential) throws -> DeviceCommand {
    guard envelope.version == 1,
          envelope.keyVersion == 1,
          envelope.agentId == credential.agentId,
          envelope.vaultId == credential.vaultId,
          envelope.payload.algorithm == "A256GCM",
          let nonceData = Data(base64URL: envelope.payload.iv), nonceData.count == 12,
          let combined = Data(base64URL: envelope.payload.ciphertext), combined.count >= 17 else {
      throw CryptoError.invalidEnvelope
    }
    let nonce = try AES.GCM.Nonce(data: nonceData)
    let ciphertext = combined.dropLast(16)
    let tag = combined.suffix(16)
    let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
    let plaintext = try AES.GCM.open(
      sealed,
      using: key(for: credential),
      authenticating: additionalData(agentId: credential.agentId, vaultId: credential.vaultId)
    )
    let command = try JSONDecoder().decode(DeviceCommand.self, from: plaintext)
    guard command.isAllowed else { throw CryptoError.disallowedCommand }
    return command
  }

  private enum CryptoError: Error {
    case invalidCredential
    case invalidEnvelope
    case disallowedCommand
  }
}

private enum CommandExecutor {
  private static let applications = [
    "safari": "Safari",
    "music": "Music",
    "calendar": "Calendar",
    "notes": "Notes",
    "calculator": "Calculator"
  ]

  static func execute(_ command: DeviceCommand) -> Bool {
    guard command.isAllowed else { return false }
    if command.target == "home" { return true }

    if command.action == "app.open", let app = command.parameters.app.flatMap({ applications[$0] }) {
      return run("/usr/bin/open", arguments: ["-a", app])
    }
    if command.action == "volume.set", let level = command.parameters.level {
      return run("/usr/bin/osascript", arguments: ["-e", "set volume output volume \(level)"])
    }
    if command.action == "volume.change", let delta = command.parameters.delta {
      let script = [
        "set currentVolume to output volume of (get volume settings)",
        "set nextVolume to currentVolume + \(delta)",
        "if nextVolume > 100 then set nextVolume to 100",
        "if nextVolume < 0 then set nextVolume to 0",
        "set volume output volume nextVolume"
      ].joined(separator: "\n")
      return run("/usr/bin/osascript", arguments: ["-e", script])
    }
    if command.action == "volume.mute" {
      return run("/usr/bin/osascript", arguments: ["-e", "set volume with output muted"])
    }
    if command.action == "volume.unmute" {
      return run("/usr/bin/osascript", arguments: ["-e", "set volume without output muted"])
    }
    let mediaScripts = [
      "media.play": "tell application \"Music\" to play",
      "media.pause": "tell application \"Music\" to pause",
      "media.next": "tell application \"Music\" to next track",
      "media.previous": "tell application \"Music\" to previous track"
    ]
    if let script = mediaScripts[command.action] {
      return run("/usr/bin/osascript", arguments: ["-e", script])
    }
    return false
  }

  private static func run(_ executable: String, arguments: [String]) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = Pipe()
    process.standardError = Pipe()
    do {
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus == 0
    } catch {
      return false
    }
  }
}

private final class BridgePoller {
  typealias StatusHandler = (String, Bool) -> Void

  private let queue = DispatchQueue(label: "com.nexora.core.bridge.poller", qos: .utility)
  private let session: URLSession
  private var timer: DispatchSourceTimer?
  private var configuration: BridgeConfiguration?
  private var statusHandler: StatusHandler?
  private var inFlight = false

  init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 10
    configuration.timeoutIntervalForResource = 15
    configuration.urlCache = nil
    configuration.httpAdditionalHeaders = ["User-Agent": "NEXORA-Bridge-macOS/0.1"]
    session = URLSession(configuration: configuration)
  }

  func start(configuration: BridgeConfiguration, status: @escaping StatusHandler) {
    queue.async {
      self.stopLocked()
      self.configuration = configuration
      self.statusHandler = status
      let timer = DispatchSource.makeTimerSource(queue: self.queue)
      timer.schedule(deadline: .now(), repeating: 2.5, leeway: .milliseconds(250))
      timer.setEventHandler { [weak self] in self?.poll() }
      self.timer = timer
      timer.resume()
    }
  }

  func stop() {
    queue.async { self.stopLocked() }
  }

  private func stopLocked() {
    timer?.setEventHandler {}
    timer?.cancel()
    timer = nil
    configuration = nil
    statusHandler = nil
    inFlight = false
  }

  private func update(_ text: String, online: Bool) {
    guard let handler = statusHandler else { return }
    DispatchQueue.main.async { handler(text, online) }
  }

  private func request(path: String, method: String = "GET", body: Data? = nil) -> URLRequest? {
    guard let configuration,
          let url = URL(string: configuration.siteURL + path) else { return nil }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("Bearer \(configuration.credential.secret)", forHTTPHeaderField: "Authorization")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    return request
  }

  private func poll() {
    guard !inFlight, let configuration else { return }
    let agentId = configuration.credential.agentId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
    guard let request = request(path: "/api/device-bridge/commands?agentId=\(agentId)") else { return }
    inFlight = true
    session.dataTask(with: request) { [weak self] data, response, error in
      guard let self else { return }
      self.queue.async {
        guard self.configuration != nil else { return }
        guard error == nil,
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let data,
              let claim = try? JSONDecoder().decode(ClaimResponse.self, from: data) else {
          self.inFlight = false
          let unauthorized = (response as? HTTPURLResponse)?.statusCode == 401
          self.update(unauthorized ? "配对已失效" : "连接中断，正在重试", online: false)
          return
        }
        guard let envelope = claim.command else {
          self.inFlight = false
          self.update("云端桌面客户端在线", online: true)
          return
        }
        let succeeded: Bool
        var label = "电脑指令"
        do {
          if let expiresAt = ISO8601DateFormatter().date(from: envelope.expiresAt), expiresAt <= Date() {
            throw PollError.expired
          }
          let command = try CommandCrypto.decrypt(envelope, credential: configuration.credential)
          label = String(command.label.prefix(80))
          succeeded = CommandExecutor.execute(command)
        } catch {
          succeeded = false
        }
        self.acknowledge(envelope, succeeded: succeeded, label: label)
      }
    }.resume()
  }

  private func acknowledge(_ command: CloudCommand, succeeded: Bool, label: String) {
    guard let configuration,
          let body = try? JSONSerialization.data(withJSONObject: [
            "outcome": succeeded ? "acknowledged" : "failed"
          ]) else {
      inFlight = false
      return
    }
    let agentId = configuration.credential.agentId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
    let commandId = command.commandId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
    guard let request = request(
      path: "/api/device-bridge/commands/\(commandId)/ack?agentId=\(agentId)",
      method: "POST",
      body: body
    ) else {
      inFlight = false
      return
    }
    session.dataTask(with: request) { [weak self] _, response, error in
      guard let self else { return }
      self.queue.async {
        self.inFlight = false
        let accepted = error == nil
          && (response as? HTTPURLResponse).map { (200...299).contains($0.statusCode) } == true
        if accepted {
          self.update(succeeded ? "已执行：\(label)" : "已拒绝不安全或无效指令", online: true)
        } else {
          self.update("回执失败，正在重试", online: false)
        }
      }
    }.resume()
  }

  private enum PollError: Error {
    case expired
  }
}

private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
  private let rootURL: URL

  init(rootURL: URL) {
    self.rootURL = rootURL.standardizedFileURL
    super.init()
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let requestURL = urlSchemeTask.request.url,
          requestURL.scheme == "nexora-pet",
          requestURL.host == "app" else {
      urlSchemeTask.didFailWithError(SchemeError.invalidURL)
      return
    }
    let relativePath = requestURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let fileURL = rootURL.appendingPathComponent(relativePath).standardizedFileURL
    let allowedPrefix = rootURL.path.hasSuffix("/") ? rootURL.path : rootURL.path + "/"
    guard fileURL.path.hasPrefix(allowedPrefix),
          let data = try? Data(contentsOf: fileURL) else {
      urlSchemeTask.didFailWithError(SchemeError.missingResource)
      return
    }
    let response = URLResponse(
      url: requestURL,
      mimeType: Self.mimeType(for: fileURL.pathExtension),
      expectedContentLength: data.count,
      textEncodingName: Self.isText(fileURL.pathExtension) ? "utf-8" : nil
    )
    urlSchemeTask.didReceive(response)
    urlSchemeTask.didReceive(data)
    urlSchemeTask.didFinish()
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

  private static func isText(_ fileExtension: String) -> Bool {
    ["html", "css", "js", "mjs", "json", "txt"].contains(fileExtension.lowercased())
  }

  private static func mimeType(for fileExtension: String) -> String {
    switch fileExtension.lowercased() {
    case "html": return "text/html"
    case "css": return "text/css"
    case "js", "mjs": return "text/javascript"
    case "json": return "application/json"
    case "glb": return "model/gltf-binary"
    case "png": return "image/png"
    case "webp": return "image/webp"
    case "wasm": return "application/wasm"
    default: return "application/octet-stream"
    }
  }

  private enum SchemeError: Error {
    case invalidURL
    case missingResource
  }
}

private final class DesktopPetPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

private final class TransparentPetWebView: WKWebView {
  override var isOpaque: Bool { false }
}

private final class DesktopPetController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  private static let frameKey = "desktopPet.frame.v1"
  private static let visibleKey = "desktopPet.visible.v1"
  private static let clickThroughKey = "desktopPet.clickThrough.v1"
  private static let starterKey = "desktopPet.starter.v1"
  private static let stageKey = "desktopPet.stage.v1"
  private static let starters = Set(["cute", "cool", "beautiful"])
  private static let stages = Set(["seed", "young", "resonance"])
  private static let actions = Set(["idle", "listening", "nod", "affection", "wave", "speaking", "walk", "run"])

  private let defaults: UserDefaults
  private let schemeHandler: BundleSchemeHandler
  private var panel: DesktopPetPanel!
  private var webView: WKWebView!
  private var eventMonitor: Any?
  private var dragStart: (mouse: NSPoint, origin: NSPoint)?
  private var frameSaveWorkItem: DispatchWorkItem?
  private(set) var modelReady = false
  private(set) var modelError: String?
  private(set) var starter: String
  private(set) var stage: String
  private(set) var isClickThrough: Bool

  var isVisible: Bool { panel.isVisible }
  var currentSize: NSSize { panel.frame.size }

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    let savedStarter = defaults.string(forKey: Self.starterKey) ?? "cute"
    let savedStage = defaults.string(forKey: Self.stageKey) ?? "seed"
    starter = Self.starters.contains(savedStarter) ? savedStarter : "cute"
    stage = Self.stages.contains(savedStage) ? savedStage : "seed"
    isClickThrough = defaults.bool(forKey: Self.clickThroughKey)
    let webRoot = Bundle.main.resourceURL?.appendingPathComponent("Web")
      ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    schemeHandler = BundleSchemeHandler(rootURL: webRoot)
    super.init()
    configureWindow()
    installDragMonitor()
  }

  deinit {
    stop()
  }

  func start() {
    let hasSavedVisibility = defaults.object(forKey: Self.visibleKey) != nil
    if !hasSavedVisibility || defaults.bool(forKey: Self.visibleKey) {
      show()
    }
  }

  func stop() {
    frameSaveWorkItem?.cancel()
    frameSaveWorkItem = nil
    panel?.orderOut(nil)
    webView?.stopLoading()
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "desktopPet")
    if let eventMonitor {
      NSEvent.removeMonitor(eventMonitor)
      self.eventMonitor = nil
    }
  }

  func inspectRuntime(completion: @escaping (Bool) -> Void) {
    let transparent = panel.styleMask.contains(.borderless)
      && !panel.isOpaque
      && panel.backgroundColor.alphaComponent == 0
      && webView.underPageBackgroundColor.alphaComponent == 0
    webView.evaluateJavaScript("window.__NEXORA_DESKTOP_PET_QA__?.sampleModel()") { value, error in
      let result = value as? [String: Any]
      let opaquePixels = (result?["opaque"] as? NSNumber)?.intValue ?? 0
      let cornerAlphas = self.windowCornerAlphas()
      let cornersTransparent = cornerAlphas?.allSatisfy { $0 < 0.05 } == true
      print("NEXORA desktop pet runtime: webgl=\(opaquePixels) transparent=\(transparent) cornerAlpha=\(cornerAlphas ?? [])")
      completion(error == nil && transparent && opaquePixels > 100 && cornersTransparent)
    }
  }

  func show() {
    panel.orderFrontRegardless()
    defaults.set(true, forKey: Self.visibleKey)
  }

  func hide() {
    panel.orderOut(nil)
    defaults.set(false, forKey: Self.visibleKey)
  }

  func toggleVisibility() {
    isVisible ? hide() : show()
  }

  func setClickThrough(_ enabled: Bool) {
    isClickThrough = enabled
    panel.ignoresMouseEvents = enabled
    defaults.set(enabled, forKey: Self.clickThroughKey)
  }

  func setStarter(_ value: String) {
    guard Self.starters.contains(value) else { return }
    starter = value
    defaults.set(value, forKey: Self.starterKey)
    applyConfiguration()
    show()
  }

  func setStage(_ value: String) {
    guard Self.stages.contains(value) else { return }
    stage = value
    defaults.set(value, forKey: Self.stageKey)
    applyConfiguration()
    show()
  }

  func play(_ action: String) {
    guard Self.actions.contains(action) else { return }
    evaluate(function: "play", payload: ["action": action])
    show()
  }

  func resetPosition() {
    let visibleFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let origin = NSPoint(
      x: visibleFrame.maxX - panel.frame.width - 24,
      y: visibleFrame.minY + 24
    )
    panel.setFrameOrigin(origin)
    saveFrame()
    show()
  }

  func resetSize() {
    resizeWindow(toWidth: 340, anchor: NSPoint(x: panel.frame.midX, y: panel.frame.midY))
    saveFrame()
    show()
  }

  func resizeForSelfTest(by factor: CGFloat) {
    resizeWindow(by: factor, anchor: NSPoint(x: panel.frame.midX, y: panel.frame.midY))
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "desktopPet",
          let body = message.body as? [String: Any],
          let type = body["type"] as? String else { return }
    if type == "ready" {
      modelReady = true
      applyConfiguration()
    } else if type == "open-chat" {
      guard let url = URL(string: productSite + "/soulmate/") else { return }
      NSWorkspace.shared.open(url)
    } else if type == "model-error" {
      modelError = String(describing: body["message"] ?? "unknown model error")
      NSLog("NEXORA desktop pet: %@", modelError ?? "unknown model error")
    }
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    if url.scheme == "nexora-pet" {
      decisionHandler(.allow)
      return
    }
    if url.scheme == "https" {
      NSWorkspace.shared.open(url)
    }
    decisionHandler(.cancel)
  }

  private func configureWindow() {
    let size = NSSize(width: 340, height: 430)
    let savedFrame = defaults.string(forKey: Self.frameKey).map(NSRectFromString)
    let initialFrame = savedFrame.flatMap { frame in
      NSScreen.screens.contains(where: { $0.visibleFrame.intersects(frame) }) ? frame : nil
    } ?? NSRect(origin: .zero, size: size)

    panel = DesktopPetPanel(
      contentRect: initialFrame,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.level = .floating
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.animationBehavior = .utilityWindow
    panel.ignoresMouseEvents = isClickThrough

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "nexora-pet")
    configuration.userContentController.add(self, name: "desktopPet")
    webView = TransparentPetWebView(
      frame: panel.contentView?.bounds ?? NSRect(origin: .zero, size: size),
      configuration: configuration
    )
    webView.navigationDelegate = self
    webView.autoresizingMask = [.width, .height]
    webView.underPageBackgroundColor = .clear
    webView.wantsLayer = true
    webView.layer?.isOpaque = false
    webView.layer?.backgroundColor = NSColor.clear.cgColor
    webView.setValue(false, forKey: "drawsBackground")
    panel.contentView = webView
    panel.contentView?.wantsLayer = true
    panel.contentView?.layer?.isOpaque = false
    panel.contentView?.layer?.backgroundColor = NSColor.clear.cgColor

    if savedFrame == nil { resetPosition() }
    if let url = URL(string: "nexora-pet://app/desktop-pet/index.html") {
      webView.load(URLRequest(url: url))
    }
  }

  private func installDragMonitor() {
    eventMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .scrollWheel, .magnify]
    ) { [weak self] event in
      self?.handlePointerEvent(event)
      return event
    }
  }

  private func handlePointerEvent(_ event: NSEvent) {
    guard !isClickThrough, event.window === panel else { return }
    if event.type == .scrollWheel {
      let sensitivity: CGFloat = event.hasPreciseScrollingDeltas ? 0.012 : 0.045
      let factor = exp(CGFloat(event.scrollingDeltaY) * sensitivity)
      resizeWindow(by: factor, anchor: NSEvent.mouseLocation)
      scheduleFrameSave()
      return
    }
    if event.type == .magnify {
      let factor = min(1.18, max(0.82, 1 + CGFloat(event.magnification)))
      resizeWindow(by: factor, anchor: NSEvent.mouseLocation)
      scheduleFrameSave()
      return
    }
    if event.type == .leftMouseDown {
      dragStart = (NSEvent.mouseLocation, panel.frame.origin)
      return
    }
    if event.type == .leftMouseUp {
      if dragStart != nil { saveFrame() }
      dragStart = nil
      return
    }
    guard event.type == .leftMouseDragged, let dragStart else { return }
    let mouse = NSEvent.mouseLocation
    let proposed = NSPoint(
      x: dragStart.origin.x + mouse.x - dragStart.mouse.x,
      y: dragStart.origin.y + mouse.y - dragStart.mouse.y
    )
    let visibleFrame = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
    guard let visibleFrame else {
      panel.setFrameOrigin(proposed)
      return
    }
    panel.setFrameOrigin(NSPoint(
      x: min(max(proposed.x, visibleFrame.minX), visibleFrame.maxX - panel.frame.width),
      y: min(max(proposed.y, visibleFrame.minY), visibleFrame.maxY - panel.frame.height)
    ))
  }

  private func resizeWindow(by factor: CGFloat, anchor: NSPoint) {
    resizeWindow(toWidth: panel.frame.width * min(1.25, max(0.8, factor)), anchor: anchor)
  }

  private func resizeWindow(toWidth proposedWidth: CGFloat, anchor: NSPoint) {
    let frame = panel.frame
    let aspectRatio: CGFloat = 340 / 430
    let visibleFrame = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
    let maximumWidth = min(560, max(220, (visibleFrame?.width ?? 576) - 16))
    let width = min(maximumWidth, max(220, proposedWidth))
    let height = width / aspectRatio
    let anchorX = min(1, max(0, (anchor.x - frame.minX) / max(1, frame.width)))
    let anchorY = min(1, max(0, (anchor.y - frame.minY) / max(1, frame.height)))
    var nextFrame = NSRect(
      x: anchor.x - width * anchorX,
      y: anchor.y - height * anchorY,
      width: width,
      height: height
    )
    if let visibleFrame {
      nextFrame.origin.x = min(max(nextFrame.minX, visibleFrame.minX), visibleFrame.maxX - width)
      nextFrame.origin.y = min(max(nextFrame.minY, visibleFrame.minY), visibleFrame.maxY - height)
    }
    panel.setFrame(nextFrame, display: true)
  }

  private func scheduleFrameSave() {
    frameSaveWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in self?.saveFrame() }
    frameSaveWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: workItem)
  }

  private func windowCornerAlphas() -> [CGFloat]? {
    panel.displayIfNeeded()
    guard panel.windowNumber > 0,
          let image = CGWindowListCreateImage(
            .null,
            .optionIncludingWindow,
            CGWindowID(panel.windowNumber),
            [.boundsIgnoreFraming]
          ) else { return nil }
    let bitmap = NSBitmapImageRep(cgImage: image)
    let inset = 3
    let samples = [
      (inset, inset),
      (max(inset, bitmap.pixelsWide - inset - 1), inset),
      (inset, max(inset, bitmap.pixelsHigh - inset - 1)),
      (max(inset, bitmap.pixelsWide - inset - 1), max(inset, bitmap.pixelsHigh - inset - 1))
    ]
    return samples.map { point in
      bitmap.colorAt(x: point.0, y: point.1)?.alphaComponent ?? 1
    }
  }

  private func saveFrame() {
    defaults.set(NSStringFromRect(panel.frame), forKey: Self.frameKey)
  }

  private func applyConfiguration() {
    guard modelReady else { return }
    evaluate(function: "configure", payload: ["starter": starter, "stage": stage, "action": "idle"])
  }

  private func evaluate(function: String, payload: [String: String]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8) else { return }
    webView.evaluateJavaScript("window.NexoraDesktopPet?.\(function)(\(json));")
  }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
  private let poller = BridgePoller()
  private var desktopPet: DesktopPetController!
  private var statusItem: NSStatusItem!
  private var statusMenuItem: NSMenuItem!
  private var petVisibilityMenuItem: NSMenuItem!
  private var petClickThroughMenuItem: NSMenuItem!
  private var petStarterMenuItems: [NSMenuItem] = []
  private var petStageMenuItems: [NSMenuItem] = []
  private var pairMenuItem: NSMenuItem!
  private var pauseMenuItem: NSMenuItem!
  private var removeMenuItem: NSMenuItem!
  private var configuration: BridgeConfiguration?
  private var paused = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    desktopPet = DesktopPetController()
    configureMenu()
    desktopPet.start()
    refreshPetMenu()
    configuration = KeychainStore.load() ?? LegacyPairing.importIfPresent()
    if let configuration {
      start(configuration)
    } else {
      updateStatus("尚未配对", online: false)
      DispatchQueue.main.async { self.showPairingWindow() }
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    poller.stop()
    desktopPet = nil
  }

  private func configureMenu() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    statusItem.button?.image = NSImage(systemSymbolName: "link.circle", accessibilityDescription: "NEXORA Bridge")
    statusItem.button?.image?.isTemplate = true
    statusItem.button?.toolTip = "NEXORA Bridge"

    let menu = NSMenu()
    statusMenuItem = NSMenuItem(title: "正在启动", action: nil, keyEquivalent: "")
    statusMenuItem.isEnabled = false
    menu.addItem(statusMenuItem)
    menu.addItem(.separator())

    let openProduct = NSMenuItem(title: "打开 NEXORA CORE", action: #selector(openProductPage), keyEquivalent: "o")
    openProduct.target = self
    menu.addItem(openProduct)

    petVisibilityMenuItem = NSMenuItem(title: "显示桌面宠物", action: #selector(toggleDesktopPet), keyEquivalent: "d")
    petVisibilityMenuItem.target = self
    menu.addItem(petVisibilityMenuItem)

    let starterRoot = NSMenuItem(title: "桌面伙伴", action: nil, keyEquivalent: "")
    let starterMenu = NSMenu(title: "桌面伙伴")
    for (title, value) in [("LUMO · 绒云兽", "cute"), ("VEYR · 曜影兽", "cool"), ("AERA · 月羽灵", "beautiful")] {
      let item = NSMenuItem(title: title, action: #selector(selectPetStarter(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = value
      starterMenu.addItem(item)
      petStarterMenuItems.append(item)
    }
    starterRoot.submenu = starterMenu
    menu.addItem(starterRoot)

    let stageRoot = NSMenuItem(title: "进化形态", action: nil, keyEquivalent: "")
    let stageMenu = NSMenu(title: "进化形态")
    for (title, value) in [("初始体", "seed"), ("成长体", "young"), ("共鸣体", "resonance")] {
      let item = NSMenuItem(title: title, action: #selector(selectPetStage(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = value
      stageMenu.addItem(item)
      petStageMenuItems.append(item)
    }
    stageRoot.submenu = stageMenu
    menu.addItem(stageRoot)

    let actionRoot = NSMenuItem(title: "互动动作", action: nil, keyEquivalent: "")
    let actionMenu = NSMenu(title: "互动动作")
    for (title, value) in [("招手", "wave"), ("点头", "nod"), ("靠近", "affection"), ("行走", "walk"), ("奔跑", "run"), ("待机", "idle")] {
      let item = NSMenuItem(title: title, action: #selector(playPetAction(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = value
      actionMenu.addItem(item)
    }
    actionRoot.submenu = actionMenu
    menu.addItem(actionRoot)

    petClickThroughMenuItem = NSMenuItem(title: "鼠标穿透", action: #selector(togglePetClickThrough), keyEquivalent: "")
    petClickThroughMenuItem.target = self
    menu.addItem(petClickThroughMenuItem)

    let resetPetPosition = NSMenuItem(title: "重置宠物位置", action: #selector(resetPetPosition), keyEquivalent: "")
    resetPetPosition.target = self
    menu.addItem(resetPetPosition)

    let resetPetSize = NSMenuItem(title: "恢复默认大小", action: #selector(resetPetSize), keyEquivalent: "")
    resetPetSize.target = self
    menu.addItem(resetPetSize)

    menu.addItem(.separator())

    pairMenuItem = NSMenuItem(title: "配对电脑...", action: #selector(showPairingWindow), keyEquivalent: "p")
    pairMenuItem.target = self
    menu.addItem(pairMenuItem)

    pauseMenuItem = NSMenuItem(title: "暂停连接", action: #selector(togglePaused), keyEquivalent: "")
    pauseMenuItem.target = self
    pauseMenuItem.isEnabled = false
    menu.addItem(pauseMenuItem)

    removeMenuItem = NSMenuItem(title: "移除本机配对", action: #selector(removePairing), keyEquivalent: "")
    removeMenuItem.target = self
    removeMenuItem.isEnabled = false
    menu.addItem(removeMenuItem)

    menu.addItem(.separator())
    let quit = NSMenuItem(title: "退出 NEXORA Bridge", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    menu.addItem(quit)
    statusItem.menu = menu
  }

  private func start(_ configuration: BridgeConfiguration) {
    self.configuration = configuration
    paused = false
    pairMenuItem.title = "重新配对..."
    pauseMenuItem.title = "暂停连接"
    pauseMenuItem.isEnabled = true
    removeMenuItem.isEnabled = true
    updateStatus("正在连接", online: false)
    poller.start(configuration: configuration) { [weak self] text, online in
      self?.updateStatus(text, online: online)
    }
  }

  private func updateStatus(_ text: String, online: Bool) {
    statusMenuItem.title = text
    statusItem.button?.image = NSImage(
      systemSymbolName: online ? "link.circle.fill" : "link.circle",
      accessibilityDescription: text
    )
    statusItem.button?.image?.isTemplate = true
    statusItem.button?.toolTip = "NEXORA Bridge · \(text)"
  }

  @objc private func openProductPage() {
    guard let url = URL(string: productSite + "/soulmate/") else { return }
    NSWorkspace.shared.open(url)
  }

  @objc private func toggleDesktopPet() {
    desktopPet.toggleVisibility()
    refreshPetMenu()
  }

  @objc private func togglePetClickThrough() {
    desktopPet.setClickThrough(!desktopPet.isClickThrough)
    refreshPetMenu()
  }

  @objc private func selectPetStarter(_ sender: NSMenuItem) {
    guard let value = sender.representedObject as? String else { return }
    desktopPet.setStarter(value)
    refreshPetMenu()
  }

  @objc private func selectPetStage(_ sender: NSMenuItem) {
    guard let value = sender.representedObject as? String else { return }
    desktopPet.setStage(value)
    refreshPetMenu()
  }

  @objc private func playPetAction(_ sender: NSMenuItem) {
    guard let value = sender.representedObject as? String else { return }
    desktopPet.play(value)
    refreshPetMenu()
  }

  @objc private func resetPetPosition() {
    desktopPet.resetPosition()
    refreshPetMenu()
  }

  @objc private func resetPetSize() {
    desktopPet.resetSize()
    refreshPetMenu()
  }

  private func refreshPetMenu() {
    petVisibilityMenuItem.state = desktopPet.isVisible ? .on : .off
    petClickThroughMenuItem.state = desktopPet.isClickThrough ? .on : .off
    for item in petStarterMenuItems {
      item.state = item.representedObject as? String == desktopPet.starter ? .on : .off
    }
    for item in petStageMenuItems {
      item.state = item.representedObject as? String == desktopPet.stage ? .on : .off
    }
  }

  @objc private func showPairingWindow() {
    NSApp.activate(ignoringOtherApps: true)
    let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 430, height: 26))
    field.placeholderString = "NXC1..."

    let alert = NSAlert()
    alert.alertStyle = .informational
    alert.messageText = "配对 NEXORA CORE"
    alert.informativeText = "在伙伴页打开“设备 → 电脑助手 → 配对电脑”，复制配对码后粘贴到这里。配对码只会保存在这台 Mac 的钥匙串。"
    alert.accessoryView = field
    alert.addButton(withTitle: "配对")
    alert.addButton(withTitle: "取消")
    alert.window.initialFirstResponder = field

    guard alert.runModal() == .alertFirstButtonReturn else { return }
    guard let configuration = PairingCode.parse(field.stringValue) else {
      showError("配对码无效", detail: "请重新从 NEXORA CORE 伙伴页复制完整配对码。")
      return
    }
    do {
      try KeychainStore.save(configuration)
      start(configuration)
    } catch {
      showError("无法保存配对", detail: "系统钥匙串没有接受这条凭据。")
    }
  }

  @objc private func togglePaused() {
    guard let configuration else { return }
    paused.toggle()
    if paused {
      poller.stop()
      pauseMenuItem.title = "恢复连接"
      updateStatus("已暂停", online: false)
    } else {
      pauseMenuItem.title = "暂停连接"
      start(configuration)
    }
  }

  @objc private func removePairing() {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "移除这台 Mac 的配对？"
    alert.informativeText = "本机将停止领取电脑控制指令。之后需要重新输入配对码才能连接。"
    alert.addButton(withTitle: "移除")
    alert.addButton(withTitle: "取消")
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    do {
      try KeychainStore.delete()
      poller.stop()
      configuration = nil
      pairMenuItem.title = "配对电脑..."
      pauseMenuItem.isEnabled = false
      removeMenuItem.isEnabled = false
      updateStatus("尚未配对", online: false)
    } catch {
      showError("无法移除配对", detail: "请检查系统钥匙串权限后重试。")
    }
  }

  private func showError(_ title: String, detail: String) {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = title
    alert.informativeText = detail
    alert.addButton(withTitle: "知道了")
    alert.runModal()
  }
}

private enum SelfTest {
  static func run() throws {
    let secret = Data(repeating: 7, count: 32).base64URL
    let agentId = "038641cf-d9ff-491a-a199-bd9f0a07a48c"
    let vaultId = "q58whe6p3uNgkG7FBi70Ww"
    guard let configuration = PairingCode.parse("NXC1.\(agentId).\(vaultId).\(secret)") else {
      throw TestError.failed("pairing parser")
    }
    let command = DeviceCommand(
      version: 1,
      target: "computer",
      action: "app.open",
      parameters: CommandParameters(level: nil, delta: nil, app: "calculator", room: nil, degrees: nil),
      label: "正在打开计算器"
    )
    let plaintext = try JSONEncoder().encode(command)
    let nonce = try AES.GCM.Nonce(data: Data(repeating: 3, count: 12))
    let sealed = try AES.GCM.seal(
      plaintext,
      using: CommandCrypto.key(for: configuration.credential),
      nonce: nonce,
      authenticating: CommandCrypto.additionalData(agentId: agentId, vaultId: vaultId)
    )
    var nonceData = Data()
    nonce.withUnsafeBytes { nonceData.append(contentsOf: $0) }
    let envelope = CloudCommand(
      commandId: "0c51d146-3c73-4dc5-874b-c3035d07a9f0",
      version: 1,
      agentId: agentId,
      vaultId: vaultId,
      keyVersion: 1,
      expiresInSeconds: 120,
      createdAt: "2026-08-02T00:00:00Z",
      expiresAt: "2026-08-02T00:02:00Z",
      deliveredAt: "2026-08-02T00:00:01Z",
      payload: CommandPayload(
        algorithm: "A256GCM",
        iv: nonceData.base64URL,
        ciphertext: (sealed.ciphertext + sealed.tag).base64URL
      )
    )
    let decrypted = try CommandCrypto.decrypt(envelope, credential: configuration.credential)
    guard decrypted.action == "app.open", decrypted.parameters.app == "calculator" else {
      throw TestError.failed("encrypted command round trip")
    }
    let unsafe = DeviceCommand(
      version: 1,
      target: "computer",
      action: "shell.execute",
      parameters: CommandParameters(level: nil, delta: nil, app: nil, room: nil, degrees: nil),
      label: "unsafe"
    )
    guard !unsafe.isAllowed else { throw TestError.failed("command allowlist") }
    print("NEXORA Bridge self-test passed")
  }

  static func runDesktopPet() throws {
    NSApplication.shared.setActivationPolicy(.accessory)
    let suiteName = "com.nexora.core.bridge.self-test.\(ProcessInfo.processInfo.processIdentifier)"
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      throw TestError.failed("desktop pet test preferences")
    }
    defaults.removePersistentDomain(forName: suiteName)
    let controller = DesktopPetController(defaults: defaults)
    controller.start()
    defer {
      controller.stop()
      defaults.removePersistentDomain(forName: suiteName)
    }

    let loadDeadline = Date().addingTimeInterval(20)
    while !controller.modelReady && controller.modelError == nil && Date() < loadDeadline {
      _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    guard controller.modelReady, controller.modelError == nil else {
      throw TestError.failed("desktop pet model load")
    }

    let initialSize = controller.currentSize
    controller.resizeForSelfTest(by: 1.1)
    guard controller.currentSize.width > initialSize.width,
          controller.currentSize.height > initialSize.height else {
      throw TestError.failed("desktop pet mouse resize")
    }

    var runtimePassed: Bool?
    controller.inspectRuntime { runtimePassed = $0 }
    let inspectDeadline = Date().addingTimeInterval(5)
    while runtimePassed == nil && Date() < inspectDeadline {
      _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    guard runtimePassed == true else {
      throw TestError.failed("desktop pet transparency or WebGL pixels")
    }
    print("NEXORA desktop pet native self-test passed")
  }

  private enum TestError: Error {
    case failed(String)
  }
}

if CommandLine.arguments.contains("--self-test-pet") {
  do {
    try SelfTest.runDesktopPet()
    exit(EXIT_SUCCESS)
  } catch {
    fputs("NEXORA desktop pet native self-test failed: \(error)\n", stderr)
    exit(EXIT_FAILURE)
  }
}

if CommandLine.arguments.contains("--self-test") {
  do {
    try SelfTest.run()
    exit(EXIT_SUCCESS)
  } catch {
    fputs("NEXORA Bridge self-test failed\n", stderr)
    exit(EXIT_FAILURE)
  }
}

private let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.run()
