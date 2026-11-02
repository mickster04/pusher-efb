#include "taxi_core.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace pusher {

namespace {

constexpr double kMetresPerDegLat = 111320.0;
constexpr double kPi = 3.14159265358979323846;

template <typename T>
T readAt(const unsigned char* data, size_t offset) {
  T value;
  std::memcpy(&value, data + offset, sizeof(T));
  return value;
}

std::string fmt(const char* format, double a) {
  char buf[48];
  std::snprintf(buf, sizeof(buf), format, a);
  return buf;
}

std::string num7(double v) { return fmt("%.7f", v); }
std::string num2(double v) { return fmt("%.2f", v); }

struct LatLon { double lat; double lon; };

LatLon position(double refLat, double refLon, double biasX, double biasZ) {
  double cosLat = std::cos(refLat * kPi / 180.0);
  if (cosLat < 0.1) cosLat = 0.1;
  return { refLat + biasZ / kMetresPerDegLat, refLon + biasX / (kMetresPerDegLat * cosLat) };
}

const char* const kParkingNames[] = {
  "", "Parking", "N Parking", "NE Parking", "E Parking", "SE Parking", "S Parking", "SW Parking", "W Parking", "NW Parking", "Gate", "Dock",
};
constexpr int kParkingNameCount = static_cast<int>(sizeof(kParkingNames) / sizeof(kParkingNames[0]));

// Appends messages of the form {"id":N,"kind":"<kind>","seq":S,"items":[ ... ]} each at most maxBytes long.
void pushChunks(std::vector<std::string>* out, uint32_t id, const char* kind, const std::vector<std::string>& items,
                size_t maxBytes, int* seq) {
  std::string head = "{\"id\":" + std::to_string(id) + ",\"kind\":\"" + kind + "\",\"seq\":";
  size_t i = 0;
  while (i < items.size()) {
    std::string msg = head + std::to_string(*seq) + ",\"items\":[";
    bool first = true;
    while (i < items.size()) {
      size_t add = items[i].size() + (first ? 0 : 1);
      if (!first && msg.size() + add + 2 > maxBytes) break;
      if (!first) msg += ',';
      msg += items[i];
      first = false;
      ++i;
    }
    msg += "]}";
    out->push_back(msg);
    ++(*seq);
  }
}

}  // namespace

void TaxiCollector::reset(uint32_t requestId, const std::string& icao) {
  requestId_ = requestId;
  icao_ = icao;
  haveAirport_ = false;
  refLat_ = refLon_ = 0;
  points_.clear();
  parking_.clear();
  paths_.clear();
  names_.clear();
}

std::string TaxiCollector::parkingLabel(int name, int suffix, uint32_t number) {
  std::string base;
  if (name >= 0 && name < kParkingNameCount) base = kParkingNames[name];
  else if (name >= 12 && name <= 37) base = std::string("Gate ") + static_cast<char>('A' + (name - 12));

  std::string suf;
  if (suffix >= 12 && suffix <= 37) suf = std::string(1, static_cast<char>('A' + (suffix - 12)));
  else if (suffix >= 1 && suffix < kParkingNameCount) suf = kParkingNames[suffix];

  std::string label = base;
  if (number > 0) label += (label.empty() ? "" : " ") + std::to_string(number);
  label += suf;
  // Trim.
  size_t a = label.find_first_not_of(' ');
  size_t b = label.find_last_not_of(' ');
  label = a == std::string::npos ? "" : label.substr(a, b - a + 1);
  if (label.empty()) label = "Stand (" + std::to_string(name) + "/" + std::to_string(suffix) + "/" + std::to_string(number) + ")";
  return label;
}

void TaxiCollector::addRecord(int type, const unsigned char* data, size_t size) {
  switch (type) {
    case kTypeAirport:
      if (size >= kAirportSize) {
        refLat_ = readAt<double>(data, 0);
        refLon_ = readAt<double>(data, 8);
        haveAirport_ = true;
      }
      break;
    case kTypeTaxiPoint:
      if (size >= kTaxiPointSize) {
        points_.push_back({ readAt<int32_t>(data, 0), readAt<float>(data, 8), readAt<float>(data, 12) });
      }
      break;
    case kTypeTaxiParking:
      if (size >= kTaxiParkingSize) {
        TaxiParking p;
        p.label = parkingLabel(readAt<int32_t>(data, 8), readAt<int32_t>(data, 12), readAt<uint32_t>(data, 16));
        p.type = readAt<int32_t>(data, 0);
        p.heading = readAt<float>(data, 24);
        p.radius = readAt<float>(data, 28);
        p.biasX = readAt<float>(data, 32);
        p.biasZ = readAt<float>(data, 36);
        parking_.push_back(p);
      }
      break;
    case kTypeTaxiPath:
      if (size >= kTaxiPathSize) {
        paths_.push_back({ readAt<int32_t>(data, 0), readAt<float>(data, 4), readAt<int32_t>(data, 8), readAt<int32_t>(data, 12), readAt<uint32_t>(data, 16) });
      }
      break;
    case kTypeTaxiName:
      if (size >= kTaxiNameSize) {
        const char* chars = reinterpret_cast<const char*>(data);
        size_t len = 0;
        while (len < kTaxiNameSize && chars[len] != '\0') ++len;
        names_.push_back(std::string(chars, len));
      }
      break;
    default:
      break;
  }
}

std::vector<std::string> TaxiCollector::buildMessages(size_t maxChunkBytes) const {
  std::vector<std::string> out;
  if (!haveAirport_) {
    out.push_back(errorMessage(requestId_, "the sim returned no airport reference position for " + icao_));
    return out;
  }
  if (points_.empty() && parking_.empty() && paths_.empty()) {
    out.push_back(errorMessage(requestId_, "the sim returned no taxiway data for " + icao_));
    return out;
  }

  std::vector<std::string> nameItems;
  for (size_t i = 0; i < names_.size(); ++i) nameItems.push_back("\"" + jsonEscape(names_[i]) + "\"");

  std::vector<std::string> parkingItems;
  for (size_t i = 0; i < parking_.size(); ++i) {
    const TaxiParking& p = parking_[i];
    LatLon ll = position(refLat_, refLon_, p.biasX, p.biasZ);
    parkingItems.push_back("[\"" + jsonEscape(p.label) + "\"," + std::to_string(p.type) + "," + num7(ll.lat) + "," + num7(ll.lon) + "," + num2(p.heading) + "," + num2(p.radius) + "]");
  }

  // START/END index the taxi points; on a parking connector (type 3) END indexes a parking spot instead.
  std::vector<std::string> pathItems;
  size_t skipped = 0;
  for (size_t i = 0; i < paths_.size(); ++i) {
    const TaxiPath& t = paths_[i];
    bool haveA = t.start >= 0 && static_cast<size_t>(t.start) < points_.size();
    LatLon a = { 0, 0 }, z = { 0, 0 };
    bool haveZ = false;
    if (haveA) a = position(refLat_, refLon_, points_[t.start].biasX, points_[t.start].biasZ);
    if (t.type == 3 && t.end >= 0 && static_cast<size_t>(t.end) < parking_.size()) {
      z = position(refLat_, refLon_, parking_[t.end].biasX, parking_[t.end].biasZ);
      haveZ = true;
    } else if (t.end >= 0 && static_cast<size_t>(t.end) < points_.size()) {
      z = position(refLat_, refLon_, points_[t.end].biasX, points_[t.end].biasZ);
      haveZ = true;
    }
    if (!haveA || !haveZ) { ++skipped; continue; }
    pathItems.push_back("[" + std::to_string(t.type) + "," + num2(t.width) + "," + num7(a.lat) + "," + num7(a.lon) + "," + num7(z.lat) + "," + num7(z.lon) + "," + std::to_string(t.nameIdx) + "]");
  }

  std::vector<std::string> chunks;
  int seq = 0;
  pushChunks(&chunks, requestId_, "names", nameItems, maxChunkBytes, &seq);
  pushChunks(&chunks, requestId_, "parking", parkingItems, maxChunkBytes, &seq);
  pushChunks(&chunks, requestId_, "paths", pathItems, maxChunkBytes, &seq);

  std::string meta = "{\"id\":" + std::to_string(requestId_) + ",\"kind\":\"meta\",\"icao\":\"" + jsonEscape(icao_) + "\",\"refLat\":" + num7(refLat_) +
                     ",\"refLon\":" + num7(refLon_) + ",\"points\":" + std::to_string(points_.size()) + ",\"parking\":" + std::to_string(parking_.size()) +
                     ",\"paths\":" + std::to_string(pathItems.size()) + ",\"skippedPaths\":" + std::to_string(skipped) + ",\"names\":" + std::to_string(names_.size()) +
                     ",\"chunks\":" + std::to_string(chunks.size()) + "}";
  out.push_back(meta);
  for (size_t i = 0; i < chunks.size(); ++i) out.push_back(chunks[i]);
  out.push_back("{\"id\":" + std::to_string(requestId_) + ",\"kind\":\"end\",\"chunks\":" + std::to_string(chunks.size()) + "}");
  return out;
}

std::string jsonEscape(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (size_t i = 0; i < s.size(); ++i) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof(buf), "\\u%04x", c); out += buf; }
        else out += static_cast<char>(c);
    }
  }
  return out;
}

std::string errorMessage(uint32_t id, const std::string& text) {
  return "{\"id\":" + std::to_string(id) + ",\"kind\":\"error\",\"message\":\"" + jsonEscape(text) + "\"}";
}

std::string pongMessage(uint32_t id, const char* version) {
  return "{\"id\":" + std::to_string(id) + ",\"kind\":\"pong\",\"version\":\"" + jsonEscape(version) + "\"}";
}

bool parseRequest(const char* json, size_t size, uint32_t* id, std::string* icao) {
  if (id) *id = 0;
  if (icao) icao->clear();
  if (!json || size == 0) return false;
  std::string s(json, size);

  size_t k = s.find("\"id\"");
  if (k != std::string::npos && id) {
    size_t p = s.find(':', k);
    if (p != std::string::npos) {
      ++p;
      while (p < s.size() && s[p] == ' ') ++p;
      uint32_t v = 0;
      bool any = false;
      while (p < s.size() && s[p] >= '0' && s[p] <= '9') { v = v * 10 + static_cast<uint32_t>(s[p] - '0'); ++p; any = true; }
      if (any) *id = v;
    }
  }

  k = s.find("\"icao\"");
  if (k == std::string::npos) return false;
  size_t q1 = s.find('"', s.find(':', k) == std::string::npos ? k + 6 : s.find(':', k));
  if (q1 == std::string::npos) return false;
  size_t q2 = s.find('"', q1 + 1);
  if (q2 == std::string::npos) return false;
  std::string value = s.substr(q1 + 1, q2 - q1 - 1);
  if (value.empty() || value.size() > 8) return false;
  for (size_t i = 0; i < value.size(); ++i) {
    char c = value[i];
    bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    if (!ok) return false;
    if (c >= 'a' && c <= 'z') value[i] = static_cast<char>(c - 'a' + 'A');
  }
  if (icao) *icao = value;
  return true;
}

}  // namespace pusher
