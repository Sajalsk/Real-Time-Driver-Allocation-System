import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';
import { RideGateway } from './ride.gateway';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RideService {
  private readonly logger = new Logger(RideService.name);

  constructor(
    private redisService: RedisService,
    private prismaService: PrismaService,
    private rideGateway: RideGateway,
    @InjectQueue('rides-timeout') private ridesQueue: Queue,
  ) {}

  async requestRide(riderId: string, pickupLat: number, pickupLng: number) {
    const rideId = uuidv4();

    await this.prismaService.ride.create({
      data: {
        id: rideId,
        rider: {
          connectOrCreate: {
            where: { id: riderId },
            create: { id: riderId, name: 'Rider', phone: riderId },
          },
        },
        status: 'SEARCHING',
        pickupLat,
        pickupLng,
        dropLat: pickupLat + 0.01,
        dropLng: pickupLng + 0.01,
      },
    });

    await this.redisService.createRideState(rideId);
    await this.discoverAndNotifyDrivers(rideId, pickupLat, pickupLng, 2);

    return { rideId, status: 'SEARCHING' };
  }

  async discoverAndNotifyDrivers(
    rideId: string,
    lat: number,
    lng: number,
    radiusKm: number,
    currentRetryCount = 0,
  ) {
    const nearbyDrivers = await this.redisService.getNearbyDrivers(
      lng,
      lat,
      radiusKm,
    );

    if (nearbyDrivers.length === 0) {
      this.logger.warn(
        `No drivers found for ride ${rideId} within ${radiusKm}km`,
      );
    } else {
      this.logger.log(
        `Found ${nearbyDrivers.length} drivers for ride ${rideId}`,
      );
      this.rideGateway.notifyDrivers(nearbyDrivers, { rideId, lat, lng });
    }

    // Schedule a timeout check
    await this.ridesQueue.add(
      'check-ride-timeout',
      {
        rideId,
        lat,
        lng,
        currentRadius: radiusKm,
        retryCount: currentRetryCount + 1,
      },
      { delay: 15000 },
    );
  }

  async acceptRide(rideId: string, driverId: string) {
    try {
      const result = await this.redisService.assignRide(rideId, driverId);

      if (result === 'SUCCESS' || result === 'SUCCESS_IDEMPOTENT') {
        await this.prismaService.ride.update({
          where: { id: rideId },
          data: {
            driver: {
              connectOrCreate: {
                where: { id: driverId },
                create: { id: driverId, name: 'Driver', phone: driverId },
              },
            },
            status: 'ASSIGNED',
          },
        });
        return { success: true, message: 'Ride accepted', result };
      }

      return { success: false, message: 'Ride not available', reason: result };
    } catch (e: any) {
      this.logger.error('Error in acceptRide:', e);
      return { success: false, message: e.message || 'Server error' };
    }
  }
}
