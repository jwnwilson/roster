import AVFoundation
import Foundation
import Speech

// A small stdio protocol keeps microphone audio in this native process.
final class Dictation: NSObject {
  private let engine = AVAudioEngine()
  private let recognizer = SFSpeechRecognizer()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var completed = false

  func start() {
    SFSpeechRecognizer.requestAuthorization { status in
      guard status == .authorized else { self.finish(error: "Speech Recognition permission was not granted."); return }
      guard let recognizer = self.recognizer, recognizer.isAvailable else { self.finish(error: "Speech Recognition is unavailable."); return }
      guard recognizer.supportsOnDeviceRecognition else { self.finish(error: "On-device dictation is unavailable for this language."); return }
      self.begin(recognizer)
    }
  }

  private func begin(_ recognizer: SFSpeechRecognizer) {
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    self.request = request
    let node = engine.inputNode
    node.installTap(onBus: 0, bufferSize: 1024, format: node.outputFormat(forBus: 0)) { buffer, _ in request.append(buffer) }
    task = recognizer.recognitionTask(with: request) { result, error in
      if let error = error { self.finish(error: error.localizedDescription); return }
      if let result = result, result.isFinal { self.finish(text: result.bestTranscription.formattedString) }
    }
    do { engine.prepare(); try engine.start() }
    catch { finish(error: "Roster could not start microphone capture: \(error.localizedDescription)") }
  }

  func stop() { engine.stop(); engine.inputNode.removeTap(onBus: 0); request?.endAudio() }

  private func finish(text: String? = nil, error: String? = nil) {
    guard !completed else { return }
    completed = true
    let value: [String: String] = error.map { ["type": "error", "message": $0] } ?? ["type": "result", "text": text ?? ""]
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(0)
  }
}

let dictation = Dictation()
// Speech authorization and AVFoundation callbacks require a live main run
// loop. Read stdin on a background queue and dispatch commands back to main.
DispatchQueue.global().async {
  while let line = readLine() {
    if line.contains("start") { DispatchQueue.main.async { dictation.start() } }
    if line.contains("stop") { DispatchQueue.main.async { dictation.stop() } }
  }
}
dispatchMain()
