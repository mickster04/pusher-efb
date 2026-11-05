// Derived in part from the original Pusher app (MIT, (c) Palm Coasty Simulations): see THIRD_PARTY_NOTICES.md.
// Pusher taxi module: the logic that has no MSFS dependency.
//
// Collects the facility records SimConnect returns for an airport (taxi points, parking, paths, names), turns them into
// latitude/longitude geometry, and encodes the result as small JSON messages for the EFB app. Kept free of the MSFS and
// SimConnect headers so it can be compiled and tested on any machine.
//
// Record layouts and the coordinate conversion are the ones the original Pusher bridge used (bridge/TaxiwayService.cs),
// which worked against the real sim.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace pusher {

// Facility data type ids as the sim reports them (SIMCONNECT_FACILITY_DATA_TYPE).
constexpr int kTypeAirport = 0;
constexpr int kTypeTaxiPoint = 14;
constexpr int kTypeTaxiParking = 15;
constexpr int kTypeTaxiPath = 16;
constexpr int kTypeTaxiName = 17;

// Record sizes in bytes for the fields we request (all 4-byte aligned, tightly packed, in request order).
constexpr size_t kAirportSize = 24;      // LATITUDE f64, LONGITUDE f64, ALTITUDE f64
constexpr size_t kTaxiPointSize = 16;    // TYPE i32, ORIENTATION i32, BIAS_X f32, BIAS_Z f32
constexpr size_t kTaxiParkingSize = 40;  // TYPE, TAXI_POINT_TYPE, NAME, SUFFIX, NUMBER(u32), ORIENTATION, HEADING f32, RADIUS f32, BIAS_X f32, BIAS_Z f32
constexpr size_t kTaxiPathSize = 20;     // TYPE i32, WIDTH f32, START i32, END i32, NAME_INDEX u32
constexpr size_t kTaxiNameSize = 32;     // NAME char[32]

struct TaxiPoint { int32_t type; float biasX; float biasZ; };
struct TaxiParking { std::string label; int32_t type; float biasX; float biasZ; float heading; float radius; };
struct TaxiPath { int32_t type; float width; int32_t start; int32_t end; uint32_t nameIdx; };

class TaxiCollector {
 public:
  void reset(uint32_t requestId, const std::string& icao);

  // `data` points at the record bytes (the Data member of SIMCONNECT_RECV_FACILITY_DATA); `size` is the bytes available.
  void addRecord(int type, const unsigned char* data, size_t size);

  size_t pointCount() const { return points_.size(); }
  size_t parkingCount() const { return parking_.size(); }
  size_t pathCount() const { return paths_.size(); }
  size_t nameCount() const { return names_.size(); }
  bool haveAirport() const { return haveAirport_; }
  uint32_t requestId() const { return requestId_; }
  const std::string& icao() const { return icao_; }

  // The complete reply as JSON messages, in order: meta, then names/parking/paths chunks, then end.
  // On a problem (for example no airport position) the single message is an error message.
  std::vector<std::string> buildMessages(size_t maxChunkBytes = 6000) const;

  // The sim's parking name enum (0 none, 1-9 parking, 10 gate, 11 dock, 12-37 gate A-Z) plus suffix and number.
  static std::string parkingLabel(int name, int suffix, uint32_t number);

 private:
  uint32_t requestId_ = 0;
  std::string icao_;
  bool haveAirport_ = false;
  double refLat_ = 0, refLon_ = 0;
  std::vector<TaxiPoint> points_;
  std::vector<TaxiParking> parking_;
  std::vector<TaxiPath> paths_;
  std::vector<std::string> names_;
};

std::string jsonEscape(const std::string& s);
std::string errorMessage(uint32_t id, const std::string& text);
std::string pongMessage(uint32_t id, const char* version);

// Reads {"id":7,"icao":"NZCH"}. Returns false if there is no usable icao. `id` is 0 when absent.
bool parseRequest(const char* json, size_t size, uint32_t* id, std::string* icao);

}  // namespace pusher
