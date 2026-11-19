"use strict";
/* OW-107: Weather location privacy boundary. Exercise the real widget, preference observers and network calls. */
const assert = require("node:assert/strict");
const { createFakeSidebarHarness, widgetSrc: SRC } = require("./helpers/fake-widgets-harness.cjs");

const PREF = {
  widgets: "zen.workspace.zentral.widgets.enabled",
  enabled: "zen.workspace.zentral.widgets.weather.enabled",
  places: "zen.workspace.zentral.widgets.weather.places",
};
const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

function weatherFetch(calls) {
  return (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://geocoding-api.open-meteo.com/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        results: [{ name: "Example Town", country: "Poland", country_code: "PL", latitude: 50.67, longitude: 17.92 }],
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      current: { time: 1_700_000_000, temperature_2m: 12, relative_humidity_2m: 60, weather_code: 1, wind_speed_10m: 8 },
      daily: { time: ["2023-11-14"], weather_code: [1], temperature_2m_max: [14], temperature_2m_min: [7] },
    }) });
  };
}

(async () => {
  const calls = [];
  const h = createFakeSidebarHarness(
    {
      [PREF.widgets]: true,
      [PREF.enabled]: false,
      [PREF.places]: JSON.stringify([{ id: "home", name: "Example Town" }]),
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
    },
    { fetch: weatherFetch(calls) },
  );

  const { api } = h.start();
  await wait();
  assert.equal(calls.length, 0, "saving an unresolved place while Weather is off sends no request");

  // Even a subsequent place-setting edit remains local while the feature is disabled.
  h.Services.prefs.setStringPref(PREF.places, JSON.stringify([{ id: "home", name: "Private Example Town" }]));
  await wait();
  assert.equal(calls.length, 0, "place observers respect the disabled state");

  h.Services.prefs.setBoolPref(PREF.enabled, true);
  await wait(160);
  const geocode = calls.find((call) => call.url.startsWith("https://geocoding-api.open-meteo.com/"));
  const forecast = calls.find((call) => call.url.startsWith("https://api.open-meteo.com/v1/forecast"));
  assert.ok(geocode, "enabling Weather resolves the saved place name");
  assert.ok(forecast, "after resolving it, the forecast is fetched");
  assert.equal(new URL(geocode.url).searchParams.get("name"), "Private Example Town", "the geocoder receives the entered place name");
  const forecastUrl = new URL(forecast.url);
  assert.equal(forecastUrl.searchParams.get("latitude"), "50.67");
  assert.equal(forecastUrl.searchParams.get("longitude"), "17.92");
  assert.equal(forecastUrl.searchParams.has("name"), false, "the forecast endpoint does not receive the display name");
  for (const call of [geocode, forecast]) {
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.referrerPolicy, "no-referrer");
  }

  // Disabling during a lookup invalidates the response so it cannot write coordinates afterward.
  const pendingCalls = [];
  let resolveLookup;
  const h2 = createFakeSidebarHarness(
    {
      [PREF.widgets]: true,
      [PREF.enabled]: true,
      [PREF.places]: JSON.stringify([{ id: "private", name: "Private Town" }]),
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
    },
    {
      fetch(url, options) {
        pendingCalls.push({ url: String(url), options });
        if (String(url).startsWith("https://geocoding-api.open-meteo.com/")) {
          return new Promise((resolve) => { resolveLookup = resolve; });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ current: {}, daily: {} }) });
      },
    },
  );
  const { api: api2 } = h2.start();
  await wait();
  assert.equal(pendingCalls.filter((call) => call.url.startsWith("https://geocoding-api.open-meteo.com/")).length, 1);
  h2.Services.prefs.setBoolPref(PREF.enabled, false);
  resolveLookup({ ok: true, json: () => Promise.resolve({
    results: [{ name: "Private Town", country_code: "PL", latitude: 50.67, longitude: 17.92 }],
  }) });
  await wait();
  const savedAfterDisable = JSON.parse(h2.Services.prefs.getStringPref(PREF.places, "[]"));
  assert.ok(savedAfterDisable[0], "the named place remains saved");
  assert.equal(savedAfterDisable[0].latitude ?? null, null, "a lookup finishing after disable cannot persist latitude");
  assert.equal(savedAfterDisable[0].longitude ?? null, null, "a lookup finishing after disable cannot persist longitude");
  api2.destroy();

  // Static defense: location access must remain user-input-only; no silent device geolocation.
  assert.doesNotMatch(SRC, /navigator\s*\.\s*geolocation|Geolocation/);
  assert.equal((SRC.match(/fetch\(url, \{ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" \}\)/g) || []).length, 2,
    "both the geocoder and forecast use the same credential/referrer/cache policy");

  api.destroy();
  console.log("PASS OW-107 weather privacy (disabled gate, geocoding, forecast payload, request policy, disable-race)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
