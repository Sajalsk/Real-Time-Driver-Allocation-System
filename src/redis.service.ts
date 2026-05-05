import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  public readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
  }

  onModuleInit() {
    // Register Lua script for atomic ride assignment
    this.client.defineCommand('assignRideAtomically', {
      numberOfKeys: 1,
      lua: `
        local rideKey = KEYS[1]
        local driverId = ARGV[1]
        local currentStatus = redis.call("HGET", rideKey, "status")

        if currentStatus == false then
          return "RIDE_NOT_FOUND"
        elseif currentStatus == "ASSIGNED" then
           local actualDriver = redis.call("HGET", rideKey, "driverId")
           if actualDriver == driverId then
              return "SUCCESS_IDEMPOTENT"
           else
              return "RIDE_ALREADY_TAKEN"
           end
        elseif currentStatus == "SEARCHING" then
           redis.call("HSET", rideKey, "status", "ASSIGNED")
           redis.call("HSET", rideKey, "driverId", driverId)
           return "SUCCESS"
        else
           return "INVALID_STATE"
        end
      `,
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  async assignRide(rideId: string, driverId: string): Promise<string> {
    const rideKey = `ride:${rideId}`;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    const rawResult = await (this.client as any).assignRideAtomically(
      rideKey,
      driverId,
    );
    return rawResult as string;
  }

  async createRideState(rideId: string) {
    const rideKey = `ride:${rideId}`;
    await this.client.hset(rideKey, { status: 'SEARCHING', driverId: '' });
  }

  async updateDriverLocation(driverId: string, lon: number, lat: number) {
    await this.client.geoadd('drivers:locations', lon, lat, driverId);
  }

  async getNearbyDrivers(
    lon: number,
    lat: number,
    radiusKm: number,
  ): Promise<string[]> {
    const results = await this.client.geosearch(
      'drivers:locations',
      'FROMLONLAT',
      lon,
      lat,
      'BYRADIUS',
      radiusKm,
      'km',
      'ASC',
    );

    const allNearby = results as string[];
    if (allNearby.length === 0) return [];

    // Filter to only available drivers
    const available: string[] = [];
    for (const driverId of allNearby) {
      const isAvailable = await this.client.sismember(
        'drivers:available',
        driverId,
      );
      if (isAvailable) available.push(driverId);
    }
    return available;
  }

  async markDriverAvailable(driverId: string) {
    await this.client.sadd('drivers:available', driverId);
  }

  async markDriverUnavailable(driverId: string) {
    await this.client.srem('drivers:available', driverId);
  }
}
