// Host test for the portable core: builds facility records the way the sim lays them out, runs the collector,
// and prints every JSON message on its own line. Used by test/wasm-core.test.mjs and to generate harness/taxi-sample.txt.
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "../src/taxi_core.h"

using namespace pusher;

namespace {

template <typename T>
void put(std::vector<unsigned char>* b, T v) {
  unsigned char tmp[sizeof(T)];
  std::memcpy(tmp, &v, sizeof(T));
  b->insert(b->end(), tmp, tmp + sizeof(T));
}

void airport(TaxiCollector* c, double lat, double lon) {
  std::vector<unsigned char> b;
  put<double>(&b, lat); put<double>(&b, lon); put<double>(&b, 10.0);
  c->addRecord(kTypeAirport, b.data(), b.size());
}
void point(TaxiCollector* c, float x, float z) {
  std::vector<unsigned char> b;
  put<int32_t>(&b, 1); put<int32_t>(&b, 0); put<float>(&b, x); put<float>(&b, z);
  c->addRecord(kTypeTaxiPoint, b.data(), b.size());
}
void parking(TaxiCollector* c, int name, int suffix, uint32_t number, float hdg, float radius, float x, float z) {
  std::vector<unsigned char> b;
  put<int32_t>(&b, 1); put<int32_t>(&b, 0); put<int32_t>(&b, name); put<int32_t>(&b, suffix); put<uint32_t>(&b, number);
  put<int32_t>(&b, 0); put<float>(&b, hdg); put<float>(&b, radius); put<float>(&b, x); put<float>(&b, z);
  c->addRecord(kTypeTaxiParking, b.data(), b.size());
}
void path(TaxiCollector* c, int type, float width, int start, int end, uint32_t nameIdx) {
  std::vector<unsigned char> b;
  put<int32_t>(&b, type); put<float>(&b, width); put<int32_t>(&b, start); put<int32_t>(&b, end); put<uint32_t>(&b, nameIdx);
  c->addRecord(kTypeTaxiPath, b.data(), b.size());
}
void name(TaxiCollector* c, const char* text) {
  unsigned char b[32] = { 0 };
  std::strncpy(reinterpret_cast<char*>(b), text, 31);
  c->addRecord(kTypeTaxiName, b, sizeof(b));
}

}  // namespace

int main(int argc, char** argv) {
  std::string mode = argc > 1 ? argv[1] : "sample";
  TaxiCollector c;

  if (mode == "empty") {
    c.reset(9, "ZZZZ");
    airport(&c, 10.0, 20.0);
  } else if (mode == "noairport") {
    c.reset(9, "ZZZZ");
    point(&c, 0, 0);
  } else if (mode == "request") {
    // Round trip of the request parser: prints "<ok> <id> <icao>" for a few inputs.
    const char* inputs[] = { "{\"id\":7,\"icao\":\"nzch\"}", "{\"icao\": \"EGLL\", \"id\": 12}", "{\"id\":3}", "{\"id\":1,\"icao\":\"BAD ID\"}", "" };
    for (size_t i = 0; i < sizeof(inputs) / sizeof(inputs[0]); ++i) {
      uint32_t id = 99; std::string icao;
      bool ok = parseRequest(inputs[i], std::strlen(inputs[i]), &id, &icao);
      std::printf("%d %u %s\n", ok ? 1 : 0, id, icao.c_str());
    }
    return 0;
  } else {
    c.reset(7, "NZCH");
    airport(&c, -43.489, 172.5375);
    // taxi points: bias metres east (x) and north (z) of the airport reference
    point(&c, 0, 0); point(&c, 100, 0); point(&c, 200, 0); point(&c, 200, 100); point(&c, 200, 200); point(&c, 0, 50);
    parking(&c, 12, 0, 1, 90.0f, 30.0f, 0.0f, -40.0f);     // Gate A 1
    parking(&c, 1, 0, 2, 270.0f, 25.0f, 60.0f, -40.0f);    // Parking 2
    parking(&c, 10, 12, 3, 180.0f, 20.0f, 120.0f, -40.0f); // Gate 3A
    name(&c, "A"); name(&c, "B"); name(&c, "LINK"); name(&c, "A\"Q\\X");  // last name needs JSON escaping
    path(&c, 1, 23.0f, 0, 1, 0);
    path(&c, 1, 23.0f, 1, 2, 0);
    path(&c, 1, 23.0f, 2, 3, 1);
    path(&c, 1, 23.0f, 3, 4, 1);
    path(&c, 3, 12.0f, 5, 0, 2);   // parking connector: END indexes a parking spot
    path(&c, 1, 15.0f, 4, 99, 3);  // bad end index: skipped
    path(&c, 4, 0.0f, 0, 5, 3);    // paint line
  }

  size_t chunk = argc > 2 ? static_cast<size_t>(std::atoi(argv[2])) : 6000;
  std::vector<std::string> msgs = c.buildMessages(chunk);
  for (size_t i = 0; i < msgs.size(); ++i) std::printf("%s\n", msgs[i].c_str());
  return 0;
}
