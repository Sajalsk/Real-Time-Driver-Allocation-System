import { Controller, Post, Body, Patch, Param } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaService } from './prisma.service';

@Controller('drivers')
export class DriverController {
  constructor(
    private readonly redisService: RedisService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Register a new driver (or update an existing one).
   * POST /drivers/register
   */
  @Post('register')
  async registerDriver(
    @Body() body: { name: string; phone: string; lat: number; lng: number },
  ) {
    const driver = await this.prismaService.driver.upsert({
      where: { phone: body.phone },
      update: { name: body.name, status: 'AVAILABLE' },
      create: { name: body.name, phone: body.phone, status: 'AVAILABLE' },
    });

    // Store location in Redis GEO index
    await this.redisService.updateDriverLocation(driver.id, body.lng, body.lat);

    // Track availability in a Redis SET
    await this.redisService.markDriverAvailable(driver.id);

    return {
      driverId: driver.id,
      status: 'AVAILABLE',
      location: { lat: body.lat, lng: body.lng },
    };
  }

  /**
   * Dynamically update a driver's GPS location (heartbeat).
   * PATCH /drivers/:driverId/location
   */
  @Patch(':driverId/location')
  async updateLocation(
    @Param('driverId') driverId: string,
    @Body() body: { lat: number; lng: number },
  ) {
    await this.redisService.updateDriverLocation(driverId, body.lng, body.lat);
    return {
      driverId,
      location: { lat: body.lat, lng: body.lng },
      updated: true,
    };
  }

  /**
   * Toggle driver online/offline status.
   * PATCH /drivers/:driverId/status
   */
  @Patch(':driverId/status')
  async updateStatus(
    @Param('driverId') driverId: string,
    @Body() body: { status: 'AVAILABLE' | 'OFFLINE' },
  ) {
    await this.prismaService.driver.update({
      where: { id: driverId },
      data: { status: body.status },
    });

    if (body.status === 'AVAILABLE') {
      await this.redisService.markDriverAvailable(driverId);
    } else {
      await this.redisService.markDriverUnavailable(driverId);
    }

    return { driverId, status: body.status };
  }
}
