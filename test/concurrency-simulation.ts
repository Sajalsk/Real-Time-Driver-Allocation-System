import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'http://localhost:3000';
const PICKUP_LAT = 40.7128;
const PICKUP_LNG = -74.006;

async function seedDrivers(count: number): Promise<string[]> {
  console.log(`Seeding ${count} drivers near pickup location...`);
  const driverIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const lat = PICKUP_LAT + (Math.random() - 0.5) * 0.02;
    const lng = PICKUP_LNG + (Math.random() - 0.5) * 0.02;

    const res = await fetch(`${BASE_URL}/drivers/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Driver ${i + 1}`,
        phone: `555-${String(i).padStart(4, '0')}`,
        lat,
        lng,
      }),
    });

    const data = (await res.json()) as { driverId: string };
    driverIds.push(data.driverId);
  }

  console.log(`${count} drivers seeded.\n`);
  return driverIds;
}

async function testGeoSearch() {
  console.log('--- Test 1: Geo-Based Driver Search ---');
  const res = await fetch(`${BASE_URL}/rides/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      riderId: uuidv4(),
      lat: PICKUP_LAT,
      lng: PICKUP_LNG,
    }),
  });

  const data = (await res.json()) as { rideId: string; status: string };
  console.log(`Ride ${data.rideId} created — status: ${data.status}`);
  console.log(`(Check server logs for GEOSEARCH results)\n`);
}

async function testConcurrency() {
  console.log('--- Test 2: Concurrency (100 simultaneous accepts) ---');

  const requestRes = await fetch(`${BASE_URL}/rides/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      riderId: uuidv4(),
      lat: PICKUP_LAT,
      lng: PICKUP_LNG,
    }),
  });
  const { rideId } = (await requestRes.json()) as { rideId: string };
  console.log(`Ride created: ${rideId}`);

  const fakeDrivers = Array.from({ length: 100 }).map(() => uuidv4());
  const requests = fakeDrivers.map((driverId) =>
    fetch(`${BASE_URL}/rides/${rideId}/accept`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    }).then((r) => r.json()),
  );

  const start = Date.now();
  const results = (await Promise.all(requests)) as Array<{ success?: boolean }>;
  const elapsed = Date.now() - start;

  let wins = 0;
  let losses = 0;
  let winner = '';
  results.forEach((res, i) => {
    if (res?.success) {
      wins++;
      winner = fakeDrivers[i];
    } else losses++;
  });

  console.log(`Time: ${elapsed}ms | Assigned: ${wins} | Rejected: ${losses}`);
  console.log(
    wins === 1
      ? `Winner: ${winner} — PASS\n`
      : 'FAIL — race condition detected\n',
  );
}

async function testIdempotency() {
  console.log('--- Test 3: Idempotency ---');

  const res = await fetch(`${BASE_URL}/rides/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      riderId: uuidv4(),
      lat: PICKUP_LAT,
      lng: PICKUP_LNG,
    }),
  });
  const { rideId } = (await res.json()) as { rideId: string };
  const driverId = uuidv4();

  const accept = async () => {
    const r = await fetch(`${BASE_URL}/rides/${rideId}/accept`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    });
    return (await r.json()) as { success: boolean; result: string };
  };

  const first = await accept();
  const retry = await accept();

  console.log(`First: ${first.result} | Retry: ${retry.result}`);
  console.log(retry.result === 'SUCCESS_IDEMPOTENT' ? 'PASS\n' : 'FAIL\n');
}

async function testLocationUpdate(driverIds: string[]) {
  console.log('--- Test 4: Dynamic Location Update ---');

  const res = await fetch(`${BASE_URL}/drivers/${driverIds[0]}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: PICKUP_LAT + 0.001, lng: PICKUP_LNG + 0.001 }),
  });
  const data = (await res.json()) as { updated: boolean };
  console.log(data.updated ? 'PASS\n' : 'FAIL\n');
}

async function main() {
  console.log('\n=== Driver Allocation System — Test Suite ===\n');
  try {
    const drivers = await seedDrivers(10);
    await testGeoSearch();
    await testConcurrency();
    await testIdempotency();
    await testLocationUpdate(drivers);
    console.log('=== All tests complete ===\n');
  } catch (err) {
    console.error('Error — is the server running?', err);
  }
}

main().catch(console.error);
