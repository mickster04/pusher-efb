// Pusher files module: a second, small MSFS 2024 standalone WASM module, kept apart from the taxi module (which is proven and should not be put at
// risk by file experiments). It has no SimConnect: only the CommBus and plain C file calls.
//
// UNVERIFIED in the sim. Compile with the same flags as the taxi module (wasm/build.sh builds both).
//
// Events (JS to module, then the answer on "PusherFilesResponse"):
//   "PusherFilesPing"  {"id":1}   -> {"id":1,"kind":"pong","version":"0.1.0"}
//   "PusherFilesProbe" {"id":2}   -> {"id":2,"kind":"fsprobe","version":...,"tries":[{path,op,ok,detail}],"dirs":[{path,ok,names,detail}]}
//   "PusherFilesList"  {"id":3}   -> one {"id":3,"kind":"file","name":"x.json","text":"..."} per *.json file in the work folder, then {"id":3,"kind":"end","count":n}
//   "PusherFilesSave"  {"id":4,"name":"x.json","text":"..."} -> {"id":4,"kind":"saved","name":"x.json","ok":true,"detail":""}
//   "PusherFilesDelete" {"id":5,"name":"x.json"}              -> {"id":5,"kind":"deleted","name":"x.json","ok":true,"detail":""}
// The files are the user's saved themes. The probe (above) found out that a module can read, write and list its work folder and nothing inside the package.
// The probe finds out what a module can do with files in this sim: write and read back under \\work\\, list directories, and whether anything inside the
// installed package can be read or written. The answer decides how themes can be saved as real files.
#include <MSFS/MSFS.h>
#include <MSFS/MSFS_CommBus.h>
#include <MSFS/MSFS_WindowsTypes.h>

#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cctype>
#include <cstring>
#include <string>
#include <vector>

#if defined(__has_include)
#if __has_include(<dirent.h>)
#include <dirent.h>
#define PUSHER_HAVE_DIRENT 1
#endif
#endif

// The folder the files live in. In the sim modules write under \\work\\ (the probe showed both \\work\\ and /work/ work). The host test sets another one.
#ifndef PUSHER_WORK_DIR
#define PUSHER_WORK_DIR "\\work\\"
#endif

namespace {

const char* const kVersion = "0.2.0";
const char* const kWorkDir = PUSHER_WORK_DIR;
const size_t kMaxFileBytes = 16 * 1024;
const char* const kEventPing = "PusherFilesPing";
const char* const kEventProbe = "PusherFilesProbe";
const char* const kEventList = "PusherFilesList";
const char* const kEventSave = "PusherFilesSave";
const char* const kEventDelete = "PusherFilesDelete";
const char* const kEventResponse = "PusherFilesResponse";

void send(const std::string& json) {
  fsCommBusCall(kEventResponse, json.c_str(), static_cast<unsigned int>(json.size()), FsCommBusBroadcast_JS);
}

// The number after "id": in a small JSON request (0 if there is none).
uint32_t parseId(const char* json, unsigned int size) {
  std::string s(json ? json : "", json ? size : 0);
  size_t at = s.find("\"id\"");
  if (at == std::string::npos) return 0;
  at = s.find(':', at);
  if (at == std::string::npos) return 0;
  return static_cast<uint32_t>(std::strtoul(s.c_str() + at + 1, nullptr, 10));
}

// ---- file access probe ----
// A one-off experiment to find out what a module can do with files in this sim: write and read back under \work\ (where modules are meant to keep
// files), list a directory, and whether anything inside the installed package can be read or written. The answer decides how themes can be saved as
// real files. The result goes back as one message: { id, kind: "fsprobe", version, tries: [{ path, op, ok, detail }], dirs: [{ path, ok, names }] }.
std::string jsonEscape(const std::string& in) {
  std::string out;
  for (size_t i = 0; i < in.size(); ++i) {
    unsigned char c = static_cast<unsigned char>(in[i]);
    if (c == '\\' || c == '"') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 0x20) { out += '?'; }
    else out += static_cast<char>(c);
  }
  return out;
}

std::string errnoText() {
  const char* t = std::strerror(errno);
  return std::string("errno ") + std::to_string(errno) + (t ? std::string(": ") + t : std::string());
}

void probeWrite(std::vector<std::string>* tries, const std::string& path) {
  std::string entry;
  std::FILE* f = std::fopen(path.c_str(), "wb");
  bool wrote = false;
  std::string detail;
  if (!f) detail = errnoText();
  else {
    const char* text = "pusher probe";
    wrote = std::fwrite(text, 1, std::strlen(text), f) == std::strlen(text);
    if (!wrote) detail = errnoText();
    std::fclose(f);
  }
  tries->push_back("{\"path\":\"" + jsonEscape(path) + "\",\"op\":\"write\",\"ok\":" + (wrote ? "true" : "false") + ",\"detail\":\"" + jsonEscape(detail) + "\"}");
  if (!wrote) return;
  std::FILE* r = std::fopen(path.c_str(), "rb");
  char buf[64] = {0};
  size_t got = r ? std::fread(buf, 1, sizeof(buf) - 1, r) : 0;
  if (r) std::fclose(r);
  tries->push_back("{\"path\":\"" + jsonEscape(path) + "\",\"op\":\"read back\",\"ok\":" + (got > 0 ? "true" : "false") + ",\"detail\":\"" + jsonEscape(got > 0 ? std::string(buf, got) : errnoText()) + "\"}");
}

void probeRead(std::vector<std::string>* tries, const std::string& path) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  std::string detail;
  bool ok = f != nullptr;
  if (!f) detail = errnoText();
  else {
    std::fseek(f, 0, SEEK_END);
    detail = "size " + std::to_string(static_cast<long>(std::ftell(f)));
    std::fclose(f);
  }
  tries->push_back("{\"path\":\"" + jsonEscape(path) + "\",\"op\":\"read\",\"ok\":" + (ok ? "true" : "false") + ",\"detail\":\"" + jsonEscape(detail) + "\"}");
}

void probeDir(std::vector<std::string>* dirs, const std::string& path) {
#ifdef PUSHER_HAVE_DIRENT
  DIR* d = opendir(path.c_str());
  if (!d) { dirs->push_back("{\"path\":\"" + jsonEscape(path) + "\",\"ok\":false,\"names\":[],\"detail\":\"" + jsonEscape(errnoText()) + "\"}"); return; }
  std::string names;
  int count = 0;
  while (struct dirent* e = readdir(d)) {
    if (count++ >= 40) break;
    if (!names.empty()) names += ",";
    names += "\"" + jsonEscape(e->d_name) + "\"";
  }
  closedir(d);
  dirs->push_back("{\"path\":\"" + jsonEscape(path) + "\",\"ok\":true,\"names\":[" + names + "],\"detail\":\"\"}");
#else
  dirs->push_back("{\"path\":\"" + jsonEscape(path) + "\",\"ok\":false,\"names\":[],\"detail\":\"dirent.h is not available in this build\"}");
#endif
}

void onProbe(const char* args, unsigned int size, void* /*ctx*/) {
  uint32_t id = parseId(args, size);
  std::vector<std::string> tries, dirs;
  // where modules are meant to keep files
  probeWrite(&tries, "\\work\\pusher-probe.txt");
  probeWrite(&tries, "/work/pusher-probe.txt");
  // inside the installed package: can anything be written, or even read? (guesses at the mount point)
  probeWrite(&tries, "\\pkg\\pusher-probe.txt");
  probeWrite(&tries, "\\pkg\\push-planner\\pusher-probe.txt");
  probeWrite(&tries, "\\pkg\\push-planner\\html_ui\\efb_ui\\efb_apps\\pushplanner\\themes\\pusher-probe.json");
  probeRead(&tries, "\\pkg\\layout.json");
  probeRead(&tries, "\\pkg\\push-planner\\layout.json");
  probeRead(&tries, "\\pkg\\push-planner\\html_ui\\efb_ui\\efb_apps\\pushplanner\\themes\\index.json");
  probeDir(&dirs, "\\work\\");
  probeDir(&dirs, "/work/");
  probeDir(&dirs, "\\pkg\\");
  std::string json = "{\"id\":" + std::to_string(id) + ",\"kind\":\"fsprobe\",\"version\":\"" + kVersion + "\",\"tries\":[";
  for (size_t i = 0; i < tries.size(); ++i) json += (i ? "," : "") + tries[i];
  json += "],\"dirs\":[";
  for (size_t i = 0; i < dirs.size(); ++i) json += (i ? "," : "") + dirs[i];
  json += "]}";
  send(json);
}

// ---- saved files ----
// The string value of "key" in a small JSON object (with the usual escapes; \uXXXX is kept only for plain ASCII). False if there is none.
bool extractString(const std::string& json, const char* key, std::string* out) {
  std::string pat = std::string("\"") + key + "\"";
  size_t at = json.find(pat);
  if (at == std::string::npos) return false;
  at = json.find(':', at + pat.size());
  if (at == std::string::npos) return false;
  at = json.find('"', at);
  if (at == std::string::npos) return false;
  out->clear();
  for (size_t i = at + 1; i < json.size(); ++i) {
    char c = json[i];
    if (c == '"') return true;
    if (c != '\\') { out->push_back(c); continue; }
    if (++i >= json.size()) return false;
    switch (json[i]) {
      case 'n': out->push_back('\n'); break;
      case 'r': out->push_back('\r'); break;
      case 't': out->push_back('\t'); break;
      case 'b': out->push_back('\b'); break;
      case 'f': out->push_back('\f'); break;
      case 'u': {
        if (i + 4 >= json.size()) return false;
        unsigned long cp = std::strtoul(json.substr(i + 1, 4).c_str(), nullptr, 16);
        out->push_back(cp < 0x80 ? static_cast<char>(cp) : '?');
        i += 4;
        break;
      }
      default: out->push_back(json[i]); break;   // \" \\ \/
    }
  }
  return false;
}

// Text as the inside of a JSON string, keeping line breaks.
std::string escapeText(const std::string& in) {
  std::string out;
  for (size_t i = 0; i < in.size(); ++i) {
    unsigned char c = static_cast<unsigned char>(in[i]);
    if (c == '\\' || c == '"') { out += '\\'; out += static_cast<char>(c); }
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else if (c < 0x20 || c >= 0x7F) out += '?';
    else out += static_cast<char>(c);
  }
  return out;
}

// Only plain file names the module made itself: letters, digits, '-', '_', '.', ending in .json, no path parts.
bool safeName(const std::string& n) {
  if (n.size() < 6 || n.size() > 64) return false;
  if (n.compare(n.size() - 5, 5, ".json") != 0) return false;
  if (!std::isalnum(static_cast<unsigned char>(n[0]))) return false;
  for (size_t i = 0; i < n.size(); ++i) {
    unsigned char c = static_cast<unsigned char>(n[i]);
    if (!(std::isalnum(c) || c == '-' || c == '_' || c == '.')) return false;
  }
  return n.find("..") == std::string::npos;
}

bool endsWithJson(const std::string& n) { return n.size() > 5 && n.compare(n.size() - 5, 5, ".json") == 0; }

std::string reply(uint32_t id, const char* kind, const std::string& name, bool ok, const std::string& detail) {
  return "{\"id\":" + std::to_string(id) + ",\"kind\":\"" + kind + "\",\"name\":\"" + escapeText(name) + "\",\"ok\":" + (ok ? "true" : "false") + ",\"detail\":\"" + escapeText(detail) + "\"}";
}

void onList(const char* args, unsigned int size, void* /*ctx*/) {
  uint32_t id = parseId(args, size);
  int count = 0;
#ifdef PUSHER_HAVE_DIRENT
  DIR* d = opendir(kWorkDir);
  std::vector<std::string> names;
  if (d) {
    while (struct dirent* e = readdir(d)) {
      std::string n = e->d_name;
      if (endsWithJson(n) && safeName(n)) names.push_back(n);
      if (names.size() >= 100) break;
    }
    closedir(d);
  }
  for (size_t i = 0; i < names.size(); ++i) {
    std::FILE* f = std::fopen((std::string(kWorkDir) + names[i]).c_str(), "rb");
    if (!f) continue;
    std::string text;
    char buf[1024];
    size_t got;
    while ((got = std::fread(buf, 1, sizeof(buf), f)) > 0 && text.size() <= kMaxFileBytes) text.append(buf, got);
    std::fclose(f);
    if (text.size() > kMaxFileBytes) continue;       // not one of ours
    send("{\"id\":" + std::to_string(id) + ",\"kind\":\"file\",\"name\":\"" + escapeText(names[i]) + "\",\"text\":\"" + escapeText(text) + "\"}");
    ++count;
  }
#endif
  send("{\"id\":" + std::to_string(id) + ",\"kind\":\"end\",\"count\":" + std::to_string(count) + "}");
}

void onSave(const char* args, unsigned int size, void* /*ctx*/) {
  uint32_t id = parseId(args, size);
  std::string json(args ? args : "", args ? size : 0), name, text;
  if (!extractString(json, "name", &name) || !extractString(json, "text", &text)) { send(reply(id, "saved", name, false, "the request had no name or text")); return; }
  if (!safeName(name)) { send(reply(id, "saved", name, false, "that is not a usable file name")); return; }
  if (text.size() > kMaxFileBytes) { send(reply(id, "saved", name, false, "the text is too long")); return; }
  std::FILE* f = std::fopen((std::string(kWorkDir) + name).c_str(), "wb");
  if (!f) { send(reply(id, "saved", name, false, errnoText())); return; }
  bool ok = std::fwrite(text.data(), 1, text.size(), f) == text.size();
  std::string detail = ok ? "" : errnoText();
  std::fclose(f);
  send(reply(id, "saved", name, ok, detail));
}

void onDelete(const char* args, unsigned int size, void* /*ctx*/) {
  uint32_t id = parseId(args, size);
  std::string json(args ? args : "", args ? size : 0), name;
  if (!extractString(json, "name", &name) || !safeName(name)) { send(reply(id, "deleted", name, false, "that is not a usable file name")); return; }
  bool ok = std::remove((std::string(kWorkDir) + name).c_str()) == 0;
  send(reply(id, "deleted", name, ok, ok ? "" : errnoText()));
}

void onPing(const char* args, unsigned int size, void* /*ctx*/) {
  send("{\"id\":" + std::to_string(parseId(args, size)) + ",\"kind\":\"pong\",\"version\":\"" + kVersion + "\"}");
}

}  // namespace

extern "C" MSFS_CALLBACK void module_init(void) {
  std::fprintf(stderr, "[PusherFiles] module_init, version %s\n", kVersion);
  fsCommBusRegister(kEventPing, onPing);
  fsCommBusRegister(kEventProbe, onProbe);
  fsCommBusRegister(kEventList, onList);
  fsCommBusRegister(kEventSave, onSave);
  fsCommBusRegister(kEventDelete, onDelete);
}

extern "C" MSFS_CALLBACK void module_deinit(void) {}
