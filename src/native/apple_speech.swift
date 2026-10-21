// Apple on-device speech-to-text helper (SpeechAnalyzer + SpeechTranscriber,
// macOS 26+). Spawned by src/main/apple-speech.js.
//
// Usage:
//   apple-speech languages                         → {"languages":["en","fr",…]}
//   apple-speech status     --lang <code>          → {"supported","installed","locale"}
//   apple-speech install    --lang <code>          → {"installed":true,"locale"}
//   apple-speech transcribe --lang <code> <file>   → {"text","locale"}
//   apple-speech stream     --lang <code>          → JSON lines (see below)
//
// `stream` reads raw 16kHz mono signed 16-bit little-endian PCM from stdin
// for as long as stdin stays open, transcribing as audio arrives. It prints
// {"ready":true} once the model is loaded, {"partial":"…"} whenever the
// running transcript changes, and a final {"text","locale"} after stdin
// closes and the remaining audio is finalized.
//
// <code> is the app's language setting ("auto", "en", "fr", …). The regional
// model is chosen automatically from the user's own Mac settings (System
// Settings → General → Language & Region), in this order:
//   1. the language in the Mac's region      (English on an Australian Mac → en-AU)
//   2. the user's own variant of the language (French listed as fr-FR → fr-FR)
//   3. the language's home region            (fr → fr-FR, pt → pt-BR)
//   4. Apple's closest match
// Steps 1–3 need an exact language+region model, so an Australian Mac set to
// French gets fr-FR rather than an arbitrary near match like fr-CA.
//
// Other commands print exactly one JSON object on stdout. Failures print
// {"error": "..."} and exit non-zero.

import AVFoundation
import Foundation
import Speech

struct HelperError: Error, CustomStringConvertible {
  let description: String
}

/// Write one JSON line. A single write() per line keeps lines intact when
/// the results task and the main task both emit.
func emit(_ object: [String: Any]) {
  var data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
  data.append(0x0A)
  FileHandle.standardOutput.write(data)
}

func trimmed(_ text: AttributedString) -> String {
  String(text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Map the app's language code to a locale SpeechTranscriber supports,
/// choosing the regional variant from the user's Mac settings.
func resolveLocale(_ lang: String) async throws -> Locale {
  let system = Locale.current
  let code = lang == "auto" ? (system.language.languageCode?.identifier ?? "en") : lang

  // Regions to try, most personal first, without repeats.
  var regions: [String] = []
  func addRegion(_ region: String?) {
    if let region, !regions.contains(region) { regions.append(region) }
  }
  addRegion(system.region?.identifier)
  for preferred in Locale.preferredLanguages {
    let language = Locale.Language(identifier: preferred)
    if language.languageCode?.identifier == code {
      addRegion(language.region?.identifier)
    }
  }
  addRegion(Locale.Language(identifier: Locale.Language(identifier: code).maximalIdentifier)
    .region?.identifier)

  // Exact language+region models only, so a missing pair falls through to
  // the next region instead of Apple's arbitrary nearest match.
  let supported = await SpeechTranscriber.supportedLocales
  for region in regions {
    if let match = supported.first(where: {
      $0.language.languageCode?.identifier == code && $0.region?.identifier == region
    }) {
      return match
    }
  }

  if let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: code)),
    locale.language.languageCode?.identifier == code
  {
    return locale
  }
  throw HelperError(description: "Language \(code) is not supported by Apple speech")
}

func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
  SpeechTranscriber(locale: locale, preset: .transcription)
}

func isInstalled(_ locale: Locale) async -> Bool {
  let installed = await SpeechTranscriber.installedLocales
  let id = locale.identifier(.bcp47)
  return installed.contains { $0.identifier(.bcp47) == id }
}

/// Download the locale's model if the system doesn't have it yet.
func ensureInstalled(_ transcriber: SpeechTranscriber) async throws {
  if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
    try await request.downloadAndInstall()
  }
}

func transcribe(file path: String, locale: Locale) async throws -> String {
  let transcriber = makeTranscriber(locale)
  try await ensureInstalled(transcriber)

  let audioFile = try AVAudioFile(forReading: URL(fileURLWithPath: path))
  let analyzer = SpeechAnalyzer(modules: [transcriber])

  // Collect finalized results concurrently with feeding the file in.
  async let segments: [String] = transcriber.results.reduce(into: []) { acc, result in
    let piece = trimmed(result.text)
    if !piece.isEmpty { acc.append(piece) }
  }

  if let end = try await analyzer.analyzeSequence(from: audioFile) {
    try await analyzer.finalizeAndFinish(through: end)
  } else {
    await analyzer.cancelAndFinishNow()
  }

  return try await segments.joined(separator: " ")
}

/// Convert raw PCM16 bytes into an analyzer-ready buffer.
final class PCMConverter {
  let inputFormat: AVAudioFormat
  let outputFormat: AVAudioFormat
  private let converter: AVAudioConverter?

  init(outputFormat: AVAudioFormat) throws {
    guard
      let input = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)
    else { throw HelperError(description: "Could not create the input audio format") }
    inputFormat = input
    self.outputFormat = outputFormat
    if input == outputFormat {
      converter = nil
    } else {
      guard let conv = AVAudioConverter(from: input, to: outputFormat) else {
        throw HelperError(description: "Could not create an audio converter")
      }
      converter = conv
    }
  }

  func convert(_ bytes: Data) throws -> AVAudioPCMBuffer? {
    let frames = AVAudioFrameCount(bytes.count / 2)
    guard frames > 0,
      let input = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: frames),
      let dest = input.int16ChannelData?[0]
    else { return nil }
    _ = bytes.withUnsafeBytes { raw in
      raw.copyBytes(to: UnsafeMutableRawBufferPointer(start: dest, count: Int(frames) * 2))
    }
    input.frameLength = frames
    guard let converter else { return input }

    let ratio = outputFormat.sampleRate / inputFormat.sampleRate
    let capacity = AVAudioFrameCount(Double(frames) * ratio) + 64
    guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
      return nil
    }
    var supplied = false
    var conversionError: NSError?
    let status = converter.convert(to: output, error: &conversionError) { _, outStatus in
      if supplied {
        outStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      outStatus.pointee = .haveData
      return input
    }
    if status == .error {
      throw conversionError ?? HelperError(description: "Audio conversion failed")
    }
    return output.frameLength > 0 ? output : nil
  }
}

/// Read stdin until EOF on a background thread, handing over whole samples.
func readStdin(_ onChunk: @escaping (Data) -> Void) async {
  await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
    Thread {
      var pending = Data()
      while true {
        let data = FileHandle.standardInput.availableData
        if data.isEmpty { break }  // EOF: the app closed stdin
        pending.append(data)
        let usable = pending.count - (pending.count % 2)
        if usable > 0 {
          onChunk(pending.prefix(usable))
          pending.removeFirst(usable)
        }
      }
      done.resume()
    }.start()
  }
}

/// Live transcription of PCM streamed over stdin.
func streamTranscribe(locale: Locale) async throws -> String {
  let transcriber = SpeechTranscriber(
    locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults],
    attributeOptions: [])
  try await ensureInstalled(transcriber)

  guard
    let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
      compatibleWith: [transcriber])
  else { throw HelperError(description: "No compatible audio format for Apple speech") }
  let converter = try PCMConverter(outputFormat: analyzerFormat)

  let analyzer = SpeechAnalyzer(modules: [transcriber])
  try await analyzer.prepareToAnalyze(in: analyzerFormat)

  // Running transcript: finalized segments plus the current volatile guess.
  let collector = Task { () throws -> String in
    var finalized: [String] = []
    var lastSent = ""
    for try await result in transcriber.results {
      let piece = trimmed(result.text)
      var shown = finalized
      if result.isFinal {
        if !piece.isEmpty { finalized.append(piece) }
        shown = finalized
      } else if !piece.isEmpty {
        shown.append(piece)
      }
      let display = shown.joined(separator: " ")
      if display != lastSent {
        lastSent = display
        emit(["partial": display])
      }
    }
    return finalized.joined(separator: " ")
  }

  let (inputs, continuation) = AsyncStream<AnalyzerInput>.makeStream()
  try await analyzer.start(inputSequence: inputs)
  emit(["ready": true])

  var conversionFailure: Error?
  await readStdin { bytes in
    do {
      if let buffer = try converter.convert(bytes) {
        continuation.yield(AnalyzerInput(buffer: buffer))
      }
    } catch {
      conversionFailure = error
    }
  }
  continuation.finish()
  if let conversionFailure { throw conversionFailure }

  try await analyzer.finalizeAndFinishThroughEndOfInput()
  return try await collector.value
}

func supportedLanguages() async -> [String] {
  let codes = await SpeechTranscriber.supportedLocales.compactMap {
    $0.language.languageCode?.identifier
  }
  return Array(Set(codes)).sorted()
}

func parseArgs(_ args: [String]) -> (command: String, lang: String, file: String?) {
  var command = ""
  var lang = "auto"
  var file: String?
  var i = 0
  while i < args.count {
    let arg = args[i]
    if arg == "--lang", i + 1 < args.count {
      lang = args[i + 1]
      i += 2
      continue
    }
    if command.isEmpty {
      command = arg
    } else if file == nil {
      file = arg
    }
    i += 1
  }
  return (command, lang, file)
}

@main
struct AppleSpeech {
  static func main() async {
    let (command, lang, file) = parseArgs(Array(CommandLine.arguments.dropFirst()))
    do {
      guard SpeechTranscriber.isAvailable else {
        throw HelperError(description: "Apple speech is not available on this Mac")
      }
      if command == "languages" {
        emit(["languages": await supportedLanguages()])
        exit(0)
      }
      let locale = try await resolveLocale(lang)
      let localeId = locale.identifier(.bcp47)

      switch command {
      case "status":
        emit([
          "supported": true,
          "installed": await isInstalled(locale),
          "locale": localeId,
        ])
      case "install":
        try await ensureInstalled(makeTranscriber(locale))
        emit(["installed": true, "locale": localeId])
      case "transcribe":
        guard let file else {
          throw HelperError(description: "transcribe needs a WAV file path")
        }
        let text = try await transcribe(file: file, locale: locale)
        emit(["text": text, "locale": localeId])
      case "stream":
        let text = try await streamTranscribe(locale: locale)
        emit(["text": text, "locale": localeId])
      default:
        throw HelperError(description: "Unknown command \"\(command)\"")
      }
      exit(0)
    } catch {
      emit(["error": String(describing: error)])
      exit(1)
    }
  }
}
