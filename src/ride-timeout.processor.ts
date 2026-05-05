import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';
import { RideService } from './ride.service';

interface RideJobData {
  rideId: string;
  lat: number;
  lng: number;
  currentRadius: number;
  retryCount: number;
}

@Processor('rides-timeout')
export class RideTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(RideTimeoutProcessor.name);

  constructor(
    private redisService: RedisService,
    private prismaService: PrismaService,
    private rideService: RideService,
  ) {
    super();
  }

  async process(job: Job<RideJobData>) {
    const { rideId, lat, lng, currentRadius, retryCount } = job.data;

    const currentStatus = await this.redisService.client.hget(
      `ride:${rideId}`,
      'status',
    );

    if (currentStatus !== 'SEARCHING') {
      this.logger.log(
        `Job ${job.id}: Ride ${rideId} is no longer searching, ending timeout checks.`,
      );
      return;
    }

    const MAX_RETRIES = 3;
    if (retryCount >= MAX_RETRIES) {
      this.logger.log(
        `Ride ${rideId} timed out after ${MAX_RETRIES} attempts.`,
      );
      await this.redisService.client.hset(
        `ride:${rideId}`,
        'status',
        'TIMEOUT',
      );

      await this.prismaService.ride.update({
        where: { id: rideId },
        data: { status: 'TIMEOUT' },
      });
      return;
    }

    const expandedRadius = currentRadius + 3;
    this.logger.log(
      `Ride ${rideId} unassigned, retrying with expanded radius: ${expandedRadius}km`,
    );

    await this.rideService.discoverAndNotifyDrivers(
      rideId,
      lat,
      lng,
      expandedRadius,
      retryCount,
    );
  }
}
