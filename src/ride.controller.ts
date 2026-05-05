import { Controller, Post, Body, Param, Patch } from '@nestjs/common';
import { RideService } from './ride.service';

@Controller('rides')
export class RideController {
  constructor(private readonly rideService: RideService) {}

  @Post('request')
  async requestRide(
    @Body() body: { riderId: string; lat: number; lng: number },
  ) {
    return this.rideService.requestRide(body.riderId, body.lat, body.lng);
  }

  @Patch(':rideId/accept')
  async acceptRide(
    @Param('rideId') rideId: string,
    @Body() body: { driverId: string },
  ) {
    return this.rideService.acceptRide(rideId, body.driverId);
  }
}
