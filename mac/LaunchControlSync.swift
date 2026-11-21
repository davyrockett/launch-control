// Launch Control Sync: keeps the Launch Control page in step with Apple Reminders on David's Mac.
//
// What it does, while the Mac is on (started at login by launchd, see install.command):
//  - Reads every reminder that isn't done yet, and saves the list to tasks.json in the private
//    davyrockett/launch-control-data repo. It does this as soon as Reminders changes (any device, through iCloud),
//    and checks again every 10 minutes.
//  - Every minute it looks at done.json in the same repo. When "Done" is tapped on the page, the page adds the
//    reminder there; this program ticks it off in Reminders and clears it from done.json.
//
// GitHub access comes from the gh command-line tool, signed in as davyrockett. Reminders access is asked for the first
// time it runs (System Settings > Privacy & Security > Reminders > Launch Control Sync).
//
// Test commands:  "Launch Control Sync" export     prints what it would save
//                 "Launch Control Sync" once       saves tasks.json and handles done.json once, then quits
import EventKit
import Foundation

let REPO = "davyrockett/launch-control-data"
let GH = ["/Users/davidnorgren/.local/bin/gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
let SUPPORT = FileManager.default.homeDirectoryForCurrentUser
  .appendingPathComponent("Library/Application Support/Launch Control Sync")
let HEARTBEAT: TimeInterval = 3 * 3600   // save "still checking" at least this often, so the page can tell the Mac is on

func log(_ s: String) {
  let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"
  print("\(f.string(from: Date())) \(s)"); fflush(stdout)
}

// ---------- Reminders ----------
let store = EKEventStore()

func requestAccess() -> Bool {
  let sem = DispatchSemaphore(value: 0)
  var ok = false
  if #available(macOS 14.0, *) {
    store.requestFullAccessToReminders { granted, err in
      ok = granted; if let err { log("Reminders access error: \(err.localizedDescription)") }; sem.signal()
    }
  } else {
    store.requestAccess(to: .reminder) { granted, _ in ok = granted; sem.signal() }
  }
  sem.wait()
  return ok
}

func incomplete() -> [EKReminder] {
  let sem = DispatchSemaphore(value: 0)
  var out: [EKReminder] = []
  let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
  store.fetchReminders(matching: pred) { r in out = r ?? []; sem.signal() }
  sem.wait()
  return out
}

func hex(_ c: CGColor?) -> String? {
  guard let c, let rgb = c.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
        let p = rgb.components, p.count >= 3 else { return nil }
  return String(format: "#%02x%02x%02x", Int(p[0] * 255), Int(p[1] * 255), Int(p[2] * 255))
}

// The tasks part of tasks.json, as text that only changes when the reminders do.
func snapshot() -> (json: String, count: Int) {
  let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd'T'HH:mm"
  var tasks: [[String: Any]] = []
  var lists: [String: String] = [:]
  for r in incomplete() {
    let list = r.calendar?.title ?? "Reminders"
    if lists[list] == nil, let h = hex(r.calendar?.cgColor) { lists[list] = h }
    var t: [String: Any] = ["id": r.calendarItemIdentifier, "list": list, "name": r.title ?? "(no title)"]
    if let dc = r.dueDateComponents {
      var c = dc; if c.calendar == nil { c.calendar = Calendar.current }
      if let d = c.date ?? Calendar.current.date(from: c) {
        t["due"] = f.string(from: d)
        t["allDay"] = dc.hour == nil || (dc.hour == 0 && (dc.minute ?? 0) == 0)
      }
    }
    if r.priority > 0 { t["priority"] = r.priority }   // 1 = high, 5 = medium, 9 = low
    if r.hasRecurrenceRules { t["repeats"] = true }
    tasks.append(t)
  }
  tasks.sort { a, b in
    let ka = "\(a["list"]!)\u{1}\(a["name"]!)\u{1}\(a["id"]!)", kb = "\(b["list"]!)\u{1}\(b["name"]!)\u{1}\(b["id"]!)"
    return ka < kb
  }
  let data = try! JSONSerialization.data(withJSONObject: ["tasks": tasks, "lists": lists], options: [.sortedKeys])
  return (String(data: data, encoding: .utf8)!, tasks.count)
}

func complete(_ id: String) -> String {
  guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return "not found" }
  if r.isCompleted { return "already done" }
  r.isCompleted = true   // a repeating reminder moves on to its next date, as it does in the Reminders app
  do { try store.save(r, commit: true); return "done" } catch { return "error: \(error.localizedDescription)" }
}

// ---------- GitHub ----------
var token = ""
func loadToken() -> Bool {
  for path in GH where FileManager.default.isExecutableFile(atPath: path) {
    let p = Process(); p.executableURL = URL(fileURLWithPath: path)
    p.arguments = ["auth", "token", "--user", "davyrockett"]
    let pipe = Pipe(); p.standardOutput = pipe; p.standardError = Pipe()
    do { try p.run() } catch { continue }
    p.waitUntilExit()
    let t = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if p.terminationStatus == 0 && !t.isEmpty { token = t; return true }
  }
  log("Couldn't get a GitHub key from gh (is it signed in as davyrockett?)")
  return false
}

struct Res { var status: Int; var body: Data; var etag: String? }
func api(_ method: String, _ path: String, body: [String: Any]? = nil, etag: String? = nil) -> Res {
  var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(REPO)/\(path)")!)
  req.httpMethod = method
  req.timeoutInterval = 30
  req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
  req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
  req.setValue("launch-control-sync", forHTTPHeaderField: "User-Agent")
  req.cachePolicy = .reloadIgnoringLocalCacheData
  if let etag { req.setValue(etag, forHTTPHeaderField: "If-None-Match") }
  if let body { req.httpBody = try? JSONSerialization.data(withJSONObject: body) }
  let sem = DispatchSemaphore(value: 0)
  var out = Res(status: 0, body: Data(), etag: nil)
  URLSession.shared.dataTask(with: req) { d, r, _ in
    if let h = r as? HTTPURLResponse { out = Res(status: h.statusCode, body: d ?? Data(), etag: h.value(forHTTPHeaderField: "ETag")) }
    sem.signal()
  }.resume()
  sem.wait()
  if out.status == 401 && loadToken() && etag == nil { return api(method, path, body: body) }
  return out
}

// Reads a file from the data repo: (its text, its sha), or nil if it isn't there yet.
func readFile(_ name: String) -> (text: String, sha: String)? {
  let r = api("GET", "contents/\(name)")
  guard r.status == 200, let o = try? JSONSerialization.jsonObject(with: r.body) as? [String: Any],
        let b64 = o["content"] as? String, let sha = o["sha"] as? String,
        let d = Data(base64Encoded: b64.replacingOccurrences(of: "\n", with: "")) else { return nil }
  return (String(data: d, encoding: .utf8) ?? "", sha)
}

func writeFile(_ name: String, _ text: String, _ message: String, sha: String?) -> Int {
  var body: [String: Any] = ["message": message, "content": Data(text.utf8).base64EncodedString()]
  if let sha { body["sha"] = sha }
  return api("PUT", "contents/\(name)", body: body).status
}

// ---------- the two jobs ----------
var lastSaved = ""        // the tasks part last saved to GitHub
var lastSavedAt: Date = .distantPast

func saveTasks(force: Bool = false) {
  let snap = snapshot()
  let stale = Date().timeIntervalSince(lastSavedAt) > HEARTBEAT
  if snap.json == lastSaved && !force && !stale { return }
  let now = Int(Date().timeIntervalSince1970 * 1000)
  for _ in 0..<3 {
    let cur = readFile("tasks.json")
    var changedAt = now
    // Keep "updated" (when the reminders last changed) apart from "checked" (when the Mac last looked).
    if let cur, let o = try? JSONSerialization.jsonObject(with: Data(cur.text.utf8)) as? [String: Any],
       let tasks = o["tasks"], let lists = o["lists"],
       let d = try? JSONSerialization.data(withJSONObject: ["tasks": tasks, "lists": lists], options: [.sortedKeys]),
       String(data: d, encoding: .utf8) == snap.json, let u = o["updated"] as? Int { changedAt = u }
    let inner = snap.json.dropFirst().dropLast()   // {"lists":…,"tasks":…} without its braces
    let text = "{\"checked\":\(now),\"updated\":\(changedAt),\(inner)}\n"
    let msg = changedAt == now ? "Reminders: \(snap.count) to do" : "Still checking"
    let s = writeFile("tasks.json", text, msg, sha: cur?.sha)
    if s == 200 || s == 201 {
      lastSaved = snap.json; lastSavedAt = Date()
      if changedAt == now { log("Saved \(snap.count) reminders") }
      return
    }
    if s != 409 && s != 422 { log("Couldn't save tasks.json (GitHub said \(s))"); return }
  }
}

var doneEtag: String? = nil
func handleDone() {
  let probe = api("GET", "contents/done.json", etag: doneEtag)
  if probe.status == 304 { return }   // nothing new (and free: doesn't count against GitHub's limit)
  if probe.status == 404 { return }
  guard probe.status == 200 else { log("Couldn't read done.json (GitHub said \(probe.status))"); return }
  doneEtag = probe.etag
  for _ in 0..<3 {
    guard let cur = readFile("done.json"),
          let o = try? JSONSerialization.jsonObject(with: Data(cur.text.utf8)) as? [String: Any] else { return }
    let reqs = o["requests"] as? [[String: Any]] ?? []
    if reqs.isEmpty { return }
    var log2 = o["log"] as? [[String: Any]] ?? []
    for r in reqs {
      guard let id = r["id"] as? String else { continue }
      let result = complete(id)
      log("Done: \(r["name"] as? String ?? id) -> \(result)")
      var entry = r; entry["result"] = result; entry["handled"] = Int(Date().timeIntervalSince1970 * 1000)
      log2.insert(entry, at: 0)
    }
    let out: [String: Any] = ["requests": [], "log": Array(log2.prefix(30))]
    let d = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
    let s = writeFile("done.json", String(data: d, encoding: .utf8)! + "\n", "Ticked off \(reqs.count) in Reminders", sha: cur.sha)
    if s == 200 || s == 201 { doneEtag = nil; saveTasks(force: true); return }
    if s != 409 && s != 422 { log("Couldn't clear done.json (GitHub said \(s))"); return }
    // Someone tapped Done again meanwhile: read it again. Ticking the same reminder twice is harmless.
  }
}

// ---------- start ----------
let args = CommandLine.arguments.dropFirst()
try? FileManager.default.createDirectory(at: SUPPORT, withIntermediateDirectories: true)

guard requestAccess() else {
  log("No access to Reminders. Turn it on in System Settings > Privacy & Security > Reminders > Launch Control Sync.")
  sleep(args.isEmpty ? 600 : 0)   // launchd starts it again afterwards; this stops it from trying every few seconds
  exit(1)
}

if args.first == "export" { print(snapshot().json); exit(0) }
if args.first == "complete", let id = args.dropFirst().first { print(complete(id)); exit(0) }

guard loadToken() else { sleep(args.isEmpty ? 600 : 0); exit(1) }

if args.first == "once" { handleDone(); saveTasks(force: true); exit(0) }

log("Started")
let work = DispatchQueue(label: "work")
work.async { handleDone(); saveTasks() }

// Reminders changed (here or on another device): save soon, once things settle.
var pending: DispatchWorkItem?
NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: nil) { _ in
  pending?.cancel()
  let item = DispatchWorkItem { saveTasks() }
  pending = item
  work.asyncAfter(deadline: .now() + 3, execute: item)
}
var ticks = 0
let timer = DispatchSource.makeTimerSource(queue: work)
timer.schedule(deadline: .now() + 60, repeating: 60)
timer.setEventHandler {
  ticks += 1
  handleDone()
  if ticks % 10 == 0 { saveTasks() }   // in case a change notice was missed
}
timer.resume()
RunLoop.main.run()
