// Pusher taxi module: MSFS 2024 standalone WASM module.
//
// UNVERIFIED: this glue has not been compiled or run against the MSFS SDK (written on a machine without it). The logic it
// calls (taxi_core.cpp) is compiled and tested on the host. Compile this file with the MSFS 2024 WASM platform toolset.
//
// Flow: the EFB app calls "PusherTaxiRequest" with {"id":7,"icao":"NZCH"} over the CommBus. This module asks SimConnect for
// the airport's facility data, collects it with TaxiCollector, and sends JSON messages back on "PusherTaxiResponse".
// "PusherTaxiPing" {"id":1} is answered with a pong so the app can tell the module is loaded.
#include <MSFS/MSFS.h>
#include <MSFS/MSFS_CommBus.h>
#include <MSFS/MSFS_WindowsTypes.h>
#include <SimConnect.h>

#include <cstddef>
#include <cstdio>
#include <string>

#include "taxi_core.h"

namespace {

const char* const kVersion = "0.1.0";
const char* const kEventRequest = "PusherTaxiRequest";
const char* const kEventPing = "PusherTaxiPing";
const char* const kEventResponse = "PusherTaxiResponse";

constexpr DWORD kDefineTaxi = 0x5A110001;
constexpr DWORD kRequestTaxi = 0x5A110002;

HANDLE g_simConnect = 0;
bool g_defined = false;
bool g_waiting = false;
pusher::TaxiCollector g_collector;

void send(const std::string& json) {
  fsCommBusCall(kEventResponse, json.c_str(), static_cast<unsigned int>(json.size()), FsCommBusBroadcast_JS);
}

// The facility fields requested: the same set the original Pusher bridge used.
bool defineFacilityFields() {
  static const char* const fields[] = {
    "OPEN AIRPORT", "LATITUDE", "LONGITUDE", "ALTITUDE",
    "OPEN TAXI_POINT", "TYPE", "ORIENTATION", "BIAS_X", "BIAS_Z", "CLOSE TAXI_POINT",
    "OPEN TAXI_PARKING", "TYPE", "TAXI_POINT_TYPE", "NAME", "SUFFIX", "NUMBER", "ORIENTATION", "HEADING", "RADIUS", "BIAS_X", "BIAS_Z", "CLOSE TAXI_PARKING",
    "OPEN TAXI_PATH", "TYPE", "WIDTH", "START", "END", "NAME_INDEX", "CLOSE TAXI_PATH",
    "OPEN TAXI_NAME", "NAME", "CLOSE TAXI_NAME",
    "CLOSE AIRPORT",
  };
  for (size_t i = 0; i < sizeof(fields) / sizeof(fields[0]); ++i) {
    HRESULT hr = SimConnect_AddToFacilityDefinition(g_simConnect, kDefineTaxi, fields[i]);
    if (FAILED(hr)) {
      std::fprintf(stderr, "[PusherTaxi] SimConnect refused facility field '%s' (0x%08lx)\n", fields[i], static_cast<unsigned long>(hr));
      return false;
    }
  }
  return true;
}

void finishRequest() {
  g_waiting = false;
  std::vector<std::string> messages = g_collector.buildMessages();
  std::fprintf(stderr, "[PusherTaxi] %s: %u points, %u parking, %u paths, %u names -> %u messages\n", g_collector.icao().c_str(),
               static_cast<unsigned>(g_collector.pointCount()), static_cast<unsigned>(g_collector.parkingCount()),
               static_cast<unsigned>(g_collector.pathCount()), static_cast<unsigned>(g_collector.nameCount()), static_cast<unsigned>(messages.size()));
  for (size_t i = 0; i < messages.size(); ++i) send(messages[i]);
}

void CALLBACK dispatch(SIMCONNECT_RECV* data, DWORD /*size*/, void* /*context*/) {
  switch (data->dwID) {
    case SIMCONNECT_RECV_ID_FACILITY_DATA: {
      const SIMCONNECT_RECV_FACILITY_DATA* f = reinterpret_cast<const SIMCONNECT_RECV_FACILITY_DATA*>(data);
      if (!g_waiting || f->UserRequestId != kRequestTaxi) break;
      const unsigned char* bytes = reinterpret_cast<const unsigned char*>(&f->Data);
      size_t avail = f->dwSize > offsetof(SIMCONNECT_RECV_FACILITY_DATA, Data) ? f->dwSize - offsetof(SIMCONNECT_RECV_FACILITY_DATA, Data) : 0;
      g_collector.addRecord(static_cast<int>(f->Type), bytes, avail);
      break;
    }
    case SIMCONNECT_RECV_ID_FACILITY_DATA_END: {
      const SIMCONNECT_RECV_FACILITY_DATA_END* e = reinterpret_cast<const SIMCONNECT_RECV_FACILITY_DATA_END*>(data);
      if (g_waiting && e->RequestId == kRequestTaxi) finishRequest();
      break;
    }
    case SIMCONNECT_RECV_ID_EXCEPTION: {
      const SIMCONNECT_RECV_EXCEPTION* ex = reinterpret_cast<const SIMCONNECT_RECV_EXCEPTION*>(data);
      std::fprintf(stderr, "[PusherTaxi] SimConnect exception %lu (send id %lu)\n", static_cast<unsigned long>(ex->dwException), static_cast<unsigned long>(ex->dwSendID));
      if (g_waiting) {
        g_waiting = false;
        send(pusher::errorMessage(g_collector.requestId(), "SimConnect raised exception " + std::to_string(ex->dwException) + " for " + g_collector.icao()));
      }
      break;
    }
    default:
      break;
  }
}

void onRequest(const char* args, unsigned int size, void* /*ctx*/) {
  uint32_t id = 0;
  std::string icao;
  if (!pusher::parseRequest(args, size, &id, &icao)) {
    send(pusher::errorMessage(id, "request had no usable icao"));
    return;
  }
  if (g_simConnect == 0 || !g_defined) {
    send(pusher::errorMessage(id, "the module has no SimConnect connection"));
    return;
  }
  g_collector.reset(id, icao);
  g_waiting = true;
  HRESULT hr = SimConnect_RequestFacilityData(g_simConnect, kDefineTaxi, kRequestTaxi, icao.c_str(), "");
  if (FAILED(hr)) {
    g_waiting = false;
    send(pusher::errorMessage(id, "SimConnect refused the facility request for " + icao + " (0x" + std::to_string(static_cast<unsigned long>(hr)) + ")"));
  }
}

void onPing(const char* args, unsigned int size, void* /*ctx*/) {
  uint32_t id = 0;
  std::string icao;
  pusher::parseRequest(args, size, &id, &icao);  // only the id matters here
  send(pusher::pongMessage(id, kVersion));
}

}  // namespace

extern "C" MSFS_CALLBACK void module_init(void) {
  std::fprintf(stderr, "[PusherTaxi] module_init, version %s\n", kVersion);
  HRESULT hr = SimConnect_Open(&g_simConnect, "Pusher Taxi", nullptr, 0, 0, 0);
  if (FAILED(hr)) {
    std::fprintf(stderr, "[PusherTaxi] SimConnect_Open failed (0x%08lx)\n", static_cast<unsigned long>(hr));
    g_simConnect = 0;
  } else {
    g_defined = defineFacilityFields();
    SimConnect_CallDispatch(g_simConnect, dispatch, nullptr);
  }
  fsCommBusRegister(kEventRequest, onRequest);
  fsCommBusRegister(kEventPing, onPing);
}

extern "C" MSFS_CALLBACK void module_deinit(void) {
  if (g_simConnect != 0) SimConnect_Close(g_simConnect);
  g_simConnect = 0;
}
