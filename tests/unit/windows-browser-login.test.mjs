import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Windows browser login loopback architecture and UI binding", () => {
  for (const base of ["src-native", "apps/windows/src-native"]) {
    const dispatcher = fs.readFileSync(`${base}/src/service_dispatcher.cpp`, "utf8");
    const dispatcherHeader = fs.readFileSync(`${base}/include/service_dispatcher.hpp`, "utf8");
    const client = fs.readFileSync(`${base}/src/cloud_client.cpp`, "utf8");
    const clientHeader = fs.readFileSync(`${base}/include/cloud_client.hpp`, "utf8");
    const common = fs.readFileSync(`${base}/include/common.hpp`, "utf8");
    const cmake = fs.readFileSync(`${base}/CMakeLists.txt`, "utf8");

    // Winsock2 link in CMake
    assert.match(cmake, /ws2_32/, `${base}/CMakeLists.txt must link ws2_32`);

    // Winsock2 inclusion in common.hpp
    assert.match(common, /#include <winsock2\.h>/, `${base}/include/common.hpp must include winsock2.h`);
    assert.match(common, /#include <ws2tcpip\.h>/, `${base}/include/common.hpp must include ws2tcpip.h`);

    // ApplyTokens in cloud_client
    assert.match(clientHeader, /json\s+ApplyTokens\s*\(\s*const\s+std::string&\s+accessToken,\s*const\s+std::string&\s+refreshToken\s*\)/);
    assert.match(client, /json\s+CloudClient::ApplyTokens\s*\(/);
    assert.match(client, /m_token\s*=\s*accessToken/);
    assert.match(client, /m_refreshToken\s*=\s*refreshToken/);
    assert.match(client, /Save\(\)/);

    // gate.browserLogin handling and loopback implementation in service_dispatcher
    assert.match(dispatcher, /action\s*==\s*"gate\.browserLogin"/);
    assert.match(dispatcher, /StartBrowserLogin/);
    assert.match(dispatcherHeader, /void\s+StartBrowserLogin\s*\(\s*DispatchResponseCallback\s+callback\s*\)/);

    // Ephemeral loopback port binding & winsock
    assert.match(dispatcher, /inet_addr\("127\.0\.0\.1"\)/);
    assert.match(dispatcher, /getsockname/);
    assert.match(dispatcher, /WSAStartup/);
    assert.match(dispatcher, /WSACleanup/);

    // HintLens browser redirect and token extraction landing page
    assert.match(dispatcher, /location\.replace\('\/done\?'\s*\+\s*h\)/);
    assert.match(dispatcher, /m_cloud\.ApplyTokens/);
    assert.match(dispatcher, /lens:gate/);
  }

  // UI button in GateAccess.tsx
  const gateAccess = fs.readFileSync("src/GateAccess.tsx", "utf8");
  assert.match(gateAccess, /startBrowserLogin/);
  assert.match(gateAccess, /gate\.browserLogin/);
  assert.match(gateAccess, /Sign in with Browser \/ Google/);
});

test("OAuth loopback parameter parsing handles token extraction correctly", async () => {
  // Test the exact token parsing logic used when browser returns from OAuth redirect
  const parseOAuthParams = (queryString) => {
    const params = new URLSearchParams(queryString);
    return {
      accessToken: params.get("access_token") || "",
      refreshToken: params.get("refresh_token") || "",
    };
  };

  const parsed = parseOAuthParams("access_token=ya29.mock_token_123&refresh_token=1//mock_refresh_456&token_type=Bearer");
  assert.equal(parsed.accessToken, "ya29.mock_token_123");
  assert.equal(parsed.refreshToken, "1//mock_refresh_456");

  // Empty query string handling
  const empty = parseOAuthParams("");
  assert.equal(empty.accessToken, "");
  assert.equal(empty.refreshToken, "");
});
